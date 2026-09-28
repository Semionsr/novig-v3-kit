//! v3 wire types, taken from Novig's OpenAPI 3.1 spec (`openapi-v3-target.json`).
//!
//! Money never touches a float: prices and balances are strings on the wire and
//! [`Decimal`] here. Quantities are whole contracts, and one contract pays 1¢.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::sign::Algorithm;

// ---------- catalog ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventStatus {
    OpenPregame,
    ClosedPregame,
    OpenIngame,
    Settled,
    Final,
    Delayed,
    Canceled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MarketStatus {
    Open,
    Closed,
    Settled,
}

/// How a voided market pays: at stake (`PUSH`) or at fair market value (`FMV`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Voidability {
    Push,
    Fmv,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Chargeability {
    Always,
    WhenLive,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketFee {
    #[serde(with = "rust_decimal::serde::str")]
    pub coefficient: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub maker_credit: Decimal,
    pub charged: Chargeability,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub outcome_id: Uuid,
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Market {
    pub market_id: Uuid,
    pub event_id: Uuid,
    pub market_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strike: Option<String>,
    pub status: MarketStatus,
    pub voids: Voidability,
    pub description: String,
    pub starts_ts: i64,
    pub fee: MarketFee,
    pub outcomes: Vec<Outcome>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub event_id: Uuid,
    pub sport: String,
    pub league: String,
    pub status: EventStatus,
    pub description: String,
    pub starts_ts: i64,
}

/// Every list route pages with an opaque cursor: pass `next` back as `cursor`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestingOrder {
    pub order_id: Uuid,
    pub price: Price,
    pub qty: i32,
}

/// `GET .../book`: every resting order per outcome, best price first, time priority within a
/// price. The array order is the queue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSnapshot {
    pub market_id: Uuid,
    pub seq: i64,
    pub orders: std::collections::BTreeMap<Uuid, Vec<RestingOrder>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trade {
    pub trade_id: Uuid,
    pub outcome_id: Uuid,
    pub price: Price,
    pub qty: i32,
    pub ts: i64,
}

// ---------- keys & accounts ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KeyScope {
    #[serde(rename = "management")]
    Management,
    #[serde(rename = "management::read")]
    ManagementRead,
    #[serde(rename = "trading")]
    Trading,
    #[serde(rename = "trading::read")]
    TradingRead,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Key {
    pub key_id: Uuid,
    pub name: String,
    pub fingerprint: String,
    pub algorithm: Algorithm,
    pub scope: KeyScope,
    pub restriction: Option<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKey {
    pub name: String,
    pub public_key: String,
    pub algorithm: Algorithm,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSubaccountKey {
    pub name: String,
    pub public_key: String,
    pub algorithm: Algorithm,
    pub scope: KeyScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyCreated {
    pub key_id: Uuid,
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSubaccount {
    pub label: String,
    pub public_key: String,
    pub algorithm: Algorithm,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subaccount {
    pub key_id: Uuid,
    pub label: String,
    #[serde(with = "rust_decimal::serde::str")]
    pub balance: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Balance {
    pub key_id: Uuid,
    #[serde(with = "rust_decimal::serde::str")]
    pub balance: Decimal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferDirection {
    Fund,
    Defund,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequest {
    pub direction: TransferDirection,
    #[serde(with = "rust_decimal::serde::str")]
    pub amount: Decimal,
    /// Idempotency key: resending the same id never moves money twice.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_transfer_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferStatus {
    Requested,
    Applied,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub transfer_id: Uuid,
    pub status: TransferStatus,
    pub direction: TransferDirection,
    pub amount: String,
    pub actual_balance: Option<String>,
    #[serde(default)]
    pub client_transfer_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransactionKind {
    Fill,
    Fee,
    MakerCredit,
    Settlement,
    TransferIn,
    TransferOut,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub transaction_id: Uuid,
    pub kind: TransactionKind,
    #[serde(with = "rust_decimal::serde::str")]
    pub amount: Decimal,
    #[serde(default, rename = "ref")]
    pub reference: Option<String>,
    pub ts: i64,
}

// ---------- orders ----------

/// `GTT` needs a `ttl`. `IOC`/`FOK`/`PO` that can't rest arrive as a `reject` on the private
/// stream, not as an HTTP error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TimeInForce {
    GTC,
    GTT,
    IOC,
    FOK,
    PO,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrderStatus {
    Pending,
    Open,
    Filled,
    Canceled,
    Rejected,
}

/// Every order buys an outcome. Selling is buying the other outcome at `1 - P`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceOrder {
    pub outcome_id: Uuid,
    pub price: Price,
    pub qty: i32,
    pub tif: TimeInForce,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<i64>,
    /// Your own id. Match it against the private stream before resending an order whose
    /// `201` never arrived.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderAccepted {
    pub order_id: Uuid,
    #[serde(default)]
    pub client_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub order_id: Uuid,
    #[serde(default)]
    pub client_id: Option<Uuid>,
    pub market_id: Uuid,
    pub outcome_id: Uuid,
    pub price: Price,
    pub qty: i32,
    pub remaining: i32,
    pub tif: TimeInForce,
    pub status: OrderStatus,
    pub created_ts: i64,
    #[serde(default)]
    pub expires_ts: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOrder {
    pub order_id: Uuid,
    #[serde(default)]
    pub client_id: Option<Uuid>,
    pub market_id: Uuid,
    pub outcome_id: Uuid,
    pub price: Price,
    pub qty: i32,
    pub tif: TimeInForce,
    #[serde(default)]
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrdersSnapshot {
    pub seq: i64,
    pub open: Vec<OpenOrder>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub market_id: Uuid,
    pub outcome_id: Uuid,
    pub qty: i32,
    #[serde(with = "rust_decimal::serde::str")]
    pub cost: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PositionsSnapshot {
    pub seq: i64,
    pub positions: Vec<Position>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BatchPlace {
    pub orders: Vec<PlaceOrder>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BatchPlaceResult {
    pub accepted: Vec<OrderAccepted>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRejection {
    pub index: i64,
    pub outcome_id: Uuid,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCancel {
    pub order_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotCanceled {
    pub order_id: Uuid,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCancelResult {
    pub canceled: Vec<Uuid>,
    pub not_canceled: Vec<NotCanceled>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAccepted {
    pub order_id: Uuid,
    pub status: OrderStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CancelAllResult {
    pub canceled: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fill {
    pub fill_id: Uuid,
    pub order_id: Uuid,
    #[serde(default)]
    pub client_id: Option<Uuid>,
    pub market_id: Uuid,
    pub outcome_id: Uuid,
    pub qty: i32,
    #[serde(with = "rust_decimal::serde::str")]
    pub cost: Decimal,
    pub taker: bool,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub fee: Option<Decimal>,
    pub ts: i64,
}

// ---------- throttle & errors ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThrottleBucket {
    pub capacity: u32,
    pub refill_per_sec: u32,
}

/// `GET /v3/limits`: your key's buckets. Free to call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Throttle {
    pub read: ThrottleBucket,
    pub account: ThrottleBucket,
    pub place: ThrottleBucket,
    pub cancel: ThrottleBucket,
    pub stream: ThrottleBucket,
    pub history: ThrottleBucket,
    pub max_watched_markets: u32,
}

impl Default for Throttle {
    /// The published defaults (docs.novig.com/api/throttling), used until `/v3/limits` answers.
    fn default() -> Self {
        let b = |capacity, refill_per_sec| ThrottleBucket { capacity, refill_per_sec };
        Self {
            place: b(256, 8),
            cancel: b(256, 16),
            read: b(64, 16),
            account: b(64, 8),
            stream: b(512, 4),
            history: b(512, 4),
            max_watched_markets: 2048,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub nonce: Option<i64>,
    #[serde(default)]
    pub rejected: Option<Vec<BatchRejection>>,
}

// ---------- price ----------

/// A price on Novig's grid, held in thousandths so it is exact.
///
/// The grid has 279 prices: every 0.001 from 0.001 to 0.050, every 0.005 from 0.055 to 0.945,
/// and every 0.001 from 0.950 to 0.999. Every price's complement is on the grid too.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Price(u16);

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PriceError {
    #[error("price must look like 0.665 (three decimals, between 0.001 and 0.999): {0:?}")]
    Malformed(String),
    #[error("{0} is not on Novig's price grid (INVALID_PRICE)")]
    OffGrid(String),
}

impl Price {
    /// Exact constructor: rejects anything off the grid, like the exchange does.
    pub fn from_milli(milli: u16) -> Result<Self, PriceError> {
        match Self::snap_down(milli) {
            Some(p) if p.0 == milli => Ok(p),
            _ => Err(PriceError::OffGrid(format_milli(milli))),
        }
    }

    /// Rounds a model price down onto the grid. Every order buys, so rounding down never pays
    /// more than intended. This is the `snap_down` from Novig's money docs.
    pub fn snap_down(milli: u16) -> Option<Self> {
        match milli {
            1..=50 | 950..=999 => Some(Self(milli)),
            51..=949 => Some(Self(milli - milli % 5)),
            _ => None,
        }
    }

    /// The next grid price up, if any.
    pub fn snap_up(milli: u16) -> Option<Self> {
        match milli {
            1..=50 | 950..=999 => Some(Self(milli)),
            51..=949 => {
                let up = milli.div_ceil(5) * 5;
                Some(Self(if up > 945 { 950 } else { up }))
            }
            _ => None,
        }
    }

    pub fn milli(self) -> u16 {
        self.0
    }

    /// The other outcome's price: a bid at 0.665 on one side is liquidity at 0.335 on the other.
    pub fn complement(self) -> Self {
        Self(1000 - self.0)
    }

    pub fn as_decimal(self) -> Decimal {
        Decimal::new(self.0 as i64, 3)
    }

    /// All 279 grid prices, ascending.
    pub fn grid() -> impl Iterator<Item = Price> {
        (1..=999u16).filter_map(|m| Price::from_milli(m).ok())
    }

    /// The grid step at this price (0.001 in the tails, 0.005 in the middle).
    pub fn tick(self) -> u16 {
        if (55..=945).contains(&self.0) { 5 } else { 1 }
    }
}

impl std::fmt::Display for Price {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&format_milli(self.0))
    }
}

impl std::str::FromStr for Price {
    type Err = PriceError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let malformed = || PriceError::Malformed(s.to_string());
        let frac = s.strip_prefix("0.").ok_or_else(malformed)?;
        if frac.is_empty() || frac.len() > 3 || !frac.bytes().all(|b| b.is_ascii_digit()) {
            return Err(malformed());
        }
        let milli: u16 = format!("{frac:0<3}").parse().map_err(|_| malformed())?;
        if milli == 0 {
            return Err(malformed());
        }
        Price::from_milli(milli)
    }
}

impl Serialize for Price {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Price {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        // Prices from the exchange are trusted to be on the grid; parse loosely so a future
        // grid change can't break deserialization.
        let frac = s.strip_prefix("0.").ok_or_else(|| serde::de::Error::custom(format!("bad price {s}")))?;
        let milli: u16 = format!("{frac:0<3}")[..3].parse().map_err(serde::de::Error::custom)?;
        Ok(Price(milli))
    }
}

fn format_milli(m: u16) -> String {
    format!("0.{m:03}")
}

// ---------- fee math ----------

/// Taker fee in dollars for one fill: `c · P(1-P) · N · 1¢`, rounded half up to $0.00001.
pub fn taker_fee(fee: &MarketFee, price: Price, qty: i32) -> Decimal {
    let p = price.as_decimal();
    let raw = fee.coefficient * p * (Decimal::ONE - p) * Decimal::from(qty) / Decimal::from(100);
    raw.round_dp_with_strategy(5, rust_decimal::RoundingStrategy::MidpointAwayFromZero)
}

/// The maker's credit on the same fill: `makerCredit` × the taker's fee.
pub fn maker_credit(fee: &MarketFee, price: Price, qty: i32) -> Decimal {
    (taker_fee(fee, price, qty) * fee.maker_credit)
        .round_dp_with_strategy(5, rust_decimal::RoundingStrategy::MidpointAwayFromZero)
}

/// Cost in dollars of buying `qty` contracts at `price` (each pays 1¢).
pub fn cost(price: Price, qty: i32) -> Decimal {
    price.as_decimal() * Decimal::from(qty) / Decimal::from(100)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn grid_has_279_prices_and_is_closed_under_complement() {
        let grid: Vec<_> = Price::grid().collect();
        assert_eq!(grid.len(), 279);
        for p in &grid {
            assert!(Price::from_milli(p.complement().milli()).is_ok(), "{p}");
        }
    }

    #[test]
    fn parse_and_snap() {
        assert_eq!(Price::from_str("0.665").unwrap().milli(), 665);
        assert!(matches!(Price::from_str("0.667"), Err(PriceError::OffGrid(_))));
        assert!(matches!(Price::from_str("1.000"), Err(PriceError::Malformed(_))));
        assert_eq!(Price::from_str("0.5").unwrap().to_string(), "0.500");
        assert_eq!(Price::snap_down(667).unwrap().milli(), 665);
        assert_eq!(Price::snap_up(667).unwrap().milli(), 670);
        assert_eq!(Price::snap_up(947).unwrap().milli(), 950);
        assert_eq!(Price::from_str("0.665").unwrap().complement().to_string(), "0.335");
    }

    #[test]
    fn documented_fee_examples() {
        let game = MarketFee { coefficient: "0.03".parse().unwrap(), maker_credit: "0.5".parse().unwrap(), charged: Chargeability::WhenLive };
        let futures = MarketFee { coefficient: "0.06".parse().unwrap(), maker_credit: "0.7".parse().unwrap(), charged: Chargeability::Always };
        let p = |s: &str| Price::from_str(s).unwrap();
        let d = |s: &str| Decimal::from_str(s).unwrap();
        // The worked examples table on docs.novig.com/api/concepts/fees
        assert_eq!(taker_fee(&game, p("0.500"), 10_000), d("0.75"));
        assert_eq!(taker_fee(&futures, p("0.500"), 10_000), d("1.5"));
        assert_eq!(taker_fee(&game, p("0.300"), 10_000), d("0.63"));
        assert_eq!(taker_fee(&game, p("0.700"), 10_000), d("0.63"));
        assert_eq!(taker_fee(&futures, p("0.100"), 10_000), d("0.54"));
        assert_eq!(taker_fee(&game, p("0.500"), 100), d("0.0075"));
        assert_eq!(maker_credit(&game, p("0.500"), 10_000), d("0.375"));
        assert_eq!(maker_credit(&futures, p("0.500"), 10_000), d("1.05"));
        // The money docs: 110 contracts at 0.665 cost $0.73150
        assert_eq!(cost(p("0.665"), 110), d("0.7315"));
    }
}
