//! A reference maker for one two-outcome Novig market.
//!
//! Every Novig order buys, so a two-sided quote is a bid on each outcome: bidding 0.47 on B is
//! offering A at 0.53. The strategy:
//! - fair value = mid of the book *excluding our own orders*, skewed against inventory
//! - bid each outcome `half_spread` ticks under fair, snapped down to the price grid, post-only
//! - reprice when fair moves `requote_ticks`, at most once per `min_requote_ms`
//! - `GOLIVE` voids every resting order: forget quotes, flip fees on, and wait `golive_cooldown_ms`
//! - account maker credits exactly as `makerCredit × c·P(1-P)·N·1¢` when the market charges
//!
//! [`Mode::Paper`] never sends an order. It rests virtual quotes in the real queue and fills them
//! only when the exchange's own executions prove a taker would have reached them (every order
//! ahead at our price consumed, or a trade at a worse price). [`Mode::Live`] sends post-only
//! orders and learns its state from the private `orders` channel, never from the `201`.

use novig_v3::book::{Book, RemoveReason, Removal};
use novig_v3::types::{self, Chargeability, MarketFee, PlaceOrder, Price, TimeInForce};
use novig_v3::ws::{OrderEvent, WsEvent};
use novig_v3::Client;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Paper,
    Live,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotConfig {
    pub market_id: Uuid,
    /// The two outcomes, and display names for them.
    pub outcomes: [Uuid; 2],
    pub names: [String; 2],
    pub mode: Mode,
    pub fee: MarketFee,
    /// Distance from fair to each bid, in grid ticks.
    pub half_spread_ticks: u16,
    /// Contracts per quote.
    pub size: i32,
    /// Stop bidding an outcome once net exposure to it reaches this.
    pub max_position: i32,
    /// How far fair shifts (in ticks) at full inventory.
    pub skew_ticks_at_max: f64,
    pub requote_ticks: u16,
    pub min_requote_ms: u64,
    pub golive_cooldown_ms: u64,
}

impl BotConfig {
    pub fn new(market_id: Uuid, outcomes: [Uuid; 2], names: [String; 2], fee: MarketFee, mode: Mode) -> Self {
        Self { market_id, outcomes, names, mode, fee, half_spread_ticks: 1, size: 500, max_position: 5_000, skew_ticks_at_max: 3.0, requote_ticks: 1, min_requote_ms: 400, golive_cooldown_ms: 2_000 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QuoteStatus {
    /// Sent, waiting for the private stream's `open`.
    Pending,
    Open,
    Canceling,
}

#[derive(Debug, Clone, Serialize)]
pub struct QuoteView {
    pub outcome: Uuid,
    pub name: String,
    pub order_id: Uuid,
    pub price: Price,
    pub qty: i32,
    pub remaining: i32,
    pub status: QuoteStatus,
    /// Contracts ahead of us at our price (paper mode tracks this exactly from the queue).
    pub ahead: i64,
    pub placed_ts: i64,
}

#[derive(Debug, Clone)]
struct Quote {
    view: QuoteView,
    client_id: Uuid,
    /// Orders resting at our price when we joined, and how much of each is still ahead.
    ahead_orders: HashMap<Uuid, i32>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct PositionView {
    pub qty: i32,
    pub cost: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub struct FillView {
    pub ts: i64,
    pub outcome: Uuid,
    pub name: String,
    pub price: Price,
    pub qty: i32,
    pub maker_credit: Decimal,
    pub live: bool,
    pub how: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
    pub ts: i64,
    pub level: &'static str,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Pnl {
    pub cost: Decimal,
    pub mark_value: Decimal,
    pub maker_credits: Decimal,
    /// Pairs of A+B contracts pay 1¢ whatever happens: locked in.
    pub locked_pairs: i32,
    pub total: Decimal,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Counters {
    pub placed: u64,
    pub canceled: u64,
    pub rejected: u64,
    pub fills: u64,
    pub requotes: u64,
    pub golives: u64,
    pub contracts_traded: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BotState {
    pub running: bool,
    pub mode: Mode,
    pub config: BotConfig,
    pub status: String,
    pub live: bool,
    /// Fair value of outcome 0 in thousandths, before skew.
    pub fair: Option<f64>,
    pub skewed_fair: Option<f64>,
    pub quotes: Vec<QuoteView>,
    pub positions: BTreeMap<Uuid, PositionView>,
    pub pnl: Pnl,
    pub counters: Counters,
    pub fills: VecDeque<FillView>,
    pub log: VecDeque<LogLine>,
}

/// What the driver must do next. Paper mode resolves these internally.
#[derive(Debug, Clone)]
pub enum Action {
    Place(PlaceOrder),
    Cancel(Uuid),
}

pub struct Bot {
    cfg: BotConfig,
    running: bool,
    live: bool,
    quotes: HashMap<Uuid, Quote>, // outcome → quote
    positions: HashMap<Uuid, PositionView>,
    credits: Decimal,
    fair: Option<f64>,
    skewed: Option<f64>,
    cooldown_until: i64,
    last_requote: i64,
    counters: Counters,
    fills: VecDeque<FillView>,
    log: VecDeque<LogLine>,
    status: String,
    /// Live mode: our order ids, so fair value can exclude our own liquidity.
    ours: HashSet<Uuid>,
}

impl Bot {
    pub fn new(cfg: BotConfig) -> Self {
        let mut b = Self {
            cfg,
            running: false,
            live: false,
            quotes: HashMap::new(),
            positions: HashMap::new(),
            credits: Decimal::ZERO,
            fair: None,
            skewed: None,
            cooldown_until: 0,
            last_requote: 0,
            counters: Counters::default(),
            fills: VecDeque::new(),
            log: VecDeque::new(),
            status: "stopped".into(),
            ours: HashSet::new(),
        };
        b.info(format!("ready: {} mode, {} vs {}", match b.cfg.mode { Mode::Paper => "paper", Mode::Live => "live" }, b.cfg.names[0], b.cfg.names[1]));
        b
    }

    pub fn config(&self) -> &BotConfig {
        &self.cfg
    }

    pub fn set_config(&mut self, cfg: BotConfig) {
        self.info(format!("config: ±{} ticks, size {}, max {}", cfg.half_spread_ticks, cfg.size, cfg.max_position));
        self.cfg = cfg;
        self.last_requote = 0;
    }

    pub fn start(&mut self) {
        self.running = true;
        self.status = "quoting".into();
        self.info("started".into());
    }

    /// Stops quoting and returns cancels for anything resting.
    pub fn stop(&mut self) -> Vec<Action> {
        self.running = false;
        self.status = "stopped".into();
        self.info("stopped: pulling quotes".into());
        self.pull_all()
    }

    fn pull_all(&mut self) -> Vec<Action> {
        let mut out = vec![];
        let outcomes: Vec<Uuid> = self.quotes.keys().copied().collect();
        for o in outcomes {
            if let Some(a) = self.cancel_quote(o) {
                out.push(a);
            }
        }
        out
    }

    fn cancel_quote(&mut self, outcome: Uuid) -> Option<Action> {
        match self.cfg.mode {
            Mode::Paper => {
                self.quotes.remove(&outcome);
                self.counters.canceled += 1;
                None
            }
            Mode::Live => {
                let q = self.quotes.get_mut(&outcome)?;
                if q.view.status == QuoteStatus::Canceling {
                    return None;
                }
                q.view.status = QuoteStatus::Canceling;
                Some(Action::Cancel(q.view.order_id))
            }
        }
    }

    /// Feed every websocket event for this market (and private events in live mode), plus the
    /// current book. Returns orders to send or cancel.
    pub fn on_event(&mut self, ev: &WsEvent, book: Option<&Book>, now: i64) -> Vec<Action> {
        let mut actions = vec![];
        match ev {
            WsEvent::Lifecycle { market_id, transitions, status, .. } if *market_id == self.cfg.market_id => {
                for t in transitions {
                    match t.as_str() {
                        "GOLIVE" => {
                            self.counters.golives += 1;
                            self.live = true;
                            // The engine already voided our orders; don't send cancels for them.
                            self.quotes.clear();
                            self.cooldown_until = now + self.cfg.golive_cooldown_ms as i64;
                            self.warn(format!("GOLIVE: every resting order voided, taker fees on. Standing down {} ms.", self.cfg.golive_cooldown_ms));
                        }
                        "UNLIVE" => {
                            self.live = false;
                            self.quotes.clear();
                            self.warn("UNLIVE: book drained, taker fees off".into());
                        }
                        "CLOSE" | "GRADE" => {
                            self.quotes.clear();
                            self.running = false;
                            self.status = format!("market {}", status.clone().unwrap_or_else(|| t.clone()).to_lowercase());
                            self.warn(format!("{t}: market no longer trades, bot stopped"));
                        }
                        _ => {}
                    }
                }
            }
            WsEvent::BookReset { market_id, .. } if *market_id == self.cfg.market_id => {
                // After a resync our queue estimates can't be trusted; re-measure from the book.
                if let (Mode::Paper, Some(book)) = (self.cfg.mode, book) {
                    for q in self.quotes.values_mut() {
                        q.ahead_orders.retain(|id, _| book.find(id).is_some());
                        q.view.ahead = q.ahead_orders.values().map(|v| *v as i64).sum();
                    }
                }
            }
            WsEvent::Removals { market_id, removals, .. } if *market_id == self.cfg.market_id => {
                if self.cfg.mode == Mode::Paper {
                    self.paper_fills(removals, now);
                }
            }
            WsEvent::Orders { events, .. } if self.cfg.mode == Mode::Live => {
                for e in events {
                    self.on_order_event(e, now);
                }
            }
            _ => {}
        }
        if let Some(book) = book {
            self.update_fair(book);
            if self.running {
                actions.extend(self.requote(book, now));
            }
        }
        actions
    }

    /// Records the exchange's answer to a `Place` (live mode).
    pub fn on_placed(&mut self, client_id: Uuid, order_id: Uuid) {
        for q in self.quotes.values_mut() {
            if q.client_id == client_id {
                q.view.order_id = order_id;
                self.ours.insert(order_id);
            }
        }
    }

    pub fn on_place_failed(&mut self, client_id: Uuid, why: &str) {
        self.quotes.retain(|_, q| q.client_id != client_id);
        self.counters.rejected += 1;
        self.warn(format!("place refused: {why}"));
    }

    fn on_order_event(&mut self, e: &OrderEvent, now: i64) {
        match e {
            OrderEvent::Open { order_id, qty, .. } => {
                if let Some(q) = self.quotes.values_mut().find(|q| q.view.order_id == *order_id) {
                    q.view.status = QuoteStatus::Open;
                    q.view.remaining = *qty;
                }
            }
            OrderEvent::Fill { order_id, outcome_id, price, qty, remaining, .. } => {
                if self.ours.contains(order_id) {
                    self.record_fill(*outcome_id, *price, *qty, now, "exchange fill".into());
                    if let Some(q) = self.quotes.get_mut(outcome_id) {
                        q.view.remaining = *remaining;
                        if *remaining == 0 {
                            self.quotes.remove(outcome_id);
                        }
                    }
                }
            }
            OrderEvent::Cancel { order_id, reason } => {
                self.quotes.retain(|_, q| q.view.order_id != *order_id);
                self.counters.canceled += 1;
                if let Some(r) = reason {
                    self.info(format!("order canceled by engine: {r}"));
                }
            }
            OrderEvent::Reject { order_id } => {
                self.quotes.retain(|_, q| q.view.order_id != *order_id);
                self.counters.rejected += 1;
                self.warn("post-only order rejected (it would have crossed)".into());
            }
        }
    }

    /// Queue-aware paper fills: we only fill when the exchange's own executions prove a taker
    /// would have reached our virtual order.
    fn paper_fills(&mut self, removals: &[Removal], now: i64) {
        let mut fills = vec![];
        for q in self.quotes.values_mut() {
            for r in removals.iter().filter(|r| r.outcome == q.view.outcome) {
                if let Some(ahead) = q.ahead_orders.get_mut(&r.order) {
                    let gone = if r.reason == RemoveReason::Fill { r.executed } else { r.resting_qty };
                    *ahead -= gone.min(*ahead);
                    if r.reason == RemoveReason::Cancel || *ahead == 0 {
                        q.ahead_orders.remove(&r.order);
                    }
                    q.view.ahead = q.ahead_orders.values().map(|v| *v as i64).sum();
                    continue;
                }
                if r.reason != RemoveReason::Fill || r.executed == 0 || r.price > q.view.price {
                    continue;
                }
                // A trade at our price behind us, or at a worse price: the taker went through us.
                let n = q.view.remaining.min(r.executed);
                if n > 0 {
                    q.view.remaining -= n;
                    q.ahead_orders.clear();
                    q.view.ahead = 0;
                    let how = if r.price == q.view.price { "queue reached at our price".to_string() } else { format!("trade at worse price {}", r.price) };
                    fills.push((q.view.outcome, q.view.price, n, how));
                }
            }
        }
        for (outcome, price, n, how) in fills {
            self.record_fill(outcome, price, n, now, how);
        }
        self.quotes.retain(|_, q| q.view.remaining > 0);
    }

    fn record_fill(&mut self, outcome: Uuid, price: Price, qty: i32, now: i64, how: String) {
        let charged = matches!(self.cfg.fee.charged, Chargeability::Always) || (self.cfg.fee.charged == Chargeability::WhenLive && self.live);
        let credit = if charged { types::maker_credit(&self.cfg.fee, price, qty) } else { Decimal::ZERO };
        self.credits += credit;
        let p = self.positions.entry(outcome).or_default();
        p.qty += qty;
        p.cost += types::cost(price, qty);
        self.counters.fills += 1;
        self.counters.contracts_traded += qty as i64;
        let name = self.name(outcome);
        self.fills.push_front(FillView { ts: now, outcome, name: name.clone(), price, qty, maker_credit: credit, live: self.live, how });
        self.fills.truncate(50);
        self.info(format!("filled {qty} {name} @ {price}{}", if credit > Decimal::ZERO { format!(" (+${credit} maker credit)") } else { String::new() }));
    }

    fn name(&self, outcome: Uuid) -> String {
        if outcome == self.cfg.outcomes[0] { self.cfg.names[0].clone() } else { self.cfg.names[1].clone() }
    }

    /// Best bid on an outcome, ignoring our own resting orders.
    fn best_bid_excl(&self, book: &Book, outcome: &Uuid) -> Option<Price> {
        book.queue(outcome).iter().find(|o| !self.ours.contains(&o.order_id)).map(|o| o.price)
    }

    fn update_fair(&mut self, book: &Book) {
        let [a, b] = self.cfg.outcomes;
        let bid_a = self.best_bid_excl(book, &a);
        let offer_a = self.best_bid_excl(book, &b).map(|p| p.complement());
        self.fair = match (bid_a, offer_a) {
            (Some(bid), Some(offer)) if offer.milli() > bid.milli() => Some((bid.milli() as f64 + offer.milli() as f64) / 2.0),
            (Some(bid), Some(offer)) => Some(bid.milli().min(offer.milli()) as f64),
            _ => None,
        };
        let net = self.net_position();
        let skew = if self.cfg.max_position > 0 { (net as f64 / self.cfg.max_position as f64).clamp(-1.0, 1.0) * self.cfg.skew_ticks_at_max * 5.0 } else { 0.0 };
        // Long A: lower fair so we bid A less and B more.
        self.skewed = self.fair.map(|f| f - skew);
    }

    /// Net exposure to outcome 0 (pairs of A+B cancel out).
    fn net_position(&self) -> i32 {
        let qa = self.positions.get(&self.cfg.outcomes[0]).map(|p| p.qty).unwrap_or(0);
        let qb = self.positions.get(&self.cfg.outcomes[1]).map(|p| p.qty).unwrap_or(0);
        qa - qb
    }

    fn requote(&mut self, book: &Book, now: i64) -> Vec<Action> {
        let mut actions = vec![];
        if now < self.cooldown_until {
            self.status = "cooling down after GOLIVE".into();
            return actions;
        }
        let Some(fair) = self.skewed else {
            self.status = "waiting for a two-sided book".into();
            return actions;
        };
        if now - self.last_requote < self.cfg.min_requote_ms as i64 {
            return actions;
        }
        self.status = "quoting".into();
        let [a, b] = self.cfg.outcomes;
        let net = self.net_position();
        let mut changed = false;
        for (outcome, fair_o) in [(a, fair), (b, 1000.0 - fair)] {
            let tick = if (55.0..=945.0).contains(&fair_o) { 5.0 } else { 1.0 };
            let target = fair_o - self.cfg.half_spread_ticks as f64 * tick;
            let mut price = match Price::snap_down(target.floor().max(1.0) as u16) {
                Some(p) => p,
                None => continue,
            };
            // Stay a maker: never at or through the best price we could buy at right now.
            let other = if outcome == a { b } else { a };
            if let Some(opp) = self.best_bid_excl(book, &other) {
                let offer = opp.complement().milli();
                if price.milli() >= offer {
                    match Price::snap_down(offer.saturating_sub(1)) {
                        Some(p) => price = p,
                        None => continue,
                    }
                }
            }
            let exposure = if outcome == a { net } else { -net };
            let want = exposure < self.cfg.max_position;
            let current = self.quotes.get(&outcome).map(|q| (q.view.price, q.view.status));
            match (want, current) {
                (false, Some(_)) => {
                    if let Some(x) = self.cancel_quote(outcome) {
                        actions.push(x);
                    }
                    changed = true;
                }
                (true, Some((p, st))) if st != QuoteStatus::Canceling && (p.milli() as i32 - price.milli() as i32).unsigned_abs() >= self.cfg.requote_ticks as u32 * price.tick() as u32 => {
                    if let Some(x) = self.cancel_quote(outcome) {
                        actions.push(x);
                    }
                    if self.cfg.mode == Mode::Paper {
                        actions.extend(self.place(book, outcome, price, now));
                    }
                    self.counters.requotes += 1;
                    changed = true;
                }
                (true, None) => {
                    actions.extend(self.place(book, outcome, price, now));
                    changed = true;
                }
                _ => {}
            }
        }
        if changed {
            self.last_requote = now;
        }
        actions
    }

    fn place(&mut self, book: &Book, outcome: Uuid, price: Price, now: i64) -> Vec<Action> {
        let client_id = Uuid::new_v4();
        // Everything resting at our price now is ahead of us; later arrivals are behind.
        let ahead_orders: HashMap<Uuid, i32> = book.queue(&outcome).iter().filter(|o| o.price == price && !self.ours.contains(&o.order_id)).map(|o| (o.order_id, o.qty)).collect();
        let ahead = ahead_orders.values().map(|v| *v as i64).sum();
        let order_id = if self.cfg.mode == Mode::Paper { Uuid::new_v4() } else { Uuid::nil() };
        let view = QuoteView {
            outcome,
            name: self.name(outcome),
            order_id,
            price,
            qty: self.cfg.size,
            remaining: self.cfg.size,
            status: if self.cfg.mode == Mode::Paper { QuoteStatus::Open } else { QuoteStatus::Pending },
            ahead,
            placed_ts: now,
        };
        self.quotes.insert(outcome, Quote { view, client_id, ahead_orders });
        self.counters.placed += 1;
        match self.cfg.mode {
            Mode::Paper => vec![],
            Mode::Live => vec![Action::Place(PlaceOrder { outcome_id: outcome, price, qty: self.cfg.size, tif: TimeInForce::PO, ttl: None, client_id: Some(client_id) })],
        }
    }

    pub fn state(&self, book: Option<&Book>) -> BotState {
        let mut positions = BTreeMap::new();
        for o in self.cfg.outcomes {
            positions.insert(o, self.positions.get(&o).cloned().unwrap_or_default());
        }
        let [a, b] = self.cfg.outcomes;
        let (qa, qb) = (positions[&a].qty, positions[&b].qty);
        let cost = positions[&a].cost + positions[&b].cost;
        let mark = book.and(self.fair).map(|f| {
            let fa = Decimal::from_f64_retain(f / 1000.0).unwrap_or_default();
            (Decimal::from(qa) * fa + Decimal::from(qb) * (Decimal::ONE - fa)) / Decimal::from(100)
        });
        let mark_value = mark.unwrap_or_default().round_dp(5);
        let pnl = Pnl { cost, mark_value, maker_credits: self.credits, locked_pairs: qa.min(qb), total: (mark_value - cost + self.credits).round_dp(5) };
        let mut quotes: Vec<QuoteView> = self.quotes.values().map(|q| q.view.clone()).collect();
        quotes.sort_by_key(|q| if q.outcome == a { 0 } else { 1 });
        BotState {
            running: self.running,
            mode: self.cfg.mode,
            config: self.cfg.clone(),
            status: self.status.clone(),
            live: self.live,
            fair: self.fair,
            skewed_fair: self.skewed,
            quotes,
            positions,
            pnl,
            counters: self.counters.clone(),
            fills: self.fills.clone(),
            log: self.log.clone(),
        }
    }

    fn info(&mut self, text: String) {
        self.push_log("info", text);
    }
    fn warn(&mut self, text: String) {
        self.push_log("warn", text);
    }
    fn push_log(&mut self, level: &'static str, text: String) {
        self.log.push_front(LogLine { ts: novig_v3::sign::now_millis(), level, text });
        self.log.truncate(100);
    }
}

/// Sends a live action through the API and reports back to the bot.
pub async fn execute(client: &Client, bot: &tokio::sync::Mutex<Bot>, action: Action) {
    match action {
        Action::Place(order) => {
            let cid = order.client_id.unwrap_or_default();
            match client.place_order(&order).await {
                Ok(acc) => bot.lock().await.on_placed(cid, acc.order_id),
                Err(e) => bot.lock().await.on_place_failed(cid, &e.to_string()),
            }
        }
        Action::Cancel(id) => {
            if let Err(e) = client.cancel_order(id).await {
                tracing::warn!("cancel {id}: {e}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use novig_v3::book::BookDelta;
    use std::str::FromStr;

    fn p(s: &str) -> Price {
        Price::from_str(s).unwrap()
    }

    fn setup() -> (Bot, Book, Uuid, Uuid) {
        let (a, b) = (Uuid::from_u128(1), Uuid::from_u128(2));
        let fee = MarketFee { coefficient: "0.03".parse().unwrap(), maker_credit: "0.5".parse().unwrap(), charged: Chargeability::WhenLive };
        let mut cfg = BotConfig::new(Uuid::from_u128(9), [a, b], ["HOU".into(), "CWS".into()], fee, Mode::Paper);
        cfg.min_requote_ms = 0;
        let mut bot = Bot::new(cfg);
        bot.start();
        let mut book = Book::new([a, b]);
        book.apply(1, &[
            BookDelta::Add { order: Uuid::from_u128(100), outcome: a, price: p("0.540"), qty: 1000 },
            BookDelta::Add { order: Uuid::from_u128(101), outcome: b, price: p("0.440"), qty: 1000 },
        ]);
        (bot, book, a, b)
    }

    #[test]
    fn quotes_both_sides_around_mid_without_crossing() {
        let (mut bot, book, a, b) = setup();
        bot.on_event(&WsEvent::BookReset { market_id: Uuid::from_u128(9), seq: 1 }, Some(&book), 1_000);
        let s = bot.state(Some(&book));
        assert_eq!(s.fair, Some(550.0), "mid of 0.540 bid and 0.560 offer");
        let qa = s.quotes.iter().find(|q| q.outcome == a).unwrap();
        let qb = s.quotes.iter().find(|q| q.outcome == b).unwrap();
        assert_eq!(qa.price, p("0.545"));
        assert_eq!(qb.price, p("0.445"));
        assert!(qa.price.milli() + qb.price.milli() < 1000);
    }

    #[test]
    fn paper_fill_needs_the_queue_ahead_to_clear() {
        let (mut bot, mut book, a, _) = setup();
        let m = Uuid::from_u128(9);
        // Join an existing level so there is a queue ahead of us.
        let mut cfg = bot.config().clone();
        cfg.half_spread_ticks = 2;
        bot.set_config(cfg);
        bot.on_event(&WsEvent::BookReset { market_id: m, seq: 1 }, Some(&book), 1_000);
        let q = bot.state(Some(&book)).quotes.into_iter().find(|q| q.outcome == a).unwrap();
        assert_eq!(q.price, p("0.540"));
        assert_eq!(q.ahead, 1000);
        // 600 of the 1000 ahead trades: no fill for us yet.
        let deltas = [BookDelta::Remove { order: Uuid::from_u128(100), reason: Some(RemoveReason::Fill) }, BookDelta::Add { order: Uuid::from_u128(100), outcome: a, price: p("0.540"), qty: 400 }];
        let removals = book.removals(&deltas);
        book.apply(2, &deltas);
        bot.on_event(&WsEvent::Removals { market_id: m, seq: 2, removals }, Some(&book), 2_000);
        let s = bot.state(Some(&book));
        assert_eq!(s.counters.fills, 0);
        assert_eq!(s.quotes.iter().find(|q| q.outcome == a).unwrap().ahead, 400);
        // A trade at a worse price proves the taker went through our level.
        let deltas = [BookDelta::Add { order: Uuid::from_u128(200), outcome: a, price: p("0.530"), qty: 300 }];
        book.apply(3, &deltas);
        let deltas = [BookDelta::Remove { order: Uuid::from_u128(100), reason: Some(RemoveReason::Fill) }, BookDelta::Remove { order: Uuid::from_u128(200), reason: Some(RemoveReason::Fill) }];
        let removals = book.removals(&deltas);
        book.apply(4, &deltas);
        bot.on_event(&WsEvent::Removals { market_id: m, seq: 4, removals }, Some(&book), 3_000);
        let s = bot.state(Some(&book));
        assert_eq!(s.counters.fills, 1);
        assert_eq!(s.positions[&a].qty, 300, "min(our 500, the 300 that traded through)");
        assert_eq!(s.pnl.maker_credits, Decimal::ZERO, "pregame on a WHEN_LIVE market: no fee, no credit");
    }

    #[test]
    fn golive_voids_quotes_and_turns_credits_on() {
        let (mut bot, book, _, _) = setup();
        let m = Uuid::from_u128(9);
        bot.on_event(&WsEvent::BookReset { market_id: m, seq: 1 }, Some(&book), 1_000);
        assert_eq!(bot.state(None).quotes.len(), 2);
        bot.on_event(&WsEvent::Lifecycle { market_id: m, seq: 2, status: None, transitions: vec!["GOLIVE".into()] }, Some(&book), 1_100);
        let s = bot.state(None);
        assert!(s.live);
        assert!(s.quotes.is_empty(), "stands down during cooldown");
        bot.on_event(&WsEvent::BookReset { market_id: m, seq: 2 }, Some(&book), 5_000);
        assert_eq!(bot.state(None).quotes.len(), 2, "requotes after cooldown");
    }

    #[test]
    fn live_mode_sends_post_only_and_waits_for_open() {
        let (a, b) = (Uuid::from_u128(1), Uuid::from_u128(2));
        let fee = MarketFee { coefficient: "0.06".parse().unwrap(), maker_credit: "0.7".parse().unwrap(), charged: Chargeability::Always };
        let mut cfg = BotConfig::new(Uuid::from_u128(9), [a, b], ["A".into(), "B".into()], fee, Mode::Live);
        cfg.min_requote_ms = 0;
        let mut bot = Bot::new(cfg);
        bot.start();
        let mut book = Book::new([a, b]);
        book.apply(1, &[
            BookDelta::Add { order: Uuid::from_u128(100), outcome: a, price: p("0.300"), qty: 10 },
            BookDelta::Add { order: Uuid::from_u128(101), outcome: b, price: p("0.600"), qty: 10 },
        ]);
        let actions = bot.on_event(&WsEvent::BookReset { market_id: Uuid::from_u128(9), seq: 1 }, Some(&book), 1);
        let places: Vec<_> = actions.iter().filter_map(|x| if let Action::Place(o) = x { Some(o) } else { None }).collect();
        assert_eq!(places.len(), 2);
        assert!(places.iter().all(|o| o.tif == TimeInForce::PO));
        assert!(bot.state(None).quotes.iter().all(|q| q.status == QuoteStatus::Pending));
        let cid = places[0].client_id.unwrap();
        bot.on_placed(cid, Uuid::from_u128(777));
        bot.on_event(&WsEvent::Orders { seq: 1, events: vec![OrderEvent::Open { order_id: Uuid::from_u128(777), client_id: Some(cid), market_id: Uuid::from_u128(9), outcome_id: places[0].outcome_id, price: places[0].price, qty: 500, tif: TimeInForce::PO, expires_at: None }] }, None, 2);
        bot.on_event(&WsEvent::Orders { seq: 2, events: vec![OrderEvent::Fill { order_id: Uuid::from_u128(777), client_id: Some(cid), outcome_id: places[0].outcome_id, price: places[0].price, qty: 100, remaining: 400 }] }, None, 3);
        let s = bot.state(None);
        assert_eq!(s.counters.fills, 1);
        assert!(s.pnl.maker_credits > Decimal::ZERO, "futures schedule charges always: credit earned");
    }
}
