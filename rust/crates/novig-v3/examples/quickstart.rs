//! Novig's quickstart (docs.novig.com/api/quickstart), end to end on QA:
//! echo → open a subaccount → fund it → list markets → rest an order far from the market,
//! then confirm it through the private stream and cancel it.
//!
//!   NOVIG_KEY_ID=<management key id> NOVIG_PEM=path/to/management.pem \
//!     cargo run --example quickstart
//!
//! The subaccount's new trading key is written to `.novig/subaccount-<id>.pem` (gitignored).

use anyhow::Context;
use novig_v3::client::CatalogFilter;
use novig_v3::types::*;
use novig_v3::ws::{self, OrderEvent, Selection, WsConfig, WsEvent};
use novig_v3::{Algorithm, Client, Credentials, Environment, PrivateKey};
use std::time::Duration;
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let env = Environment::from_name(&std::env::var("NOVIG_ENV").unwrap_or_else(|_| "qa".into()));
    let key_id = std::env::var("NOVIG_KEY_ID").context("set NOVIG_KEY_ID to your management key id")?;
    let pem = std::fs::read_to_string(std::env::var("NOVIG_PEM").context("set NOVIG_PEM to the management key's .pem")?)?;
    let management = Client::new(env.clone(), Credentials::from_pem(key_id, &pem)?)
        .on_request(|r| println!("  {} {}{} → {} in {} ms", r.method, r.path, if r.query.is_empty() { String::new() } else { format!("?{}", r.query) }, r.status, r.millis));

    println!("1. echo (proves the signer)");
    management.echo(&serde_json::json!({ "hello": "novig" })).await?;

    println!("2. open a subaccount with a fresh Ed25519 trading key");
    let trading_key = PrivateKey::generate(Algorithm::Ed25519);
    let sub = management
        .open_subaccount(&OpenSubaccount { label: format!("quickstart-{}", &Uuid::new_v4().to_string()[..8]), public_key: trading_key.public_key().to_spki_pem(), algorithm: Algorithm::Ed25519, expires_at: None })
        .await?;
    std::fs::create_dir_all(".novig")?;
    std::fs::write(format!(".novig/subaccount-{}.pem", sub.key_id), trading_key.to_pkcs8_pem())?;
    println!("   subaccount {} (key saved to .novig/)", sub.key_id);

    println!("3. fund it with $10 (idempotent transfer id)");
    let t = management.transfer(sub.key_id, &TransferRequest { direction: TransferDirection::Fund, amount: "10".parse()?, client_transfer_id: Some(Uuid::new_v4().to_string()) }).await?;
    println!("   transfer {} is {:?}", t.transfer_id, t.status);

    let trading = Client::new(env.clone(), Credentials::new(sub.key_id.to_string(), trading_key.clone()));
    println!("4. list markets with the trading key");
    let markets = trading.markets(&CatalogFilter { limit: Some(20), ..Default::default() }).await?;
    let market = markets.items.iter().find(|m| m.status == MarketStatus::Open).context("no open markets on QA right now")?;
    let outcome = &market.outcomes[0];
    println!("   {} / {}", market.description, outcome.name);

    // Watch the private stream so we confirm the order the right way: by its `open` event.
    let (stream, mut events) = ws::connect(WsConfig::new(env.ws_url(), Some(Credentials::new(sub.key_id.to_string(), trading_key))));
    stream.subscribe(Selection::private(&["orders"]));
    // Wait for the subscription's snapshot before placing, or the `open` can land before we're listening.
    tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(ev) = events.recv().await {
            if matches!(ev, WsEvent::OrdersSnapshot { .. }) { return; }
        }
    })
    .await
    .context("private stream never sent its snapshot")?;

    println!("5. rest 100 contracts at 0.010 (far from any fill), post-only");
    let client_id = Uuid::new_v4();
    let accepted = trading.place_order(&PlaceOrder { outcome_id: outcome.outcome_id, price: "0.010".parse()?, qty: 100, tif: TimeInForce::PO, ttl: None, client_id: Some(client_id) }).await?;
    println!("   201 queued as {} (not yet confirmed)", accepted.order_id);

    let confirmed = tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(ev) = events.recv().await {
            if let WsEvent::OrdersSnapshot { open, .. } = &ev {
                if open.iter().any(|o| o.order_id == accepted.order_id) { return Ok("open"); }
            }
            if let WsEvent::Orders { events, .. } = &ev {
                for e in events {
                    match e {
                        OrderEvent::Open { order_id, .. } if *order_id == accepted.order_id => return Ok("open"),
                        OrderEvent::Reject { order_id } if *order_id == accepted.order_id => return Ok("reject"),
                        _ => {}
                    }
                }
            }
        }
        anyhow::bail!("stream closed")
    })
    .await;
    match confirmed {
        Ok(Ok(kind)) => println!("   private stream says: {kind}"),
        _ => println!("   no private event within 10 s; GET /v3/orders/{{id}} says {:?}", trading.order(accepted.order_id).await?.status),
    }

    println!("   cleaning up: cancel");
    trading.cancel_order(accepted.order_id).await?;
    let gone = tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(ev) = events.recv().await {
            if let WsEvent::Orders { events, .. } = &ev {
                if events.iter().any(|e| matches!(e, OrderEvent::Cancel { order_id, .. } if *order_id == accepted.order_id)) { return true; }
            }
        }
        false
    })
    .await
    .unwrap_or(false);
    if gone { println!("   private stream says: cancel"); } else { println!("   GET /v3/orders/{{id}} says {:?}", trading.order(accepted.order_id).await?.status); }
    stream.close();
    println!("done.");
    Ok(())
}
