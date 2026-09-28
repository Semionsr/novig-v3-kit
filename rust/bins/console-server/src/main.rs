//! Local backend for the Novig v3 console (http://127.0.0.1:8787).
//!
//! The browser never holds a private key and can't sign a websocket upgrade, so this process:
//! - loads keys from `.env` / `.novig/` (both gitignored) and signs every call with `novig-v3`
//! - owns the websocket (to Novig QA, or to the built-in mock exchange) and relays its events,
//!   the request log, throttle meters and bot state to the browser over one SSE stream
//! - runs the reference maker (`novig-mm`) in paper or live mode
//!
//! Public production market data doesn't come through here: the browser reads it directly
//! with the TypeScript SDK (Novig's public routes allow CORS).

use actix_cors::Cors;
use actix_web::{App, HttpResponse, HttpServer, Responder, get, post, web};
use novig_mm::{Bot, BotConfig, Mode};
use novig_v3::client::{CatalogFilter, Conditional, OrderFilter, RequestRecord};
use novig_v3::mock::{self, MockConfig, MockHandle};
use novig_v3::sign::PrivateKey;
use novig_v3::throttle::Throttler;
use novig_v3::types::*;
use novig_v3::ws::{self, BookView, Selection, WsConfig, WsHandle};
use novig_v3::{Algorithm, Client, Credentials, Environment};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::runtime::Handle;
use tokio::sync::broadcast;
use uuid::Uuid;

struct StreamSession {
    target: String,
    market: Option<Uuid>,
    handle: WsHandle,
    throttle: Arc<Throttler>,
    bot: Option<Arc<tokio::sync::Mutex<Bot>>>,
    task: tokio::task::JoinHandle<()>,
}

struct AppState {
    rt: Handle,
    env: Environment,
    root: PathBuf,
    /// Management key from .env: keys and subaccounts.
    management: Mutex<Option<Credentials>>,
    /// Trading key (a subaccount's): orders, catalog, websocket.
    trading: Mutex<Option<Credentials>>,
    signed_throttle: Arc<Throttler>,
    mock: MockHandle,
    fanout: broadcast::Sender<String>,
    requests: Arc<Mutex<VecDeque<RequestRecord>>>,
    stream: tokio::sync::Mutex<Option<StreamSession>>,
}

impl AppState {
    fn emit(&self, kind: &str, data: impl serde::Serialize) {
        let _ = self.fanout.send(json!({ "kind": kind, "data": data }).to_string());
    }

    fn client(&self, creds: Credentials) -> Client {
        let fan = self.fanout.clone();
        let log = self.requests.clone();
        Client::new(self.env.clone(), creds).with_throttler(self.signed_throttle.clone()).on_request(move |r| {
            let mut l = log.lock().unwrap();
            l.push_front(r.clone());
            l.truncate(300);
            let _ = fan.send(json!({ "kind": "request", "data": r }).to_string());
        })
    }

    fn management_client(&self) -> Result<Client, HttpResponse> {
        let c = self.management.lock().unwrap().clone();
        c.map(|c| self.client(c)).ok_or_else(|| needs_key("a management key (NOVIG_KEY_ID + NOVIG_PEM in .env)"))
    }

    fn trading_client(&self) -> Result<Client, HttpResponse> {
        let c = self.trading.lock().unwrap().clone();
        c.map(|c| self.client(c)).ok_or_else(|| needs_key("a trading key: run Quickstart step 2 to open a subaccount, or set NOVIG_TRADING_KEY_ID + NOVIG_TRADING_PEM"))
    }
}

fn needs_key(what: &str) -> HttpResponse {
    HttpResponse::PreconditionRequired().json(json!({ "code": "NO_KEY", "message": format!("This needs {what}.") }))
}

fn api_err(e: novig_v3::Error) -> HttpResponse {
    match &e {
        novig_v3::Error::Api { status, code, message, request_id, .. } => HttpResponse::build(actix_web::http::StatusCode::from_u16(*status).unwrap_or(actix_web::http::StatusCode::BAD_GATEWAY))
            .json(json!({ "code": code, "message": message, "requestId": request_id })),
        novig_v3::Error::Edge { request_id } => HttpResponse::BadGateway().json(json!({ "code": "EDGE_REFUSED", "message": e.to_string(), "requestId": request_id })),
        _ => HttpResponse::BadGateway().json(json!({ "code": "CLIENT_ERROR", "message": e.to_string() })),
    }
}

fn ok<T: serde::Serialize>(r: Result<T, novig_v3::Error>) -> HttpResponse {
    match r {
        Ok(v) => HttpResponse::Ok().json(v),
        Err(e) => api_err(e),
    }
}

fn mask(id: &str) -> String {
    if id.len() > 12 { format!("{}…{}", &id[..8], &id[id.len() - 4..]) } else { id.to_string() }
}

// ---------- status & events ----------

#[get("/api/status")]
async fn route_status(s: web::Data<AppState>) -> impl Responder {
    let m = s.management.lock().unwrap().as_ref().map(|c| (mask(&c.key_id), c.key.algorithm()));
    let t = s.trading.lock().unwrap().as_ref().map(|c| (mask(&c.key_id), c.key.algorithm()));
    let st = s.stream.lock().await;
    HttpResponse::Ok().json(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "env": s.env.base_url(),
        "wsUrl": s.env.ws_url(),
        "management": m.map(|(id, a)| json!({"keyId": id, "algorithm": a})),
        "trading": t.map(|(id, a)| json!({"keyId": id, "algorithm": a})),
        "mock": { "url": s.mock.url(), "market": s.mock.market, "dropEvery": s.mock.drop_every() },
        "stream": st.as_ref().map(|x| json!({ "target": x.target, "market": x.market, "stats": x.handle.stats(), "bot": x.bot.is_some() })),
    }))
}

#[get("/api/events")]
async fn route_events(s: web::Data<AppState>) -> impl Responder {
    let mut rx = s.fanout.subscribe();
    let body = async_stream::stream! {
        yield Ok::<_, actix_web::Error>(bytes::Bytes::from("retry: 1500\n\n"));
        loop {
            match rx.recv().await {
                Ok(msg) => yield Ok(bytes::Bytes::from(format!("data: {msg}\n\n"))),
                Err(broadcast::error::RecvError::Lagged(n)) => yield Ok(bytes::Bytes::from(format!("data: {}\n\n", json!({"kind":"lagged","data":n})))),
                Err(_) => break,
            }
        }
    };
    HttpResponse::Ok().insert_header(("Content-Type", "text/event-stream")).insert_header(("Cache-Control", "no-cache")).streaming(body)
}

#[get("/api/requests")]
async fn route_requests(s: web::Data<AppState>) -> impl Responder {
    HttpResponse::Ok().json(s.requests.lock().unwrap().iter().cloned().collect::<Vec<_>>())
}

#[get("/api/throttle")]
async fn route_throttle(s: web::Data<AppState>) -> impl Responder {
    let st = s.stream.lock().await;
    HttpResponse::Ok().json(json!({
        "signed": s.signed_throttle.snapshot(),
        "stream": st.as_ref().map(|x| x.throttle.snapshot()),
        "maxWatchedMarkets": s.signed_throttle.max_watched_markets(),
    }))
}

/// Fires `n` cheap signed reads as fast as the model allows, to watch pacing on the meters.
#[post("/api/throttle/burst")]
async fn route_burst(s: web::Data<AppState>, body: web::Json<Value>) -> impl Responder {
    let client = match s.trading_client().or_else(|_| s.management_client()) {
        Ok(c) => c,
        Err(r) => return r,
    };
    let n = body.get("n").and_then(Value::as_u64).unwrap_or(80).min(400);
    let trading = s.trading.lock().unwrap().is_some();
    s.rt.spawn(async move {
        for _ in 0..n {
            let _ = if trading { client.types(novig_v3::client::TypeList::Leagues).await.map(|_| ()) } else { client.subaccounts().await.map(|_| ()) };
        }
    });
    HttpResponse::Accepted().json(json!({ "queued": n, "bucket": if trading { "read" } else { "account" } }))
}

// ---------- signed REST ----------

#[post("/api/signed/echo")]
async fn route_echo(s: web::Data<AppState>, body: web::Json<Value>) -> impl Responder {
    let which = body.get("key").and_then(Value::as_str).unwrap_or("management");
    let client = match if which == "trading" { s.trading_client() } else { s.management_client() } {
        Ok(c) => c,
        Err(r) => return r,
    };
    ok(client.echo(&body.get("body").cloned().unwrap_or(json!({"hello": "novig"}))).await)
}

#[get("/api/signed/limits")]
async fn route_limits(s: web::Data<AppState>) -> impl Responder {
    match s.trading_client().or_else(|_| s.management_client()) {
        Ok(c) => ok(c.limits().await),
        Err(r) => r,
    }
}

#[get("/api/signed/keys")]
async fn route_keys(s: web::Data<AppState>) -> impl Responder {
    match s.management_client() {
        Ok(c) => ok(c.keys().await),
        Err(r) => r,
    }
}

#[get("/api/signed/subaccounts")]
async fn route_subaccounts(s: web::Data<AppState>) -> impl Responder {
    match s.management_client() {
        Ok(c) => ok(c.subaccounts().await),
        Err(r) => r,
    }
}

/// Quickstart step 2: generate an Ed25519 keypair here, open a subaccount with its public half,
/// and keep the private half in `.novig/` so this machine can trade with it.
#[post("/api/signed/subaccounts")]
async fn route_open_subaccount(s: web::Data<AppState>, body: web::Json<Value>) -> impl Responder {
    let client = match s.management_client() {
        Ok(c) => c,
        Err(r) => return r,
    };
    let label = body.get("label").and_then(Value::as_str).unwrap_or("v3-console").to_string();
    let key = PrivateKey::generate(Algorithm::Ed25519);
    let req = OpenSubaccount { label, public_key: key.public_key().to_spki_pem(), algorithm: Algorithm::Ed25519, expires_at: None };
    match client.open_subaccount(&req).await {
        Ok(sub) => {
            let dir = s.root.join(".novig");
            let _ = std::fs::create_dir_all(&dir);
            let path = dir.join(format!("subaccount-{}.pem", sub.key_id));
            if let Err(e) = std::fs::write(&path, key.to_pkcs8_pem()) {
                return HttpResponse::InternalServerError().json(json!({"code":"SAVE_FAILED","message": e.to_string()}));
            }
            *s.trading.lock().unwrap() = Some(Credentials::new(sub.key_id.to_string(), key));
            HttpResponse::Created().json(json!({ "subaccount": sub, "savedKey": path.strip_prefix(&s.root).unwrap_or(&path) }))
        }
        Err(e) => api_err(e),
    }
}

#[post("/api/signed/transfer")]
async fn route_transfer(s: web::Data<AppState>, body: web::Json<Value>) -> impl Responder {
    let client = match s.management_client() {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Some(key_id) = s.trading.lock().unwrap().as_ref().and_then(|c| c.key_id.parse::<Uuid>().ok()) else { return needs_key("a subaccount (Quickstart step 2)") };
    let amount: rust_decimal::Decimal = body.get("amount").and_then(Value::as_str).and_then(|a| a.parse().ok()).unwrap_or(rust_decimal::Decimal::from(25));
    let req = TransferRequest { direction: TransferDirection::Fund, amount, client_transfer_id: Some(Uuid::new_v4().to_string()) };
    ok(client.transfer(key_id, &req).await)
}

#[get("/api/signed/balance")]
async fn route_balance(s: web::Data<AppState>) -> impl Responder {
    let client = match s.trading_client() {
        Ok(c) => c,
        Err(r) => return r,
    };
    let key_id: Uuid = client.credentials().unwrap().key_id.parse().unwrap_or_default();
    ok(client.balance(key_id).await)
}

#[get("/api/signed/markets")]
async fn route_signed_markets(s: web::Data<AppState>, q: web::Query<Value>) -> impl Responder {
    let client = match s.trading_client() {
        Ok(c) => c,
        Err(r) => return r,
    };
    let f = CatalogFilter { league: q.get("league").and_then(Value::as_str).map(str::to_string), limit: Some(q.get("limit").and_then(Value::as_str).and_then(|l| l.parse().ok()).unwrap_or(50)), ..Default::default() };
    ok(client.markets(&f).await)
}

#[get("/api/signed/book/{id}")]
async fn route_signed_book(s: web::Data<AppState>, id: web::Path<Uuid>) -> impl Responder {
    let client = match s.trading_client() {
        Ok(c) => c,
        Err(r) => return r,
    };
    match client.book(*id, None).await {
        Ok(Conditional::Fresh { value, .. }) => HttpResponse::Ok().json(BookView::of(*id, &novig_v3::book::Book::from_snapshot(&value), 15)),
        Ok(Conditional::NotModified) => HttpResponse::NotModified().finish(),
        Err(e) => api_err(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaceBody {
    outcome_id: Uuid,
    price: String,
    qty: i32,
    tif: Option<TimeInForce>,
    ttl: Option<i64>,
}

#[post("/api/signed/orders")]
async fn route_place(s: web::Data<AppState>, body: web::Json<PlaceBody>) -> impl Responder {
    let client = match s.trading_client() {
        Ok(c) => c,
        Err(r) => return r,
    };
    let price: Price = match body.price.parse() {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().json(json!({"code":"INVALID_PRICE","message": e.to_string()})),
    };
    let order = PlaceOrder { outcome_id: body.outcome_id, price, qty: body.qty, tif: body.tif.unwrap_or(TimeInForce::GTC), ttl: body.ttl, client_id: Some(Uuid::new_v4()) };
    ok(client.place_order(&order).await)
}

#[actix_web::delete("/api/signed/orders/{id}")]
async fn route_cancel(s: web::Data<AppState>, id: web::Path<Uuid>) -> impl Responder {
    match s.trading_client() {
        Ok(c) => ok(c.cancel_order(*id).await),
        Err(r) => r,
    }
}

#[post("/api/signed/cancel-all")]
async fn route_cancel_all(s: web::Data<AppState>) -> impl Responder {
    match s.trading_client() {
        Ok(c) => ok(c.cancel_all(&OrderFilter::default()).await),
        Err(r) => r,
    }
}

#[get("/api/signed/resting")]
async fn route_resting(s: web::Data<AppState>) -> impl Responder {
    match s.trading_client() {
        Ok(c) => match c.resting_orders(None).await {
            Ok(Conditional::Fresh { value, .. }) => HttpResponse::Ok().json(value),
            Ok(Conditional::NotModified) => HttpResponse::NotModified().finish(),
            Err(e) => api_err(e),
        },
        Err(r) => r,
    }
}

#[get("/api/signed/positions")]
async fn route_positions(s: web::Data<AppState>) -> impl Responder {
    match s.trading_client() {
        Ok(c) => ok(c.positions(&OrderFilter::default()).await),
        Err(r) => r,
    }
}

#[get("/api/signed/fills")]
async fn route_fills(s: web::Data<AppState>) -> impl Responder {
    match s.trading_client() {
        Ok(c) => ok(c.fills(&OrderFilter { limit: Some(50), ..Default::default() }).await),
        Err(r) => r,
    }
}

// ---------- websocket session ----------

#[derive(Deserialize)]
struct ConnectBody {
    /// "mock" (built-in exchange) or "qa" (Novig QA with the trading key).
    target: String,
    market: Option<Uuid>,
    channel: Option<String>,
}

#[post("/api/stream/connect")]
async fn route_stream_connect(s: web::Data<AppState>, body: web::Json<ConnectBody>) -> impl Responder {
    let mut guard = s.stream.lock().await;
    if let Some(old) = guard.take() {
        old.handle.close();
        old.task.abort();
    }
    let (url, creds, market) = if body.target == "qa" {
        let Some(creds) = s.trading.lock().unwrap().clone() else { return needs_key("a trading key for the websocket") };
        (s.env.ws_url(), Some(creds), body.market)
    } else {
        (s.mock.url(), None, Some(body.market.unwrap_or(s.mock.market.market_id)))
    };
    let throttle = Arc::new(Throttler::default());
    let mut cfg = WsConfig::new(url.clone(), creds);
    cfg.throttle = throttle.clone();
    cfg.book_depth = 15;
    let (handle, mut rx) = {
        let _g = s.rt.enter();
        ws::connect(cfg)
    };
    if let Some(m) = market {
        handle.subscribe(Selection::market(m, body.channel.as_deref().unwrap_or("book")));
    }
    if body.target == "qa" {
        handle.subscribe(Selection::private(&["orders", "positions"]));
    }
    let state = s.clone();
    let h2 = handle.clone();
    let task = s.rt.spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(500));
        loop {
            tokio::select! {
                ev = rx.recv() => {
                    let Some(ev) = ev else { break };
                    state.emit("ws", &ev);
                    // Drive the bot, if one is attached to this session.
                    let bot = state.stream.lock().await.as_ref().and_then(|x| x.bot.clone().map(|b| (b, x.market)));
                    if let Some((bot, Some(m))) = bot {
                        let book = h2.book(&m);
                        let actions = bot.lock().await.on_event(&ev, book.as_ref(), novig_v3::sign::now_millis());
                        let client = if actions.is_empty() { None } else { state.trading_client().ok() };
                        if let Some(c) = client {
                            for a in actions { novig_mm::execute(&c, &bot, a).await; }
                        }
                    }
                }
                _ = tick.tick() => {
                    let st = state.stream.lock().await;
                    if let Some(x) = st.as_ref() {
                        state.emit("stats", json!({ "ws": x.handle.stats(), "stream": x.throttle.snapshot(), "signed": state.signed_throttle.snapshot(), "mockDropEvery": state.mock.drop_every() }));
                        if let (Some(bot), Some(m)) = (&x.bot, x.market) {
                            let book = x.handle.book(&m);
                            state.emit("bot", bot.lock().await.state(book.as_ref()));
                        }
                    }
                }
            }
        }
    });
    *guard = Some(StreamSession { target: body.target.clone(), market, handle, throttle, bot: None, task });
    HttpResponse::Ok().json(json!({ "url": url, "market": market }))
}

#[post("/api/stream/disconnect")]
async fn route_stream_disconnect(s: web::Data<AppState>) -> impl Responder {
    if let Some(old) = s.stream.lock().await.take() {
        old.handle.close();
        old.task.abort();
    }
    HttpResponse::Ok().json(json!({}))
}

#[post("/api/stream/snapshot")]
async fn route_stream_snapshot(s: web::Data<AppState>) -> impl Responder {
    let st = s.stream.lock().await;
    match st.as_ref() {
        Some(x) => {
            if let Some(m) = x.market {
                x.handle.snapshot(Selection::market(m, "book"));
            }
            HttpResponse::Ok().json(json!({}))
        }
        None => HttpResponse::Conflict().json(json!({"code":"NOT_CONNECTED","message":"connect first"})),
    }
}

#[get("/api/stream/book")]
async fn route_stream_book(s: web::Data<AppState>) -> impl Responder {
    let st = s.stream.lock().await;
    match st.as_ref().and_then(|x| x.market.and_then(|m| x.handle.book(&m).map(|b| BookView::of(m, &b, 15)))) {
        Some(v) => HttpResponse::Ok().json(v),
        None => HttpResponse::NoContent().finish(),
    }
}

#[post("/api/mock/kill")]
async fn route_mock_kill(s: web::Data<AppState>) -> impl Responder {
    s.mock.kill_connections();
    HttpResponse::Ok().json(json!({ "killed": true }))
}

#[post("/api/mock/loss")]
async fn route_mock_loss(s: web::Data<AppState>, body: web::Json<Value>) -> impl Responder {
    let n = body.get("dropEvery").and_then(Value::as_u64).unwrap_or(0);
    s.mock.set_drop_every(n);
    HttpResponse::Ok().json(json!({ "dropEvery": n }))
}

// ---------- bot ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BotBody {
    mode: Option<Mode>,
    half_spread_ticks: Option<u16>,
    size: Option<i32>,
    max_position: Option<i32>,
}

#[post("/api/bot/start")]
async fn route_bot_start(s: web::Data<AppState>, body: web::Json<BotBody>) -> impl Responder {
    let mut st = s.stream.lock().await;
    let Some(sess) = st.as_mut() else { return HttpResponse::Conflict().json(json!({"code":"NOT_CONNECTED","message":"connect the stream to a market first"})) };
    let Some(market) = sess.market else { return HttpResponse::Conflict().json(json!({"code":"NO_MARKET","message":"the stream has no market"})) };
    let mode = body.mode.unwrap_or(Mode::Paper);
    if mode == Mode::Live && (sess.target != "qa" || s.trading.lock().unwrap().is_none()) {
        return HttpResponse::Conflict().json(json!({"code":"LIVE_NEEDS_QA","message":"live mode trades on Novig QA with a trading key; use paper mode on the mock"}));
    }
    let mut cfg = if sess.target == "qa" {
        let client = match s.trading_client() {
            Ok(c) => c,
            Err(r) => return r,
        };
        let m = match client.market(market).await {
            Ok(m) => m,
            Err(e) => return api_err(e),
        };
        if m.outcomes.len() != 2 {
            return HttpResponse::BadRequest().json(json!({"code":"NOT_BINARY","message":"the reference bot quotes two-outcome markets"}));
        }
        BotConfig::new(market, [m.outcomes[0].outcome_id, m.outcomes[1].outcome_id], [m.outcomes[0].name.clone(), m.outcomes[1].name.clone()], m.fee, mode)
    } else {
        let m = s.mock.market;
        let fee = MarketFee { coefficient: "0.03".parse().unwrap(), maker_credit: "0.5".parse().unwrap(), charged: Chargeability::WhenLive };
        BotConfig::new(m.market_id, [m.home, m.away], ["Home".into(), "Away".into()], fee, Mode::Paper)
    };
    if let Some(v) = body.half_spread_ticks { cfg.half_spread_ticks = v.max(1); }
    if let Some(v) = body.size { cfg.size = v.max(1); }
    if let Some(v) = body.max_position { cfg.max_position = v.max(1); }
    let mut bot = Bot::new(cfg);
    bot.start();
    sess.bot = Some(Arc::new(tokio::sync::Mutex::new(bot)));
    HttpResponse::Ok().json(json!({ "started": true }))
}

#[post("/api/bot/stop")]
async fn route_bot_stop(s: web::Data<AppState>) -> impl Responder {
    let st = s.stream.lock().await;
    let Some(bot) = st.as_ref().and_then(|x| x.bot.clone()) else { return HttpResponse::Ok().json(json!({})) };
    drop(st);
    let actions = bot.lock().await.stop();
    if let Ok(c) = s.trading_client() {
        for a in actions {
            novig_mm::execute(&c, &bot, a).await;
        }
    }
    HttpResponse::Ok().json(json!({ "stopped": true }))
}

#[post("/api/bot/config")]
async fn route_bot_config(s: web::Data<AppState>, body: web::Json<BotBody>) -> impl Responder {
    let st = s.stream.lock().await;
    let Some(bot) = st.as_ref().and_then(|x| x.bot.clone()) else { return HttpResponse::Conflict().json(json!({"code":"NO_BOT","message":"start the bot first"})) };
    drop(st);
    let mut b = bot.lock().await;
    let mut cfg = b.config().clone();
    if let Some(v) = body.half_spread_ticks { cfg.half_spread_ticks = v.max(1); }
    if let Some(v) = body.size { cfg.size = v.max(1); }
    if let Some(v) = body.max_position { cfg.max_position = v.max(1); }
    b.set_config(cfg);
    HttpResponse::Ok().json(json!({}))
}

// ---------- boot ----------

fn load_env(root: &PathBuf) -> (Environment, Option<Credentials>, Option<Credentials>) {
    let _ = dotenvy::from_path(root.join(".env"));
    let env = Environment::from_name(&std::env::var("NOVIG_ENV").unwrap_or_else(|_| "qa".into()));
    let read = |id: &str, pem: &str| -> Option<Credentials> {
        let id = std::env::var(id).ok()?;
        let path = std::env::var(pem).ok()?;
        let path = if PathBuf::from(&path).is_absolute() { PathBuf::from(path) } else { root.join(path) };
        match std::fs::read_to_string(&path).map_err(|e| e.to_string()).and_then(|p| Credentials::from_pem(id, &p).map_err(|e| e.to_string())) {
            Ok(c) => Some(c),
            Err(e) => {
                eprintln!("could not load {}: {e}", path.display());
                None
            }
        }
    };
    let management = read("NOVIG_KEY_ID", "NOVIG_PEM");
    let mut trading = read("NOVIG_TRADING_KEY_ID", "NOVIG_TRADING_PEM");
    if trading.is_none() {
        // A subaccount opened from the console saved its key here.
        if let Ok(dir) = std::fs::read_dir(root.join(".novig")) {
            let newest = dir.flatten().filter(|e| e.file_name().to_string_lossy().starts_with("subaccount-")).max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
            if let Some(e) = newest {
                let name = e.file_name().to_string_lossy().to_string();
                let id = name.trim_start_matches("subaccount-").trim_end_matches(".pem").to_string();
                trading = std::fs::read_to_string(e.path()).ok().and_then(|p| Credentials::from_pem(id, &p).ok());
            }
        }
    }
    (env, management, trading)
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info,actix_web=warn".into())).init();
    let root = std::env::var("NOVIG_KIT_ROOT").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."));
    let root = root.canonicalize().unwrap_or(root);
    let (env, management, trading) = load_env(&root);

    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().worker_threads(4).build()?;
    let mock = rt.block_on(mock::serve("127.0.0.1:0", MockConfig { drop_every: Some(60), ..Default::default() }))?;
    let (fanout, _) = broadcast::channel(8192);
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787);

    println!("novig v3 console server  http://127.0.0.1:{port}");
    println!("  environment   {}", env.base_url());
    println!("  management    {}", management.as_ref().map(|c| mask(&c.key_id)).unwrap_or_else(|| "none (set NOVIG_KEY_ID + NOVIG_PEM in .env)".into()));
    println!("  trading       {}", trading.as_ref().map(|c| mask(&c.key_id)).unwrap_or_else(|| "none (open a subaccount from Quickstart)".into()));
    println!("  mock exchange {}", mock.url());

    let state = web::Data::new(AppState {
        rt: rt.handle().clone(),
        env,
        root: root.clone(),
        management: Mutex::new(management),
        trading: Mutex::new(trading),
        signed_throttle: Arc::new(Throttler::default()),
        mock,
        fanout,
        requests: Arc::new(Mutex::new(VecDeque::new())),
        stream: tokio::sync::Mutex::new(None),
    });
    let dist = root.join("ts/apps/console/dist");

    actix_web::rt::System::new().block_on(async move {
        HttpServer::new(move || {
            let mut app = App::new()
                .app_data(state.clone())
                .app_data(web::JsonConfig::default().limit(64 * 1024))
                .wrap(Cors::default().allowed_origin_fn(|o, _| o.as_bytes().starts_with(b"http://localhost") || o.as_bytes().starts_with(b"http://127.0.0.1")).allow_any_method().allow_any_header())
                .service(route_status).service(route_events).service(route_requests).service(route_throttle).service(route_burst)
                .service(route_echo).service(route_limits).service(route_keys).service(route_subaccounts).service(route_open_subaccount).service(route_transfer).service(route_balance)
                .service(route_signed_markets).service(route_signed_book).service(route_place).service(route_cancel).service(route_cancel_all).service(route_resting).service(route_positions).service(route_fills)
                .service(route_stream_connect).service(route_stream_disconnect).service(route_stream_snapshot).service(route_stream_book).service(route_mock_kill).service(route_mock_loss)
                .service(route_bot_start).service(route_bot_stop).service(route_bot_config);
            if dist.exists() {
                app = app.service(actix_files_like(dist.clone()));
            }
            app
        })
        .bind(("127.0.0.1", port))?
        .workers(2)
        .run()
        .await
    })?;
    Ok(())
}

/// Serves the built console (ts/apps/console/dist) with SPA fallback, without another dependency.
fn actix_files_like(dist: PathBuf) -> actix_web::Resource {
    web::resource("/{tail:.*}").route(web::get().to(move |path: web::Path<String>| {
        let dist = dist.clone();
        async move {
            let rel = path.into_inner();
            let safe = !rel.contains("..");
            let file = if safe && !rel.is_empty() { dist.join(&rel) } else { dist.join("index.html") };
            let file = if file.is_file() { file } else { dist.join("index.html") };
            let ct = match file.extension().and_then(|e| e.to_str()) {
                Some("js") => "text/javascript",
                Some("css") => "text/css",
                Some("svg") => "image/svg+xml",
                Some("woff2") => "font/woff2",
                Some("ttf") => "font/ttf",
                Some("otf") => "font/otf",
                Some("png") => "image/png",
                Some("json") => "application/json",
                _ => "text/html; charset=utf-8",
            };
            match std::fs::read(&file) {
                Ok(b) => HttpResponse::Ok().content_type(ct).body(b),
                Err(_) => HttpResponse::NotFound().finish(),
            }
        }
    }))
}
