//! A local stand-in for Novig's `/v3/ws`, speaking the documented protocol, for tests and demos.
//!
//! It runs one synthetic two-outcome market whose book moves every tick (adds, cancels, fills),
//! and it can misbehave on purpose so a client's recovery can be watched:
//! - `drop_every`: silently skip one book `seq` every N ticks (a gap)
//! - `golive_every`: send `GOLIVE`, which voids every resting order (a `remove`/`cancel` per order)
//! It verifies the NOVIG-V3 upgrade signature when given the key's public half.

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::{self, handshake::server::{ErrorResponse, Request, Response}};
use uuid::Uuid;

use crate::sign::{self, PublicKey};
use crate::types::Price;

#[derive(Clone)]
pub struct MockConfig {
    pub tick: Duration,
    pub drop_every: Option<u64>,
    pub golive_every: Option<u64>,
    pub heartbeat: Duration,
    /// When set, the upgrade must carry a valid NOVIG-V3 signature from this key.
    pub verify_with: Option<PublicKey>,
    pub seed: u64,
}

impl Default for MockConfig {
    fn default() -> Self {
        Self { tick: Duration::from_millis(250), drop_every: Some(40), golive_every: Some(300), heartbeat: Duration::from_secs(15), verify_with: None, seed: 7 }
    }
}

/// Ids of the synthetic market, so a client knows what to subscribe to.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct MockMarket {
    pub market_id: Uuid,
    pub event_id: Uuid,
    pub home: Uuid,
    pub away: Uuid,
}

impl MockMarket {
    pub fn fixed() -> Self {
        Self {
            market_id: Uuid::from_u128(0x0199_0000_0000_7000_8000_0000_0000_0001),
            event_id: Uuid::from_u128(0x0199_0000_0000_7000_8000_0000_0000_0002),
            home: Uuid::from_u128(0x0199_0000_0000_7000_8000_0000_0000_00a1),
            away: Uuid::from_u128(0x0199_0000_0000_7000_8000_0000_0000_00b2),
        }
    }
}

#[derive(Clone, Debug)]
struct Resting {
    id: Uuid,
    price: u16,
    qty: i32,
}

/// Exchange state shared by every connection.
struct Exchange {
    m: MockMarket,
    book_seq: i64,
    trades_seq: i64,
    life_seq: i64,
    ladders: BTreeMap<Uuid, Vec<Resting>>,
    recent_trades: Vec<Value>,
    mid: f64,
    tick: u64,
    rng: u64,
    next_id: u128,
}

impl Exchange {
    fn new(seed: u64) -> Self {
        let m = MockMarket::fixed();
        let mut ladders = BTreeMap::new();
        ladders.insert(m.home, vec![]);
        ladders.insert(m.away, vec![]);
        let mut x = Self { m, book_seq: 0, trades_seq: 0, life_seq: 1, ladders, recent_trades: vec![], mid: 0.56, tick: 0, rng: seed | 1, next_id: 1, };
        for _ in 0..30 {
            x.random_add();
        }
        x.book_seq = 100;
        x
    }

    fn rand(&mut self) -> u64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        self.rng
    }

    fn id(&mut self) -> Uuid {
        self.next_id += 1;
        Uuid::from_u128(0x0199_1111_0000_7000_8000_0000_0000_0000 | self.next_id)
    }

    fn random_add(&mut self) -> Value {
        let home_side = self.rand() % 2 == 0;
        let outcome = if home_side { self.m.home } else { self.m.away };
        let fair = if home_side { self.mid } else { 1.0 - self.mid };
        let depth_ticks = (self.rand() % 8) as f64;
        let milli = ((fair - 0.005 - depth_ticks * 0.005) * 1000.0).round().clamp(55.0, 945.0) as u16;
        let price = Price::snap_down(milli).unwrap().milli();
        let qty = [100, 250, 500, 1000, 2500, 10_000][(self.rand() % 6) as usize];
        let id = self.id();
        let ladder = self.ladders.get_mut(&outcome).unwrap();
        let pos = ladder.partition_point(|o| o.price >= price);
        ladder.insert(pos, Resting { id, price, qty });
        json!({"kind":"add","order":id,"outcome":outcome,"price":fmt(price),"qty":qty})
    }

    /// One tick of market activity: returns (book deltas, trade prints, lifecycle transitions).
    fn step(&mut self, golive: bool) -> (Vec<Value>, Vec<Value>, Vec<&'static str>) {
        self.tick += 1;
        // Fair value is sticky: it moves one tick about one step in six.
        if self.rand() % 6 == 0 {
            let up = self.rand() % 2 == 0;
            self.mid = (self.mid + if up { 0.005 } else { -0.005 }).clamp(0.2, 0.8);
        }
        let mut deltas = vec![];
        let mut prints = vec![];
        if golive {
            // GOLIVE voids every resting order.
            for (_, ladder) in self.ladders.iter_mut() {
                for o in ladder.drain(..) {
                    deltas.push(json!({"kind":"remove","order":o.id,"reason":"cancel"}));
                }
            }
            return (deltas, prints, vec!["GOLIVE"]);
        }
        for _ in 0..(self.rand() % 3 + 1) {
            deltas.push(self.random_add());
        }
        // Cancel something deep, or a stale order the fair value has moved away from.
        if self.rand() % 2 == 0 {
            let outcome = if self.rand() % 2 == 0 { self.m.home } else { self.m.away };
            let ladder = self.ladders.get_mut(&outcome).unwrap();
            if ladder.len() > 12 {
                let o = ladder.pop().unwrap();
                deltas.push(json!({"kind":"remove","order":o.id,"reason":"cancel"}));
            }
        }
        // A taker buys one outcome, which trades against the other outcome's best bids,
        // walking down the queue (and through levels) until its size is done.
        if self.rand() % 2 == 0 {
            let outcome = if self.rand() % 2 == 0 { self.m.home } else { self.m.away };
            let mut size = [100, 250, 500, 1000, 2500, 6000][(self.rand() % 6) as usize];
            let ts = sign::now_millis();
            let ladder = self.ladders.get_mut(&outcome).unwrap();
            while size > 0 && !ladder.is_empty() {
                let best = &mut ladder[0];
                let traded = size.min(best.qty);
                size -= traded;
                deltas.push(json!({"kind":"remove","order":best.id,"reason":"fill"}));
                prints.push(json!({"outcome":outcome,"price":fmt(best.price),"qty":traded,"ts":ts}));
                best.qty -= traded;
                if best.qty > 0 {
                    deltas.push(json!({"kind":"add","order":best.id,"outcome":outcome,"price":fmt(best.price),"qty":best.qty}));
                } else {
                    ladder.remove(0);
                }
            }
        }
        (deltas, prints, vec![])
    }

    fn book_json(&self) -> Value {
        let orders: serde_json::Map<String, Value> = self
            .ladders
            .iter()
            .map(|(o, l)| (o.to_string(), json!(l.iter().map(|r| json!({"order":r.id,"price":fmt(r.price),"qty":r.qty})).collect::<Vec<_>>())))
            .collect();
        json!({"seq": self.book_seq, "orders": orders})
    }

    fn market_snapshot(&self, channel: &str) -> Value {
        let mut body = json!({"eventId": self.m.event_id, "lifecycle": {"seq": self.life_seq, "status": "OPEN"}});
        match channel {
            "book" => body["book"] = self.book_json(),
            "trades" => body["trades"] = json!({"seq": self.trades_seq, "trades": self.recent_trades}),
            _ => {}
        }
        json!({ self.m.market_id.to_string(): body })
    }
}

fn fmt(milli: u16) -> String {
    format!("0.{milli:03}")
}

pub struct MockHandle {
    pub addr: SocketAddr,
    pub market: MockMarket,
    pub connections: Arc<AtomicU64>,
    kill: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    ex: Arc<Mutex<Exchange>>,
    drop_every: Arc<AtomicU64>,
}

impl MockHandle {
    pub fn url(&self) -> String {
        format!("ws://{}/v3/ws", self.addr)
    }
    /// Drops every open connection without a close frame (the client sees 1006).
    pub fn kill_connections(&self) {
        self.kill.store(true, Ordering::SeqCst);
    }
    /// Stops the engine after one last frame that is never dropped, so every client can notice
    /// any earlier gap and converge.
    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
    }
    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
    }
    /// Changes how often a frame is lost (0 = never), live.
    pub fn set_drop_every(&self, n: u64) {
        self.drop_every.store(n, Ordering::SeqCst);
    }
    pub fn drop_every(&self) -> u64 {
        self.drop_every.load(Ordering::SeqCst)
    }
    /// The exchange's own book, in the REST snapshot shape, for comparing against a client.
    pub async fn book(&self) -> crate::types::BookSnapshot {
        let x = self.ex.lock().await;
        crate::types::BookSnapshot {
            market_id: x.m.market_id,
            seq: x.book_seq,
            orders: x.ladders.iter().filter(|(_, l)| !l.is_empty()).map(|(o, l)| (*o, l.iter().map(|r| crate::types::RestingOrder { order_id: r.id, price: Price::from_milli(r.price).unwrap(), qty: r.qty }).collect())).collect(),
        }
    }
}

/// Starts the mock on `addr` (use `127.0.0.1:0` for a random port).
pub async fn serve(addr: &str, cfg: MockConfig) -> anyhow::Result<MockHandle> {
    let listener = TcpListener::bind(addr).await?;
    let addr = listener.local_addr()?;
    let ex = Arc::new(Mutex::new(Exchange::new(cfg.seed)));
    let connections = Arc::new(AtomicU64::new(0));
    let kill = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let drop_every = Arc::new(AtomicU64::new(cfg.drop_every.unwrap_or(0)));
    let market = ex.lock().await.m;

    // One engine clock for everyone; each connection gets the resulting frames via broadcast.
    let (tx, _) = tokio::sync::broadcast::channel::<(i64, Value, bool)>(4096);
    {
        let (ex, tx, cfg, paused) = (ex.clone(), tx.clone(), cfg.clone(), paused.clone());
        tokio::spawn(async move {
            let mut every = tokio::time::interval(cfg.tick);
            let mut flushed = false;
            loop {
                every.tick().await;
                let droppable = if paused.load(Ordering::SeqCst) {
                    if flushed { continue; }
                    flushed = true;
                    false
                } else {
                    flushed = false;
                    true
                };
                let mut x = ex.lock().await;
                let golive = droppable && cfg.golive_every.is_some_and(|n| x.tick > 0 && (x.tick + 1) % n == 0);
                let (deltas, prints, life) = x.step(golive);
                let mid = x.m.market_id.to_string();
                let eid = x.m.event_id;
                let mut body = json!({"eventId": eid});
                if !deltas.is_empty() {
                    x.book_seq += 1;
                    body["book"] = json!({"seq": x.book_seq, "deltas": deltas});
                }
                if !prints.is_empty() {
                    x.trades_seq += 1;
                    let batch = json!({"seq": x.trades_seq, "deltas": prints});
                    x.recent_trades.push(batch.clone());
                    if x.recent_trades.len() > 5 {
                        x.recent_trades.remove(0);
                    }
                    body["trades"] = batch;
                }
                if !life.is_empty() {
                    x.life_seq += 1;
                    body["lifecycle"] = json!({"seq": x.life_seq, "deltas": life});
                }
                let tick = x.tick as i64;
                drop(x);
                let _ = tx.send((tick, json!({"ts": sign::now_millis(), "delta": { mid: body }}), droppable));
            }
        });
    }

    {
        let (ex, connections, kill, cfg, drop_every) = (ex.clone(), connections.clone(), kill.clone(), cfg.clone(), drop_every.clone());
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let (ex, tx, connections, kill, cfg, drop_every) = (ex.clone(), tx.clone(), connections.clone(), kill.clone(), cfg.clone(), drop_every.clone());
                tokio::spawn(async move {
                    let verify = cfg.verify_with.clone();
                    let check = move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
                        let Some(pk) = &verify else { return Ok(resp) };
                        match verify_upgrade(req, pk) {
                            Ok(()) => Ok(resp),
                            Err(msg) => {
                                let body = json!({"code":"SIGNATURE_REJECTED","message":msg}).to_string();
                                Err(tungstenite::http::Response::builder().status(401).body(Some(body)).unwrap())
                            }
                        }
                    };
                    let Ok(ws) = tokio_tungstenite::accept_hdr_async(stream, check).await else { return };
                    connections.fetch_add(1, Ordering::SeqCst);
                    kill.store(false, Ordering::SeqCst);
                    let _ = session(ws, ex, tx.subscribe(), kill, cfg, drop_every).await;
                });
            }
        });
    }
    Ok(MockHandle { addr, market, connections, kill, paused, ex, drop_every })
}

fn verify_upgrade(req: &Request, pk: &PublicKey) -> Result<(), String> {
    let h = |n: &str| req.headers().get(n).and_then(|v| v.to_str().ok()).map(str::to_string);
    let key = h(sign::KEY_ID_HEADER).ok_or("novig-key-id header is required")?;
    let ts = h(sign::TIMESTAMP_HEADER).ok_or("novig-timestamp header is required")?;
    let sig = h(sign::SIGNATURE_HEADER).ok_or("novig-signature header is required")?;
    let _ = key;
    let ts: i64 = ts.parse().map_err(|_| "malformed timestamp")?;
    if (sign::now_millis() - ts).abs() > sign::MAX_SKEW_MS {
        return Err("timestamp outside ±30 s".into());
    }
    let s = sign::string_to_sign(ts, req.method().as_str(), req.uri().path(), req.uri().query().unwrap_or(""), b"");
    pk.verify(&s, &sig).map_err(|_| "signature does not verify".to_string())
}

async fn session(
    ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    ex: Arc<Mutex<Exchange>>,
    mut feed: tokio::sync::broadcast::Receiver<(i64, Value, bool)>,
    kill: Arc<AtomicBool>,
    cfg: MockConfig,
    drop_every: Arc<AtomicU64>,
) -> anyhow::Result<()> {
    let (mut sink, mut stream) = ws.split();
    let mut last_nonce = 0i64;
    let mut subscribed: Option<String> = None;
    let mut private: Vec<String> = vec![];
    let mut hb = tokio::time::interval(cfg.heartbeat);
    hb.tick().await;
    let mut kill_check = tokio::time::interval(Duration::from_millis(100));
    loop {
        tokio::select! {
            _ = kill_check.tick() => if kill.load(Ordering::SeqCst) { return Ok(()) },
            _ = hb.tick() => {
                sink.send(tungstenite::Message::Ping(Vec::new().into())).await?;
                if private.contains(&"orders".to_string()) {
                    sink.send(tungstenite::Message::Text(json!({"heartbeat": {"orders": 0, "ts": sign::now_millis()}}).to_string().into())).await?;
                }
            }
            frame = feed.recv() => {
                let Ok((tick, mut frame, droppable)) = frame else { continue };
                let Some(ch) = &subscribed else { continue };
                // Each channel carries itself plus lifecycle, nothing else.
                if let Some(d) = frame["delta"].as_object_mut() {
                    for (_, b) in d.iter_mut() {
                        if let Some(o) = b.as_object_mut() { o.retain(|k, _| k == "eventId" || k == "lifecycle" || k == ch); }
                    }
                }
                let has_payload = frame["delta"].as_object().is_some_and(|d| d.values().any(|b| b.as_object().is_some_and(|o| o.len() > 1)));
                if !has_payload { continue; }
                // Misbehave on purpose: lose one frame now and then.
                let n = drop_every.load(Ordering::SeqCst);
                if droppable && n > 0 && tick as u64 % n == 0 { continue; }
                sink.send(tungstenite::Message::Text(frame.to_string().into())).await?;
            }
            msg = stream.next() => {
                let Some(msg) = msg else { return Ok(()) };
                let text = match msg? { tungstenite::Message::Text(t) => t.to_string(), tungstenite::Message::Close(_) => return Ok(()), _ => continue };
                let Ok(v) = serde_json::from_str::<Value>(&text) else {
                    sink.send(tungstenite::Message::Text(json!({"code":"BAD_FRAME","message":"frame is not JSON"}).to_string().into())).await?;
                    continue;
                };
                let nonce = v["nonce"].as_i64().unwrap_or(0);
                if nonce <= last_nonce {
                    sink.send(tungstenite::Message::Text(json!({"nonce":nonce,"code":"STALE_NONCE","message":"nonce must increase"}).to_string().into())).await?;
                    continue;
                }
                last_nonce = nonce;
                let x = ex.lock().await;
                let mid = x.m.market_id;
                let reply = if let Some(sel) = v.get("subscribe").or(v.get("snapshot")) {
                    let is_sub = v.get("subscribe").is_some();
                    let mut snap = json!({});
                    if let Some(ch) = sel["markets"].get(mid.to_string()).and_then(Value::as_str) {
                        if is_sub { subscribed = Some(ch.to_string()); }
                        snap = x.market_snapshot(ch);
                    }
                    let mut out = json!({"ts": sign::now_millis(), "nonce": nonce, "snapshot": snap});
                    if let Some(p) = sel["private"].as_array() {
                        for ch in p.iter().filter_map(Value::as_str) {
                            if is_sub && !private.contains(&ch.to_string()) { private.push(ch.to_string()); }
                            if ch == "orders" { out["orders"] = json!({"seq": 0, "open": []}); }
                            if ch == "positions" { out["positions"] = json!({"seq": 0, "positions": []}); }
                        }
                    }
                    if is_sub { out["subscribed"] = json!({"markets": sel.get("markets").cloned().unwrap_or(json!({})), "events": {}, "private": private}); }
                    out
                } else if let Some(subjects) = v.get("unsubscribe") {
                    if subjects.as_array().is_some_and(|a| a.iter().any(|s| s.as_str() == Some(&format!("market:{mid}")))) { subscribed = None; }
                    json!({"nonce": nonce, "unsubscribed": subjects})
                } else if v.get("status").is_some() {
                    json!({"nonce": nonce, "status": {"markets": subscribed.as_ref().map(|c| json!({mid.to_string(): c})).unwrap_or(json!({})), "private": private}})
                } else {
                    json!({"nonce": nonce, "code": "UNKNOWN_VERB", "message": "expected subscribe, unsubscribe, snapshot, status"})
                };
                drop(x);
                sink.send(tungstenite::Message::Text(reply.to_string().into())).await?;
            }
        }
    }
}
