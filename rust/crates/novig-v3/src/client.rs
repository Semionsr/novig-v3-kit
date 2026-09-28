//! Typed REST for every v3 route (docs.novig.com/api-reference).
//!
//! Three things this does that hand-rolled clients usually get wrong:
//! - It signs the URL it actually sends: the query is built and encoded here, parsed once,
//!   and the signature covers `url.path()` / `url.query()` exactly as sent.
//! - It serializes the body once and hashes those same bytes (re-serialized JSON changes the hash).
//! - It paces every call through the [`Throttler`], and treats a `429` as "wait `Retry-After`,
//!   then retry" instead of an error. The server rejects a throttled request before acting on
//!   it, so retrying, even a `POST /v3/orders`, can't double-place.

use reqwest::{Method, StatusCode};
use serde::{Serialize, de::DeserializeOwned};
use std::sync::Arc;
use std::time::{Duration, Instant};
use url::Url;
use uuid::Uuid;

use crate::query;
use crate::sign::Credentials;
use crate::throttle::{Bucket, Cost, Throttler};
use crate::types::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Environment {
    /// Real money. Public market data needs no key.
    Production,
    /// Test money. Keys come from the QA app's Profile → Settings → Novig API.
    Qa,
    Custom(String),
}

impl Environment {
    pub fn base_url(&self) -> &str {
        match self {
            Environment::Production => "https://api.novig.com",
            Environment::Qa => "https://api.qa.novig.com",
            Environment::Custom(u) => u.trim_end_matches('/'),
        }
    }

    pub fn ws_url(&self) -> String {
        let base = self.base_url();
        let ws = base.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
        format!("{ws}/v3/ws")
    }

    pub fn from_name(name: &str) -> Self {
        match name.to_ascii_lowercase().as_str() {
            "prod" | "production" => Self::Production,
            "qa" => Self::Qa,
            other => Self::Custom(other.to_string()),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A JSON error from Novig's servers: `{ code, message }`.
    #[error("{status} {code}: {message}")]
    Api { status: u16, code: String, message: String, request_id: Option<String>, body: ErrorBody },
    /// The edge filter refused the request with an HTML page. It never reached Novig's servers,
    /// so there's no `code`: usually the per-IP rate or the body-size cap.
    #[error("403 from the edge (HTML, no code): the request never reached Novig's servers")]
    Edge { request_id: Option<String> },
    #[error("still rate limited after {attempts} attempts")]
    RateLimited { attempts: u32 },
    #[error("this route needs a signed request, but the client has no credentials")]
    NoCredentials,
    #[error("unexpected {status} response: {body}")]
    Unexpected { status: u16, body: String },
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
}

impl Error {
    /// The machine-readable code, e.g. `SIGNATURE_REJECTED` or `INVALID_PRICE`.
    pub fn code(&self) -> Option<&str> {
        match self {
            Error::Api { code, .. } => Some(code),
            _ => None,
        }
    }
}

/// One finished HTTP exchange. Hook these with [`Client::on_request`] for logs or a dashboard.
#[derive(Debug, Clone, Serialize)]
pub struct RequestRecord {
    pub method: String,
    pub path: String,
    pub query: String,
    pub status: u16,
    pub millis: u64,
    pub bucket: Option<Bucket>,
    pub cost: u32,
    pub waited_ms: u64,
    pub attempt: u32,
    pub request_id: Option<String>,
    pub error_code: Option<String>,
    pub string_to_sign: Option<String>,
    pub ts: i64,
}

type Hook = Arc<dyn Fn(&RequestRecord) + Send + Sync>;

#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    env: Environment,
    creds: Option<Credentials>,
    throttle: Arc<Throttler>,
    hook: Option<Hook>,
    max_attempts: u32,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client").field("env", &self.env).field("key_id", &self.creds.as_ref().map(|c| &c.key_id)).finish()
    }
}

/// Filters shared by the catalog list routes. Unset fields are left out of the query.
#[derive(Debug, Clone, Default)]
pub struct CatalogFilter {
    pub league: Option<String>,
    pub market_type: Option<String>,
    pub event_status: Option<String>,
    pub event: Option<Uuid>,
    pub status: Option<String>,
    pub starts_after: Option<i64>,
    pub starts_before: Option<i64>,
    pub limit: Option<u32>,
    pub after: Option<String>,
}

/// Filters for orders, fills, positions and cancel-all.
#[derive(Debug, Clone, Default)]
pub struct OrderFilter {
    pub event: Option<Uuid>,
    pub market: Option<Uuid>,
    pub outcome: Option<Uuid>,
    pub order: Option<Uuid>,
    pub status: Option<OrderStatus>,
    pub kind: Option<TransactionKind>,
    pub starts_after: Option<i64>,
    pub starts_before: Option<i64>,
    pub limit: Option<u32>,
    pub after: Option<String>,
}

/// A cached `GET` that honors `ETag` / `If-None-Match` (book, resting orders, positions).
#[derive(Debug, Clone)]
pub enum Conditional<T> {
    Fresh { value: T, etag: Option<String> },
    NotModified,
}

struct Req<'a> {
    method: Method,
    path: String,
    query: Vec<(&'a str, String)>,
    body: Option<Vec<u8>>,
    cost: Cost,
    signed: bool,
    if_none_match: Option<&'a str>,
}

impl Client {
    /// A client for public routes only (no key). Production market data works with this.
    pub fn public(env: Environment) -> Self {
        Self {
            http: reqwest::Client::builder()
                .user_agent(concat!("novig-v3-rs/", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(20))
                .build()
                .expect("TLS backend"),
            env,
            creds: None,
            throttle: Arc::new(Throttler::default()),
            hook: None,
            max_attempts: 4,
        }
    }

    pub fn new(env: Environment, creds: Credentials) -> Self {
        Self { creds: Some(creds), ..Self::public(env) }
    }

    /// Shares one throttle model between clients that use the same key (the limit is per key).
    pub fn with_throttler(mut self, throttle: Arc<Throttler>) -> Self {
        self.throttle = throttle;
        self
    }

    pub fn on_request(mut self, hook: impl Fn(&RequestRecord) + Send + Sync + 'static) -> Self {
        self.hook = Some(Arc::new(hook));
        self
    }

    pub fn environment(&self) -> &Environment {
        &self.env
    }

    pub fn credentials(&self) -> Option<&Credentials> {
        self.creds.as_ref()
    }

    pub fn throttler(&self) -> &Arc<Throttler> {
        &self.throttle
    }

    // ---------- public catalog (no key) ----------

    pub async fn public_markets(&self, f: &CatalogFilter) -> Result<Page<Market>, Error> {
        self.get_json("/v3/public/catalog/markets", market_query(f), public(), false).await
    }
    pub async fn public_market(&self, id: Uuid) -> Result<Market, Error> {
        self.get_json(&format!("/v3/public/catalog/markets/{id}"), vec![], public(), false).await
    }
    pub async fn public_events(&self, f: &CatalogFilter) -> Result<Page<Event>, Error> {
        self.get_json("/v3/public/catalog/events", event_query(f), public(), false).await
    }
    pub async fn public_event(&self, id: Uuid) -> Result<Event, Error> {
        self.get_json(&format!("/v3/public/catalog/events/{id}"), vec![], public(), false).await
    }
    pub async fn public_book(&self, id: Uuid, etag: Option<&str>) -> Result<Conditional<BookSnapshot>, Error> {
        self.conditional(&format!("/v3/public/catalog/markets/{id}/book"), public(), false, etag).await
    }
    pub async fn public_trades(&self, id: Uuid, limit: Option<u32>, after: Option<&str>) -> Result<Page<Trade>, Error> {
        self.get_json(&format!("/v3/public/catalog/markets/{id}/trades"), page_query(limit, after), public(), false).await
    }
    pub async fn public_types(&self, kind: TypeList) -> Result<Vec<String>, Error> {
        self.get_json(&format!("/v3/public/types/{}", kind.path()), vec![], public(), false).await
    }

    // ---------- signed catalog ----------

    pub async fn markets(&self, f: &CatalogFilter) -> Result<Page<Market>, Error> {
        self.get_json("/v3/catalog/markets", market_query(f), read(), true).await
    }
    pub async fn market(&self, id: Uuid) -> Result<Market, Error> {
        self.get_json(&format!("/v3/catalog/markets/{id}"), vec![], read(), true).await
    }
    pub async fn events(&self, f: &CatalogFilter) -> Result<Page<Event>, Error> {
        self.get_json("/v3/catalog/events", event_query(f), read(), true).await
    }
    pub async fn event(&self, id: Uuid) -> Result<Event, Error> {
        self.get_json(&format!("/v3/catalog/events/{id}"), vec![], read(), true).await
    }
    pub async fn book(&self, id: Uuid, etag: Option<&str>) -> Result<Conditional<BookSnapshot>, Error> {
        self.conditional(&format!("/v3/catalog/markets/{id}/book"), read(), true, etag).await
    }
    pub async fn trades(&self, id: Uuid, limit: Option<u32>, after: Option<&str>) -> Result<Page<Trade>, Error> {
        self.get_json(&format!("/v3/catalog/markets/{id}/trades"), page_query(limit, after), read(), true).await
    }
    pub async fn types(&self, kind: TypeList) -> Result<Vec<String>, Error> {
        self.get_json(&format!("/v3/types/{}", kind.path()), vec![], read(), true).await
    }

    // ---------- keys ----------

    /// Free and needs any key: the fastest way to prove a signer works.
    pub async fn echo(&self, body: &serde_json::Value) -> Result<serde_json::Value, Error> {
        let bytes = serde_json::to_vec(body)?;
        let text = self.send_raw(Req { method: Method::POST, path: "/v3/echo".into(), query: vec![], body: Some(bytes), cost: Cost::Free, signed: true, if_none_match: None }).await?.1;
        Ok(if text.trim().is_empty() { serde_json::Value::Null } else { serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text)) })
    }
    pub async fn limits(&self) -> Result<Throttle, Error> {
        let t: Throttle = self.get_json("/v3/limits", vec![], Cost::Free, true).await?;
        self.throttle.update_limits(t);
        Ok(t)
    }
    pub async fn keys(&self) -> Result<Vec<Key>, Error> {
        self.get_json("/v3/keys", vec![], account(), true).await
    }
    pub async fn key(&self, id: Uuid) -> Result<Key, Error> {
        self.get_json(&format!("/v3/keys/{id}"), vec![], account(), true).await
    }
    pub async fn create_key(&self, body: &CreateKey) -> Result<KeyCreated, Error> {
        self.send_json(Method::POST, "/v3/keys", vec![], Some(body), account()).await
    }
    pub async fn revoke_key(&self, id: Uuid) -> Result<(), Error> {
        self.send_unit(Method::DELETE, &format!("/v3/keys/{id}"), vec![], account()).await
    }

    // ---------- subaccounts ----------

    pub async fn open_subaccount(&self, body: &OpenSubaccount) -> Result<Subaccount, Error> {
        self.send_json(Method::POST, "/v3/account/subaccounts", vec![], Some(body), account()).await
    }
    pub async fn subaccounts(&self) -> Result<Vec<Subaccount>, Error> {
        self.get_json("/v3/account/subaccounts", vec![], account(), true).await
    }
    pub async fn issue_subaccount_key(&self, key_id: Uuid, body: &CreateSubaccountKey) -> Result<KeyCreated, Error> {
        self.send_json(Method::POST, &format!("/v3/account/subaccounts/{key_id}/keys"), vec![], Some(body), account()).await
    }
    pub async fn balance(&self, key_id: Uuid) -> Result<Balance, Error> {
        self.get_json(&format!("/v3/account/subaccounts/{key_id}/balance"), vec![], account(), true).await
    }
    pub async fn transfer(&self, key_id: Uuid, body: &TransferRequest) -> Result<Transfer, Error> {
        self.send_json(Method::POST, &format!("/v3/account/subaccounts/{key_id}/transfer"), vec![], Some(body), account()).await
    }
    pub async fn get_transfer(&self, key_id: Uuid, id: Uuid) -> Result<Transfer, Error> {
        self.get_json(&format!("/v3/account/subaccounts/{key_id}/transfers/{id}"), vec![], account(), true).await
    }
    pub async fn label_subaccount(&self, key_id: Uuid, label: &str) -> Result<Subaccount, Error> {
        let body = serde_json::json!({ "label": label });
        self.send_json(Method::PATCH, &format!("/v3/account/subaccounts/{key_id}"), vec![], Some(&body), account()).await
    }
    pub async fn transactions(&self, key_id: Uuid, f: &OrderFilter) -> Result<Page<Transaction>, Error> {
        let rows = f.limit.unwrap_or(100);
        let q = order_query(f, &["kind", "startsAfter", "startsBefore", "limit", "after"]);
        self.get_json(&format!("/v3/account/subaccounts/{key_id}/transactions"), q, Cost::Tokens(Bucket::History, 6 + rows.div_ceil(100)), true).await
    }

    // ---------- orders ----------

    /// A `201` means the engine queued the order, not that it rests. The private stream's
    /// `open` (or `reject`) event is the confirmation.
    pub async fn place_order(&self, order: &PlaceOrder) -> Result<OrderAccepted, Error> {
        self.send_json(Method::POST, "/v3/orders", vec![], Some(order), Cost::Tokens(Bucket::Place, 1)).await
    }
    /// Places any number of orders, split so each body fits the edge's 8 KiB cap. The route
    /// takes 1024, but past ~90 orders the edge answers an HTML 403 that never reaches Novig.
    pub async fn place_orders(&self, orders: Vec<PlaceOrder>) -> Result<BatchPlaceResult, Error> {
        let mut accepted = Vec::new();
        for chunk in chunk_by_bytes(orders, |c| serde_json::to_vec(&BatchPlace { orders: c.to_vec() }).map(|v| v.len()).unwrap_or(usize::MAX)) {
            let n = chunk.len() as u32;
            let r: BatchPlaceResult = self.send_json(Method::POST, "/v3/orders/batch", vec![], Some(&BatchPlace { orders: chunk }), Cost::Tokens(Bucket::Place, n)).await?;
            accepted.extend(r.accepted);
        }
        Ok(BatchPlaceResult { accepted })
    }
    pub async fn order(&self, id: Uuid) -> Result<Order, Error> {
        self.get_json(&format!("/v3/orders/{id}"), vec![], read(), true).await
    }
    pub async fn orders(&self, f: &OrderFilter) -> Result<Page<Order>, Error> {
        let settled = matches!(f.status, Some(OrderStatus::Filled | OrderStatus::Canceled | OrderStatus::Rejected));
        let cost = if settled { Cost::Tokens(Bucket::History, 4 + f.limit.unwrap_or(100).div_ceil(100)) } else { read() };
        self.get_json("/v3/orders", order_query(f, &["event", "market", "outcome", "status", "limit", "after"]), cost, true).await
    }
    pub async fn cancel_order(&self, id: Uuid) -> Result<CancelAccepted, Error> {
        self.send_json::<(), _>(Method::DELETE, &format!("/v3/orders/{id}"), vec![], None, Cost::Tokens(Bucket::Cancel, 1)).await
    }
    /// Cancels up to 1024 orders. A partial result (`207`) or all-missing (`404`) still carries
    /// a body listing `canceled` and `notCanceled`, so both come back as `Ok`.
    pub async fn cancel_orders(&self, ids: Vec<Uuid>) -> Result<BatchCancelResult, Error> {
        let mut out = BatchCancelResult { canceled: vec![], not_canceled: vec![] };
        for chunk in chunk_by_bytes(ids, |c| serde_json::to_vec(&BatchCancel { order_ids: c.to_vec() }).map(|v| v.len()).unwrap_or(usize::MAX)) {
            let n = chunk.len() as u32;
            let body = serde_json::to_vec(&BatchCancel { order_ids: chunk })?;
            let req = Req { method: Method::DELETE, path: "/v3/orders/batch".into(), query: vec![], body: Some(body), cost: Cost::Tokens(Bucket::Cancel, n), signed: true, if_none_match: None };
            let (_, text, _) = self.send_raw(req).await?;
            let r: BatchCancelResult = serde_json::from_str(&text)?;
            out.canceled.extend(r.canceled);
            out.not_canceled.extend(r.not_canceled);
        }
        Ok(out)
    }
    pub async fn cancel_all(&self, f: &OrderFilter) -> Result<CancelAllResult, Error> {
        self.send_json::<(), _>(Method::DELETE, "/v3/orders", order_query(f, &["event", "market", "outcome"]), None, Cost::Tokens(Bucket::Cancel, 1)).await
    }
    /// The same snapshot the private `orders` channel starts with, with `seq` and an `ETag`.
    pub async fn resting_orders(&self, etag: Option<&str>) -> Result<Conditional<OrdersSnapshot>, Error> {
        self.conditional("/v3/account/orders", account(), true, etag).await
    }
    pub async fn positions_snapshot(&self, etag: Option<&str>) -> Result<Conditional<PositionsSnapshot>, Error> {
        self.conditional("/v3/account/positions", account(), true, etag).await
    }
    pub async fn fills(&self, f: &OrderFilter) -> Result<Page<Fill>, Error> {
        let cost = Cost::Tokens(Bucket::History, 8 + f.limit.unwrap_or(100).div_ceil(50));
        self.get_json("/v3/portfolio/fills", order_query(f, &["event", "market", "outcome", "order", "startsAfter", "startsBefore", "limit", "after"]), cost, true).await
    }
    pub async fn positions(&self, f: &OrderFilter) -> Result<Vec<Position>, Error> {
        self.get_json("/v3/portfolio/positions", order_query(f, &["event", "market", "outcome"]), read(), true).await
    }

    /// Follows `next` cursors until the list ends (or `max_pages`).
    pub async fn all_public_markets(&self, mut f: CatalogFilter, max_pages: usize) -> Result<Vec<Market>, Error> {
        let mut out = Vec::new();
        for _ in 0..max_pages {
            let page = self.public_markets(&f).await?;
            out.extend(page.items);
            match page.next {
                Some(n) => f.after = Some(n),
                None => break,
            }
        }
        Ok(out)
    }

    // ---------- transport ----------

    async fn get_json<T: DeserializeOwned>(&self, path: &str, query: Vec<(&str, String)>, cost: Cost, signed: bool) -> Result<T, Error> {
        let (_, text, _) = self.send_raw(Req { method: Method::GET, path: path.into(), query, body: None, cost, signed, if_none_match: None }).await?;
        Ok(serde_json::from_str(&text)?)
    }

    async fn send_json<B: Serialize, T: DeserializeOwned>(&self, method: Method, path: &str, query: Vec<(&str, String)>, body: Option<&B>, cost: Cost) -> Result<T, Error> {
        let body = body.map(serde_json::to_vec).transpose()?;
        let (_, text, _) = self.send_raw(Req { method, path: path.into(), query, body, cost, signed: true, if_none_match: None }).await?;
        Ok(serde_json::from_str(&text)?)
    }

    async fn send_unit(&self, method: Method, path: &str, query: Vec<(&str, String)>, cost: Cost) -> Result<(), Error> {
        self.send_raw(Req { method, path: path.into(), query, body: None, cost, signed: true, if_none_match: None }).await.map(|_| ())
    }

    async fn conditional<T: DeserializeOwned>(&self, path: &str, cost: Cost, signed: bool, etag: Option<&str>) -> Result<Conditional<T>, Error> {
        let (status, text, etag) = self.send_raw(Req { method: Method::GET, path: path.into(), query: vec![], body: None, cost, signed, if_none_match: etag }).await?;
        if status == StatusCode::NOT_MODIFIED {
            return Ok(Conditional::NotModified);
        }
        Ok(Conditional::Fresh { value: serde_json::from_str(&text)?, etag })
    }

    async fn send_raw(&self, req: Req<'_>) -> Result<(StatusCode, String, Option<String>), Error> {
        if req.signed && self.creds.is_none() {
            return Err(Error::NoCredentials);
        }
        // Build the query once, already in canonical encoding, so the bytes signed are the bytes sent.
        let raw_query = req.query.iter().map(|(k, v)| format!("{}={}", query::encode(k.as_bytes()), query::encode(v.as_bytes()))).collect::<Vec<_>>().join("&");
        let mut url = Url::parse(&format!("{}{}", self.env.base_url(), req.path))?;
        if !raw_query.is_empty() {
            url.set_query(Some(&raw_query));
        }
        let body = req.body.unwrap_or_default();
        let (bucket, cost_n) = match req.cost {
            Cost::Free => (None, 0),
            Cost::Tokens(b, n) => (Some(b), n),
        };

        let mut attempt = 0;
        loop {
            attempt += 1;
            let wait_start = Instant::now();
            self.throttle.acquire(req.cost).await;
            let waited_ms = wait_start.elapsed().as_millis() as u64;

            let mut rb = self.http.request(req.method.clone(), url.clone());
            let mut string_to_sign = None;
            if req.signed {
                let creds = self.creds.as_ref().expect("checked above");
                let h = creds.sign(req.method.as_str(), url.path(), url.query().unwrap_or(""), &body);
                for (k, v) in h.pairs() {
                    rb = rb.header(k, v);
                }
                string_to_sign = Some(h.string_to_sign);
            }
            if !body.is_empty() || matches!(req.method, Method::POST | Method::PATCH | Method::PUT) {
                // Without a content type the server hashes zero bytes instead of the body.
                rb = rb.header(reqwest::header::CONTENT_TYPE, "application/json").body(body.clone());
            }
            if let Some(tag) = req.if_none_match {
                rb = rb.header(reqwest::header::IF_NONE_MATCH, tag);
            }

            let started = Instant::now();
            let resp = rb.send().await?;
            let status = resp.status();
            let headers = resp.headers().clone();
            let text = resp.text().await?;
            let request_id = header(&headers, "x-request-id");
            let etag = header(&headers, "etag");
            let is_html = header(&headers, "content-type").is_some_and(|c| c.contains("text/html"));
            let err_body: Option<ErrorBody> = if status.is_success() || status == StatusCode::NOT_MODIFIED { None } else { serde_json::from_str(&text).ok() };

            if let Some(hook) = &self.hook {
                hook(&RequestRecord {
                    method: req.method.to_string(),
                    path: url.path().to_string(),
                    query: url.query().unwrap_or("").to_string(),
                    status: status.as_u16(),
                    millis: started.elapsed().as_millis() as u64,
                    bucket,
                    cost: cost_n,
                    waited_ms,
                    attempt,
                    request_id: request_id.clone(),
                    error_code: err_body.as_ref().map(|b| b.code.clone()),
                    string_to_sign: string_to_sign.clone(),
                    ts: crate::sign::now_millis(),
                });
            }

            if status == StatusCode::TOO_MANY_REQUESTS {
                let retry = header(&headers, "retry-after").and_then(|s| s.parse::<u64>().ok()).unwrap_or(1);
                match bucket {
                    Some(b) => self.throttle.penalize(b, Duration::from_secs(retry)),
                    // No bucket to block (a free route): wait here, or the retry fires instantly.
                    None => tokio::time::sleep(Duration::from_secs(retry)).await,
                }
                if attempt < self.max_attempts {
                    tracing::warn!(path = url.path(), retry, attempt, "429, waiting Retry-After");
                    continue;
                }
                return Err(Error::RateLimited { attempts: attempt });
            }
            if status.is_success() || status == StatusCode::NOT_MODIFIED || (status.as_u16() == 207) {
                return Ok((status, text, etag));
            }
            // DELETE /v3/orders/batch answers 404 with a BatchCancelResult body when nothing matched.
            if status == StatusCode::NOT_FOUND && req.path == "/v3/orders/batch" && text.contains("notCanceled") {
                return Ok((status, text, etag));
            }
            if status == StatusCode::FORBIDDEN && (is_html || err_body.is_none()) {
                return Err(Error::Edge { request_id });
            }
            return match err_body {
                Some(body) => Err(Error::Api { status: status.as_u16(), code: body.code.clone(), message: body.message.clone(), request_id, body }),
                None => Err(Error::Unexpected { status: status.as_u16(), body: text.chars().take(500).collect() }),
            };
        }
    }
}

/// The edge refuses bodies over 8 KiB with an HTML 403; keep a little headroom.
pub const EDGE_BODY_LIMIT: usize = 8192;

/// Greedily packs items so each serialized chunk stays under the edge limit.
pub fn chunk_by_bytes<T: Clone>(items: Vec<T>, size_of: impl Fn(&[T]) -> usize) -> Vec<Vec<T>> {
    let limit = EDGE_BODY_LIMIT - 256;
    let mut out: Vec<Vec<T>> = vec![];
    let mut cur: Vec<T> = vec![];
    for it in items {
        cur.push(it);
        if cur.len() > 1 && size_of(&cur) > limit {
            let last = cur.pop().unwrap();
            out.push(std::mem::take(&mut cur));
            cur.push(last);
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_1024_order_batch_is_split_under_the_edge_cap() {
        let o = PlaceOrder { outcome_id: Uuid::nil(), price: "0.665".parse().unwrap(), qty: 1000, tif: TimeInForce::GTC, ttl: None, client_id: Some(Uuid::nil()) };
        let chunks = chunk_by_bytes(vec![o; 1024], |c| serde_json::to_vec(&BatchPlace { orders: c.to_vec() }).unwrap().len());
        assert_eq!(chunks.iter().map(Vec::len).sum::<usize>(), 1024);
        assert!(chunks.len() > 10);
        for c in &chunks {
            assert!(serde_json::to_vec(&BatchPlace { orders: c.clone() }).unwrap().len() <= EDGE_BODY_LIMIT);
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum TypeList {
    Leagues,
    Sports,
    Markets,
    EventStatuses,
}

impl TypeList {
    fn path(self) -> &'static str {
        match self {
            TypeList::Leagues => "leagues",
            TypeList::Sports => "sports",
            TypeList::Markets => "markets",
            TypeList::EventStatuses => "event-statuses",
        }
    }
}

fn public() -> Cost {
    Cost::Tokens(Bucket::Public, 1)
}
fn read() -> Cost {
    Cost::Tokens(Bucket::Read, 1)
}
fn account() -> Cost {
    Cost::Tokens(Bucket::Account, 1)
}

fn header(h: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    h.get(name).and_then(|v| v.to_str().ok()).map(str::to_string)
}

fn push<'a>(q: &mut Vec<(&'a str, String)>, k: &'a str, v: Option<impl ToString>) {
    if let Some(v) = v {
        q.push((k, v.to_string()));
    }
}

fn page_query<'a>(limit: Option<u32>, after: Option<&str>) -> Vec<(&'a str, String)> {
    let mut q = vec![];
    push(&mut q, "limit", limit);
    push(&mut q, "after", after);
    q
}

fn market_query(f: &CatalogFilter) -> Vec<(&'static str, String)> {
    let mut q = vec![];
    push(&mut q, "league", f.league.as_ref());
    push(&mut q, "marketType", f.market_type.as_ref());
    push(&mut q, "eventStatus", f.event_status.as_ref());
    push(&mut q, "event", f.event);
    push(&mut q, "startsAfter", f.starts_after);
    push(&mut q, "startsBefore", f.starts_before);
    push(&mut q, "limit", f.limit);
    push(&mut q, "after", f.after.as_ref());
    q
}

fn event_query(f: &CatalogFilter) -> Vec<(&'static str, String)> {
    let mut q = vec![];
    push(&mut q, "league", f.league.as_ref());
    push(&mut q, "status", f.status.as_ref());
    push(&mut q, "startsAfter", f.starts_after);
    push(&mut q, "startsBefore", f.starts_before);
    push(&mut q, "limit", f.limit);
    push(&mut q, "after", f.after.as_ref());
    q
}

fn enum_str<T: Serialize>(v: &T) -> String {
    serde_json::to_value(v).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

fn order_query(f: &OrderFilter, allowed: &[&str]) -> Vec<(&'static str, String)> {
    let mut q: Vec<(&'static str, String)> = vec![];
    let all: [(&'static str, Option<String>); 10] = [
        ("event", f.event.map(|v| v.to_string())),
        ("market", f.market.map(|v| v.to_string())),
        ("outcome", f.outcome.map(|v| v.to_string())),
        ("order", f.order.map(|v| v.to_string())),
        ("status", f.status.as_ref().map(enum_str)),
        ("kind", f.kind.as_ref().map(enum_str)),
        ("startsAfter", f.starts_after.map(|v| v.to_string())),
        ("startsBefore", f.starts_before.map(|v| v.to_string())),
        ("limit", f.limit.map(|v| v.to_string())),
        ("after", f.after.clone()),
    ];
    for (k, v) in all {
        if allowed.contains(&k) {
            push(&mut q, k, v);
        }
    }
    q
}
