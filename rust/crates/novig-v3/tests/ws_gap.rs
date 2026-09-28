//! End to end against the local mock exchange: a signed upgrade, a lossy feed, and a client
//! that must detect every gap, resync, and end up with exactly the exchange's book.

use novig_v3::book::Book;
use novig_v3::mock::{self, MockConfig};
use novig_v3::ws::{self, Selection, WsConfig, WsEvent};
use novig_v3::{Algorithm, Credentials, PrivateKey};
use std::time::Duration;

async fn run_for(rx: &mut tokio::sync::mpsc::UnboundedReceiver<WsEvent>, d: Duration) -> Vec<WsEvent> {
    let mut out = vec![];
    let deadline = tokio::time::Instant::now() + d;
    while let Ok(Some(e)) = tokio::time::timeout_at(deadline, rx.recv()).await {
        out.push(e);
    }
    out
}

#[tokio::test]
async fn lossy_feed_converges_to_the_exchange_book() {
    let key = PrivateKey::generate(Algorithm::Ed25519);
    let cfg = MockConfig { tick: Duration::from_millis(10), drop_every: Some(16), golive_every: Some(90), verify_with: Some(key.public_key()), ..Default::default() };
    let ex = mock::serve("127.0.0.1:0", cfg).await.unwrap();

    let (ws, mut rx) = ws::connect(WsConfig::new(ex.url(), Some(Credentials::new("test-key", key))));
    ws.subscribe(Selection::market(ex.market.market_id, "book"));
    let events = run_for(&mut rx, Duration::from_millis(2500)).await;
    ex.pause();
    // The client heals at the pace its `stream` budget allows, so wait for convergence.
    let truth = ex.book().await;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while ws.book(&ex.market.market_id).map(|b| b.seq) != Some(truth.seq) && tokio::time::Instant::now() < deadline {
        run_for(&mut rx, Duration::from_millis(100)).await;
    }

    let gaps = events.iter().filter(|e| matches!(e, WsEvent::Gap { .. })).count();
    let resyncs = events.iter().filter(|e| matches!(e, WsEvent::Resynced { .. })).count();
    let golives = events.iter().filter(|e| matches!(e, WsEvent::Lifecycle { transitions, .. } if transitions.iter().any(|t| t == "GOLIVE"))).count();
    assert!(gaps >= 5, "expected dropped frames to show up as gaps, got {gaps}");
    assert!(resyncs >= 1, "every gap should heal with a snapshot, got {resyncs}");
    assert!(golives >= 1, "the mock sends GOLIVE, which voids the book");

    let ours = ws.book(&ex.market.market_id).expect("client holds a book");
    let st = ws.stats();
    eprintln!("gaps={gaps} resyncs={resyncs} ours.seq={} truth.seq={} subjects={:?}", ours.seq, truth.seq, st.subjects);
    assert_eq!(ours.seq, truth.seq, "same seq as the exchange");
    assert_eq!(ours.to_snapshot(), Book::from_snapshot(&truth).to_snapshot(), "identical L3 queue");
    let stats = ws.stats();
    assert!(stats.connected && stats.gaps as usize >= gaps && stats.nonce >= 2);
}

#[tokio::test]
async fn a_bad_signature_is_rejected_at_upgrade() {
    let good = PrivateKey::generate(Algorithm::Ed25519);
    let wrong = PrivateKey::generate(Algorithm::Ed25519);
    let ex = mock::serve("127.0.0.1:0", MockConfig { verify_with: Some(good.public_key()), ..Default::default() }).await.unwrap();
    let (_ws, mut rx) = ws::connect(WsConfig::new(ex.url(), Some(Credentials::new("k", wrong))));
    let first = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await.unwrap().unwrap();
    match first {
        WsEvent::Disconnected { code, reason, .. } => {
            assert_eq!(code, Some(401));
            assert!(reason.contains("SIGNATURE_REJECTED"), "{reason}");
        }
        other => panic!("expected a refused upgrade, got {other:?}"),
    }
}

#[tokio::test]
async fn reconnects_and_resubscribes_after_a_silent_drop() {
    let ex = mock::serve("127.0.0.1:0", MockConfig { tick: Duration::from_millis(10), drop_every: None, golive_every: None, ..Default::default() }).await.unwrap();
    let (ws, mut rx) = ws::connect(WsConfig::new(ex.url(), None));
    ws.subscribe(Selection::market(ex.market.market_id, "book"));
    run_for(&mut rx, Duration::from_millis(300)).await;
    ex.kill_connections();
    let events = run_for(&mut rx, Duration::from_millis(1500)).await;
    assert!(events.iter().any(|e| matches!(e, WsEvent::Disconnected { .. })));
    assert!(events.iter().any(|e| matches!(e, WsEvent::Connected { connection: 2, .. })));
    assert!(events.iter().filter(|e| matches!(e, WsEvent::Book { .. })).count() > 5, "book flows again on the new connection");
    ex.pause();
    run_for(&mut rx, Duration::from_millis(300)).await;
    assert_eq!(ws.book(&ex.market.market_id).unwrap().to_snapshot(), Book::from_snapshot(&ex.book().await).to_snapshot());
}
