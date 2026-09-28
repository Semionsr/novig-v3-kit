//! One websocket for every channel (docs.novig.com/api/streaming/connection).
//!
//! [`connect`] spawns a task that owns the socket and handles everything the docs ask a
//! client to handle:
//! - the signed upgrade (`GET /v3/ws`, NOVIG-V3 headers) and the 32-token upgrade cost
//! - nonces: start at 1, strictly increasing per connection
//! - per-subject `seq` tracking with [`Sequencer`]: on a gap it buffers, sends `snapshot`
//!   for just that subject, drops what the snapshot covers and replays the rest
//! - private heartbeats: a heartbeat `seq` above ours means a dropped `orders`/`positions` frame
//! - `SLOW_CONSUMER` / geolocation closes and silent drops: reconnect with backoff, subscribe
//!   again, and never compare a `seq` across connections
//! - `stream` throttle weights (book 16, bbo 8, trades 4, lifecycle 1 per pair)
//!
//! You get a [`WsHandle`] to send verbs and a channel of [`WsEvent`]s, with live [`Book`]s kept
//! for every market subscribed on `book`.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{self, client::IntoClientRequest, protocol::frame::coding::CloseCode};
use uuid::Uuid;

use crate::book::{Book, BookDelta, Level, Quote, Removal};
use crate::seq::{SeqStats, Sequencer, Step};
use crate::sign::Credentials;
use crate::throttle::{Bucket, Cost, Throttler, ws_weight};
use crate::types::{OpenOrder, Position, Price, TimeInForce};

/// What to subscribe to. Channel names: `lifecycle`, `trades`, `bbo`, `book` for markets and
/// events; `orders`, `positions` for private.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Selection {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub markets: BTreeMap<Uuid, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub events: BTreeMap<Uuid, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub private: Vec<String>,
}

impl Selection {
    pub fn market(id: Uuid, channel: &str) -> Self {
        let mut s = Self::default();
        s.markets.insert(id, channel.into());
        s
    }
    pub fn private(channels: &[&str]) -> Self {
        Self { private: channels.iter().map(|c| c.to_string()).collect(), ..Default::default() }
    }
    pub fn is_empty(&self) -> bool {
        self.markets.is_empty() && self.events.is_empty() && self.private.is_empty()
    }
    /// Tokens this costs on the `stream` throttle.
    pub fn weight(&self) -> u32 {
        self.markets.values().chain(self.events.values()).map(|c| ws_weight::channel(c)).sum::<u32>()
            + self.private.iter().map(|c| ws_weight::channel(c)).sum::<u32>()
    }
    fn merge(&mut self, other: &Selection) {
        self.markets.extend(other.markets.clone());
        self.events.extend(other.events.clone());
        for p in &other.private {
            if !self.private.contains(p) {
                self.private.push(p.clone());
            }
        }
    }
}

/// Events from the private `orders` channel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum OrderEvent {
    /// The order rests. This, not the `201`, confirms it.
    Open {
        #[serde(rename = "orderId")]
        order_id: Uuid,
        #[serde(rename = "clientId", default, skip_serializing_if = "Option::is_none")]
        client_id: Option<Uuid>,
        #[serde(rename = "marketId")]
        market_id: Uuid,
        #[serde(rename = "outcomeId")]
        outcome_id: Uuid,
        price: Price,
        qty: i32,
        tif: TimeInForce,
        #[serde(rename = "expiresAt", default, skip_serializing_if = "Option::is_none")]
        expires_at: Option<i64>,
    },
    Fill {
        #[serde(rename = "orderId")]
        order_id: Uuid,
        #[serde(rename = "clientId", default, skip_serializing_if = "Option::is_none")]
        client_id: Option<Uuid>,
        #[serde(rename = "outcomeId")]
        outcome_id: Uuid,
        price: Price,
        qty: i32,
        remaining: i32,
    },
    /// `reason` is `GO_LIVE`, `MARKET_CLOSED`, `SETTLED` or `NEUTRALIZED` when the engine gives one.
    Cancel {
        #[serde(rename = "orderId")]
        order_id: Uuid,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// Accepted, then refused. No HTTP status reports this. Unfilled IOC/FOK/PO land here too.
    Reject {
        #[serde(rename = "orderId")]
        order_id: Uuid,
    },
}

/// Top of book for the UI: levels per outcome plus the derived quote.
#[derive(Debug, Clone, Serialize)]
pub struct BookView {
    pub market_id: Uuid,
    pub seq: i64,
    pub orders: usize,
    pub outcomes: Vec<OutcomeView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OutcomeView {
    pub outcome_id: Uuid,
    pub quote: Quote,
    pub levels: Vec<Level>,
}

impl BookView {
    pub fn of(market_id: Uuid, book: &Book, depth: usize) -> Self {
        Self {
            market_id,
            seq: book.seq,
            orders: book.order_count(),
            outcomes: book.outcomes().map(|o| OutcomeView { outcome_id: *o, quote: book.quote(o), levels: book.levels(o, depth) }).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradePrint {
    pub outcome: Uuid,
    pub price: Price,
    pub qty: i32,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsEvent {
    Connected { url: String, connection: u64 },
    Disconnected { reason: String, code: Option<u16>, retry_in_ms: u64 },
    Subscribed { nonce: Option<i64>, subscribed: Value },
    Book { view: BookView },
    /// Orders that left the book in one applied batch (fills and cancels), with where they
    /// rested. Emitted before the matching `Book` view.
    Removals { market_id: Uuid, seq: i64, removals: Vec<Removal> },
    /// A fresh full book (initial or after a resync): anything derived from deltas should rebase.
    BookReset { market_id: Uuid, seq: i64 },
    Trades { market_id: Uuid, seq: i64, trades: Vec<TradePrint> },
    Lifecycle { market_id: Uuid, seq: i64, status: Option<String>, transitions: Vec<String> },
    Bbo { market_id: Uuid, seq: i64, data: Value },
    Orders { seq: i64, events: Vec<OrderEvent> },
    OrdersSnapshot { seq: i64, open: Vec<OpenOrder> },
    Positions { seq: i64, positions: Vec<Position> },
    Gap { subject: String, missing: i64, got: i64 },
    Resynced { subject: String, seq: i64, replayed: usize },
    Heartbeat { ts: Option<i64>, private: BTreeMap<String, i64> },
    ServerError { code: String, message: String, nonce: Option<i64> },
    Ack { nonce: Option<i64>, body: Value },
}

enum Command {
    Send { verb: &'static str, payload: Value, weight: u32, remember: Option<Selection>, forget: Vec<String> },
    Close,
}

/// Live counters for the console's Connection screen.
#[derive(Debug, Clone, Default, Serialize)]
pub struct WsStats {
    pub connected: bool,
    pub connection: u64,
    pub reconnects: u64,
    pub nonce: i64,
    pub messages: u64,
    pub bytes: u64,
    pub gaps: u64,
    pub resyncs: u64,
    pub server_errors: u64,
    pub last_message_ts: Option<i64>,
    pub last_heartbeat_ts: Option<i64>,
    pub subscribed_weight: u32,
    pub queued_verbs: usize,
    pub watched_markets: usize,
    pub subjects: BTreeMap<String, SeqStats>,
}

#[derive(Clone)]
pub struct WsHandle {
    tx: mpsc::UnboundedSender<Command>,
    books: Arc<Mutex<HashMap<Uuid, Book>>>,
    stats: Arc<Mutex<WsStats>>,
}

impl WsHandle {
    pub fn subscribe(&self, sel: Selection) {
        let weight = sel.weight();
        let payload = serde_json::to_value(&sel).unwrap();
        let _ = self.tx.send(Command::Send { verb: "subscribe", payload, weight, remember: Some(sel), forget: vec![] });
    }
    /// Subjects look like `market:<id>`, `event:<id>`, or `PRIVATE`.
    pub fn unsubscribe(&self, subjects: Vec<String>) {
        let weight = subjects.len() as u32;
        let _ = self.tx.send(Command::Send { verb: "unsubscribe", payload: json!(subjects), weight, remember: None, forget: subjects });
    }
    pub fn snapshot(&self, sel: Selection) {
        let weight = sel.weight();
        let _ = self.tx.send(Command::Send { verb: "snapshot", payload: serde_json::to_value(&sel).unwrap(), weight, remember: None, forget: vec![] });
    }
    pub fn status(&self) {
        let _ = self.tx.send(Command::Send { verb: "status", payload: json!({}), weight: 1, remember: None, forget: vec![] });
    }
    pub fn close(&self) {
        let _ = self.tx.send(Command::Close);
    }
    pub fn book(&self, market: &Uuid) -> Option<Book> {
        self.books.lock().unwrap().get(market).cloned()
    }
    pub fn stats(&self) -> WsStats {
        self.stats.lock().unwrap().clone()
    }
}

#[derive(Clone)]
pub struct WsConfig {
    pub url: String,
    /// `None` only for a local mock exchange; Novig requires a signed upgrade.
    pub credentials: Option<Credentials>,
    pub throttle: Arc<Throttler>,
    pub book_depth: usize,
    /// Drop the socket if nothing arrives for this long (Novig pings every 15 s).
    pub idle_timeout: Duration,
}

impl WsConfig {
    pub fn new(url: impl Into<String>, credentials: Option<Credentials>) -> Self {
        Self { url: url.into(), credentials, throttle: Arc::new(Throttler::default()), book_depth: 10, idle_timeout: Duration::from_secs(40) }
    }
}

pub fn connect(cfg: WsConfig) -> (WsHandle, mpsc::UnboundedReceiver<WsEvent>) {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
    let (ev_tx, ev_rx) = mpsc::unbounded_channel();
    let books = Arc::new(Mutex::new(HashMap::new()));
    let stats = Arc::new(Mutex::new(WsStats::default()));
    let handle = WsHandle { tx: cmd_tx, books: books.clone(), stats: stats.clone() };
    tokio::spawn(run(cfg, cmd_rx, ev_tx, books, stats));
    (handle, ev_rx)
}

/// Subject key for sequencing: `market:<id>:<channel>` or `private:<channel>`.
fn market_subject(id: &Uuid, channel: &str) -> String {
    format!("market:{id}:{channel}")
}

struct Session {
    cfg: WsConfig,
    ev: mpsc::UnboundedSender<WsEvent>,
    books: Arc<Mutex<HashMap<Uuid, Book>>>,
    stats: Arc<Mutex<WsStats>>,
    seqs: HashMap<String, Sequencer<Value>>,
    nonce: i64,
    /// Everything we want subscribed; replayed after every reconnect.
    desired: Selection,
    /// Verbs waiting for `stream` tokens. The read loop never blocks on the throttle: a client
    /// that stops reading gets closed with SLOW_CONSUMER.
    outbox: std::collections::VecDeque<(&'static str, Value, u32)>,
}

async fn run(cfg: WsConfig, mut cmds: mpsc::UnboundedReceiver<Command>, ev: mpsc::UnboundedSender<WsEvent>, books: Arc<Mutex<HashMap<Uuid, Book>>>, stats: Arc<Mutex<WsStats>>) {
    let mut s = Session { cfg, ev, books, stats, seqs: HashMap::new(), nonce: 0, desired: Selection::default(), outbox: Default::default() };
    let mut backoff = Duration::from_millis(500);
    let mut connection = 0u64;
    let mut pending: Vec<Command> = vec![];
    loop {
        connection += 1;
        match s.connect_once(connection, &mut cmds, &mut pending).await {
            Ok(Exit::Closed) => return,
            Ok(Exit::Dropped { reason, code }) | Err(DropErr { reason, code }) => {
                {
                    let mut st = s.stats.lock().unwrap();
                    st.connected = false;
                    st.reconnects += 1;
                }
                let _ = s.ev.send(WsEvent::Disconnected { reason, code, retry_in_ms: backoff.as_millis() as u64 });
                // Drain commands while waiting so subscriptions made offline aren't lost.
                let deadline = tokio::time::sleep(backoff);
                tokio::pin!(deadline);
                loop {
                    tokio::select! {
                        _ = &mut deadline => break,
                        c = cmds.recv() => match c {
                            None | Some(Command::Close) => return,
                            Some(c) => pending.push(c),
                        }
                    }
                }
                backoff = (backoff * 2).min(Duration::from_secs(10));
            }
        }
        // seq values from the old connection mean nothing now, and queued verbs are replaced
        // by the full re-subscribe on the next connection.
        s.seqs.clear();
        s.outbox.clear();
    }
}

enum Exit {
    Closed,
    Dropped { reason: String, code: Option<u16> },
}

struct DropErr {
    reason: String,
    code: Option<u16>,
}

impl<E: std::fmt::Display> From<E> for DropErr {
    fn from(e: E) -> Self {
        DropErr { reason: e.to_string(), code: None }
    }
}

impl Session {
    async fn connect_once(&mut self, connection: u64, cmds: &mut mpsc::UnboundedReceiver<Command>, pending: &mut Vec<Command>) -> Result<Exit, DropErr> {
        let mut request = self.cfg.url.as_str().into_client_request()?;
        if let Some(creds) = &self.cfg.credentials {
            let path = request.uri().path().to_string();
            let query = request.uri().query().unwrap_or("").to_string();
            let h = creds.sign("GET", &path, &query, b"");
            for (k, v) in h.pairs() {
                request.headers_mut().insert(k, v.parse()?);
            }
        }
        self.cfg.throttle.acquire(Cost::Tokens(Bucket::Stream, ws_weight::UPGRADE)).await;
        let (socket, _resp) = tokio_tungstenite::connect_async(request).await.map_err(|e| {
            let code = match &e {
                tungstenite::Error::Http(r) => Some(r.status().as_u16()),
                _ => None,
            };
            let body = match &e {
                tungstenite::Error::Http(r) => r.body().as_ref().map(|b| String::from_utf8_lossy(b).to_string()).unwrap_or_default(),
                _ => String::new(),
            };
            DropErr { reason: format!("{e} {body}").trim().to_string(), code }
        })?;
        let (mut sink, mut stream) = socket.split();
        self.nonce = 0;
        {
            let mut st = self.stats.lock().unwrap();
            st.connected = true;
            st.connection = connection;
            st.nonce = 0;
        }
        let _ = self.ev.send(WsEvent::Connected { url: self.cfg.url.clone(), connection });

        // Re-subscribe everything we had, then flush commands queued while offline.
        if !self.desired.is_empty() {
            let sel = self.desired.clone();
            for (id, ch) in &sel.markets {
                self.seqs.insert(market_subject(id, ch), Sequencer::new());
            }
            self.enqueue("subscribe", serde_json::to_value(&sel).unwrap(), sel.weight());
        }
        for c in pending.drain(..) {
            if let Some(exit) = self.handle_command(&mut sink, c).await? {
                return Ok(exit);
            }
        }

        let mut last_frame = tokio::time::Instant::now();
        loop {
            let idle = tokio::time::sleep_until(last_frame + self.cfg.idle_timeout);
            let wait = self.outbox.front().map(|(_, _, w)| self.cfg.throttle.try_peek(Cost::Tokens(Bucket::Stream, (*w).max(1))));
            let send_at = tokio::time::sleep(wait.unwrap_or(Duration::from_secs(3600)));
            tokio::select! {
                _ = idle => return Ok(Exit::Dropped { reason: "no frames or pings within the idle timeout".into(), code: None }),
                _ = send_at, if wait.is_some() => { self.flush_outbox(&mut sink).await?; }
                cmd = cmds.recv() => match cmd {
                    None => return Ok(Exit::Closed),
                    Some(c) => if let Some(exit) = self.handle_command(&mut sink, c).await? { return Ok(exit) },
                },
                msg = stream.next() => { last_frame = tokio::time::Instant::now(); match msg {
                    None => return Ok(Exit::Dropped { reason: "stream ended without a close frame".into(), code: Some(1006) }),
                    Some(Err(e)) => return Err(e.into()),
                    Some(Ok(tungstenite::Message::Ping(p))) => { sink.send(tungstenite::Message::Pong(p)).await?; }
                    Some(Ok(tungstenite::Message::Close(frame))) => {
                        let (code, reason) = frame.map(|f| (Some(u16::from(f.code)), f.reason.to_string())).unwrap_or((None, String::new()));
                        let why = match (code, reason.as_str()) {
                            (Some(1008), "SLOW_CONSUMER") => "SLOW_CONSUMER: a write to us stalled 15 s; reconnecting and taking fresh snapshots".to_string(),
                            (Some(1008), r) if r.contains("451") || r.to_ascii_uppercase().contains("GEO") => format!("geolocation refused ({r}): open the Novig app to refresh location, then reconnect"),
                            (_, r) => format!("closed: {r}"),
                        };
                        return Ok(Exit::Dropped { reason: why, code });
                    }
                    Some(Ok(tungstenite::Message::Text(text))) => {
                        {
                            let mut st = self.stats.lock().unwrap();
                            st.messages += 1;
                            st.bytes += text.len() as u64;
                            st.last_message_ts = Some(crate::sign::now_millis());
                        }
                        match serde_json::from_str::<Value>(&text) {
                            Ok(v) => {
                                for sel in self.on_message(v) {
                                    self.enqueue("snapshot", serde_json::to_value(&sel).unwrap(), sel.weight());
                                }
                                self.flush_outbox(&mut sink).await?;
                            }
                            Err(e) => tracing::warn!("unparseable frame: {e}"),
                        }
                        self.publish_seq_stats();
                    }
                    Some(Ok(_)) => {}
                }}
            }
        }
    }

    /// Queues a verb. A snapshot identical to one already waiting is merged into it.
    fn enqueue(&mut self, verb: &'static str, payload: Value, weight: u32) {
        if verb == "snapshot" && self.outbox.iter().any(|(v, p, _)| *v == "snapshot" && *p == payload) {
            return;
        }
        self.outbox.push_back((verb, payload, weight));
    }

    /// Sends queued verbs in order while the `stream` model has tokens; never waits.
    async fn flush_outbox<S>(&mut self, sink: &mut S) -> Result<(), DropErr>
    where
        S: futures_util::Sink<tungstenite::Message> + Unpin,
        S::Error: std::fmt::Display,
    {
        while let Some((_, _, w)) = self.outbox.front() {
            if !self.cfg.throttle.try_acquire(Cost::Tokens(Bucket::Stream, (*w).max(1))).is_zero() {
                break;
            }
            let (verb, payload, _) = self.outbox.pop_front().unwrap();
            self.nonce += 1;
            self.stats.lock().unwrap().nonce = self.nonce;
            let frame = json!({ "nonce": self.nonce, verb: payload });
            sink.send(tungstenite::Message::Text(frame.to_string().into())).await.map_err(|e| DropErr { reason: e.to_string(), code: None })?;
        }
        self.stats.lock().unwrap().queued_verbs = self.outbox.len();
        Ok(())
    }

    async fn handle_command<S>(&mut self, sink: &mut S, c: Command) -> Result<Option<Exit>, DropErr>
    where
        S: futures_util::Sink<tungstenite::Message> + Unpin,
        S::Error: std::fmt::Display,
    {
        match c {
            Command::Close => {
                let _ = sink.send(tungstenite::Message::Close(Some(tungstenite::protocol::CloseFrame { code: CloseCode::Normal, reason: "bye".into() }))).await;
                Ok(Some(Exit::Closed))
            }
            Command::Send { verb, payload, weight, remember, forget } => {
                if let Some(sel) = remember {
                    self.desired.merge(&sel);
                    // New subjects start life waiting for their snapshot.
                    for (id, ch) in &sel.markets {
                        self.seqs.insert(market_subject(id, ch), Sequencer::new());
                    }
                }
                for subject in &forget {
                    if subject == "PRIVATE" {
                        self.desired.private.clear();
                    } else if let Some(id) = subject.strip_prefix("market:").and_then(|s| s.parse::<Uuid>().ok()) {
                        self.desired.markets.remove(&id);
                        self.books.lock().unwrap().remove(&id);
                        self.seqs.retain(|k, _| !k.starts_with(subject.as_str()));
                    } else if let Some(id) = subject.strip_prefix("event:").and_then(|s| s.parse::<Uuid>().ok()) {
                        self.desired.events.remove(&id);
                    }
                }
                {
                    let mut st = self.stats.lock().unwrap();
                    st.subscribed_weight = self.desired.weight();
                    st.watched_markets = self.desired.markets.len();
                }
                self.enqueue(verb, payload, weight);
                self.flush_outbox(sink).await?;
                Ok(None)
            }
        }
    }

    /// Routes one frame. Returns the snapshot requests needed to heal gaps.
    fn on_message(&mut self, v: Value) -> Vec<Selection> {
        let mut heal: Vec<Selection> = vec![];
        let nonce = v.get("nonce").and_then(Value::as_i64);

        if let Some(code) = v.get("code").and_then(Value::as_str) {
            self.stats.lock().unwrap().server_errors += 1;
            let message = v.get("message").and_then(Value::as_str).unwrap_or("").to_string();
            let _ = self.ev.send(WsEvent::ServerError { code: code.to_string(), message, nonce });
            return heal;
        }
        if let Some(hb) = v.get("heartbeat") {
            let ts = hb.get("ts").and_then(Value::as_i64);
            let mut private = BTreeMap::new();
            for ch in ["orders", "positions"] {
                if let Some(server_seq) = hb.get(ch).and_then(Value::as_i64) {
                    private.insert(ch.to_string(), server_seq);
                    let subject = format!("private:{ch}");
                    let ours = self.seqs.get(&subject).and_then(|s| s.last_seq());
                    if let Some(ours) = ours {
                        if server_seq > ours && !self.seqs[&subject].awaiting_snapshot() {
                            // The heartbeat proves a frame was dropped even on a quiet channel.
                            self.seqs.get_mut(&subject).unwrap().reset();
                            self.bump_gap();
                            let _ = self.ev.send(WsEvent::Gap { subject, missing: ours + 1, got: server_seq });
                            heal.push(Selection::private(&[ch]));
                        }
                    }
                }
            }
            self.stats.lock().unwrap().last_heartbeat_ts = ts.or(Some(crate::sign::now_millis()));
            let _ = self.ev.send(WsEvent::Heartbeat { ts, private });
            return heal;
        }
        if let Some(sub) = v.get("subscribed") {
            let _ = self.ev.send(WsEvent::Subscribed { nonce, subscribed: sub.clone() });
        }

        // Snapshots: per market, then private.
        if let Some(snap) = v.get("snapshot").and_then(Value::as_object) {
            for (mid, body) in snap {
                let Ok(market_id) = mid.parse::<Uuid>() else { continue };
                for ch in ["book", "trades", "bbo", "lifecycle"] {
                    if let Some(chan) = body.get(ch) {
                        self.on_market_snapshot(market_id, ch, chan);
                    }
                }
            }
        }
        for ch in ["orders", "positions"] {
            if let Some(p) = v.get(ch) {
                if p.get("deltas").is_none() {
                    self.on_private_snapshot(ch, p);
                }
            }
        }

        // Deltas.
        if let Some(delta) = v.get("delta").and_then(Value::as_object) {
            for (mid, body) in delta {
                let Ok(market_id) = mid.parse::<Uuid>() else { continue };
                for ch in ["book", "trades", "bbo", "lifecycle"] {
                    if let Some(chan) = body.get(ch) {
                        if let Some(sel) = self.on_market_delta(market_id, ch, chan) {
                            heal.push(sel);
                        }
                    }
                }
            }
        }
        for ch in ["orders", "positions"] {
            if let Some(p) = v.get(ch) {
                if p.get("deltas").is_some() {
                    if let Some(sel) = self.on_private_delta(ch, p) {
                        heal.push(sel);
                    }
                }
            }
        }

        let known = ["nonce", "ts", "subscribed", "snapshot", "delta", "orders", "positions"];
        if v.as_object().is_some_and(|o| o.keys().any(|k| !known.contains(&k.as_str()))) {
            let _ = self.ev.send(WsEvent::Ack { nonce, body: v.clone() });
        }
        heal
    }

    fn on_market_snapshot(&mut self, market_id: Uuid, ch: &str, chan: &Value) {
        let seq = chan.get("seq").and_then(Value::as_i64).unwrap_or(0);
        let subject = market_subject(&market_id, ch);
        let seqr = self.seqs.entry(subject.clone()).or_default();
        let was_resync = seqr.last_seq().is_some() && seqr.awaiting_snapshot();
        let replay = seqr.snapshot(seq);
        match ch {
            "book" => {
                let orders = chan.get("orders").cloned().unwrap_or(json!({}));
                let orders = serde_json::from_value::<BTreeMap<Uuid, Vec<WireResting>>>(orders).unwrap_or_default();
                let orders = orders.into_iter().map(|(k, v)| (k, v.into_iter().map(Into::into).collect())).collect();
                let mut books = self.books.lock().unwrap();
                let book = books.entry(market_id).or_default();
                book.load(Some(market_id), seq, &orders);
                let _ = self.ev.send(WsEvent::BookReset { market_id, seq });
                for (s, batch) in &replay {
                    apply_book(book, *s, batch);
                }
                let _ = self.ev.send(WsEvent::Book { view: BookView::of(market_id, book, self.cfg.book_depth) });
            }
            "trades" => {
                let trades = chan.get("trades").and_then(Value::as_array).cloned().unwrap_or_default();
                let prints: Vec<TradePrint> = trades.iter().flat_map(|b| b.get("deltas").and_then(Value::as_array).cloned().unwrap_or_default()).filter_map(|d| serde_json::from_value(d).ok()).collect();
                let _ = self.ev.send(WsEvent::Trades { market_id, seq, trades: prints });
                for (s, batch) in &replay {
                    self.emit_market_delta(market_id, "trades", *s, batch);
                }
            }
            "lifecycle" => {
                let status = chan.get("status").and_then(Value::as_str).map(str::to_string);
                let _ = self.ev.send(WsEvent::Lifecycle { market_id, seq, status, transitions: vec![] });
                for (s, batch) in &replay {
                    self.emit_market_delta(market_id, "lifecycle", *s, batch);
                }
            }
            _ => {
                let _ = self.ev.send(WsEvent::Bbo { market_id, seq, data: chan.clone() });
            }
        }
        if was_resync {
            self.stats.lock().unwrap().resyncs += 1;
            let _ = self.ev.send(WsEvent::Resynced { subject, seq, replayed: replay.len() });
        }
    }

    fn on_market_delta(&mut self, market_id: Uuid, ch: &str, chan: &Value) -> Option<Selection> {
        let seq = chan.get("seq").and_then(Value::as_i64)?;
        let wanted = self.desired.markets.get(&market_id).map(String::as_str);
        if ch != "lifecycle" && wanted.is_some() && wanted != Some(ch) {
            return None; // not a channel we asked for on this market
        }
        let subject = market_subject(&market_id, ch);
        // A market that opens under an `events` subscription has no snapshot: it starts at seq 0.
        let seqr = self.seqs.entry(subject.clone()).or_insert_with(|| Sequencer::starting_at(0));
        match seqr.delta(seq, chan.clone()) {
            Step::Apply(batch) => {
                if ch == "book" {
                    let mut books = self.books.lock().unwrap();
                    let book = books.entry(market_id).or_default();
                    let removals = apply_book(book, seq, &batch);
                    if !removals.is_empty() {
                        let _ = self.ev.send(WsEvent::Removals { market_id, seq, removals });
                    }
                    let _ = self.ev.send(WsEvent::Book { view: BookView::of(market_id, book, self.cfg.book_depth) });
                } else {
                    self.emit_market_delta(market_id, ch, seq, &batch);
                }
                None
            }
            Step::Gap { missing, got } => {
                self.bump_gap();
                let _ = self.ev.send(WsEvent::Gap { subject, missing, got });
                // `lifecycle` rides along with the other market channels; heal via the parent channel.
                let heal_ch = self.desired.markets.get(&market_id).cloned().unwrap_or_else(|| ch.to_string());
                Some(Selection::market(market_id, &heal_ch))
            }
            Step::Stale | Step::Buffered => None,
        }
    }

    fn emit_market_delta(&self, market_id: Uuid, ch: &str, seq: i64, batch: &Value) {
        let deltas = batch.get("deltas").cloned().unwrap_or(json!([]));
        match ch {
            "trades" => {
                let trades = serde_json::from_value(deltas).unwrap_or_default();
                let _ = self.ev.send(WsEvent::Trades { market_id, seq, trades });
            }
            "lifecycle" => {
                let transitions: Vec<String> = serde_json::from_value(deltas).unwrap_or_default();
                let status = transitions.iter().rev().find_map(|t| match t.as_str() {
                    "OPEN" => Some("OPEN"),
                    "CLOSE" => Some("CLOSED"),
                    "GRADE" => Some("SETTLED"),
                    _ => None,
                });
                let _ = self.ev.send(WsEvent::Lifecycle { market_id, seq, status: status.map(str::to_string), transitions });
            }
            _ => {
                let _ = self.ev.send(WsEvent::Bbo { market_id, seq, data: batch.clone() });
            }
        }
    }

    fn on_private_snapshot(&mut self, ch: &str, p: &Value) {
        let seq = p.get("seq").and_then(Value::as_i64).unwrap_or(0);
        let subject = format!("private:{ch}");
        let seqr = self.seqs.entry(subject.clone()).or_default();
        let was_resync = seqr.last_seq().is_some() && seqr.awaiting_snapshot();
        let replay = seqr.snapshot(seq);
        if ch == "orders" {
            let open = p.get("open").cloned().and_then(|o| serde_json::from_value(o).ok()).unwrap_or_default();
            let _ = self.ev.send(WsEvent::OrdersSnapshot { seq, open });
        } else {
            let positions = p.get("positions").cloned().and_then(|o| serde_json::from_value(o).ok()).unwrap_or_default();
            let _ = self.ev.send(WsEvent::Positions { seq, positions });
        }
        for (s, batch) in &replay {
            self.emit_private(ch, *s, batch);
        }
        if was_resync {
            self.stats.lock().unwrap().resyncs += 1;
            let _ = self.ev.send(WsEvent::Resynced { subject, seq, replayed: replay.len() });
        }
    }

    fn on_private_delta(&mut self, ch: &str, p: &Value) -> Option<Selection> {
        let seq = p.get("seq").and_then(Value::as_i64)?;
        let subject = format!("private:{ch}");
        let seqr = self.seqs.entry(subject.clone()).or_default();
        match seqr.delta(seq, p.clone()) {
            Step::Apply(batch) => {
                self.emit_private(ch, seq, &batch);
                None
            }
            Step::Gap { missing, got } => {
                self.bump_gap();
                let _ = self.ev.send(WsEvent::Gap { subject, missing, got });
                Some(Selection::private(&[ch]))
            }
            _ => None,
        }
    }

    fn emit_private(&self, ch: &str, seq: i64, batch: &Value) {
        let deltas = batch.get("deltas").cloned().unwrap_or(json!([]));
        if ch == "orders" {
            let events: Vec<OrderEvent> = deltas.as_array().map(|a| a.iter().filter_map(|d| serde_json::from_value(d.clone()).ok()).collect()).unwrap_or_default();
            let _ = self.ev.send(WsEvent::Orders { seq, events });
        } else {
            let positions = serde_json::from_value(deltas).unwrap_or_default();
            let _ = self.ev.send(WsEvent::Positions { seq, positions });
        }
    }

    fn bump_gap(&self) {
        self.stats.lock().unwrap().gaps += 1;
    }

    fn publish_seq_stats(&self) {
        let mut st = self.stats.lock().unwrap();
        st.subjects = self.seqs.iter().map(|(k, v)| (k.clone(), v.stats())).collect();
    }
}

/// The websocket book uses `order`, REST uses `orderId`.
#[derive(Deserialize)]
struct WireResting {
    #[serde(alias = "orderId")]
    order: Uuid,
    price: Price,
    qty: i32,
}

impl From<WireResting> for crate::types::RestingOrder {
    fn from(w: WireResting) -> Self {
        Self { order_id: w.order, price: w.price, qty: w.qty }
    }
}

fn apply_book(book: &mut Book, seq: i64, batch: &Value) -> Vec<Removal> {
    let deltas: Vec<BookDelta> = batch.get("deltas").and_then(|d| serde_json::from_value(d.clone()).ok()).unwrap_or_default();
    let removals = book.removals(&deltas);
    book.apply(seq, &deltas);
    removals
}
