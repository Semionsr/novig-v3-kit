//! An L3 order book for one market, fed by `GET .../book` or the websocket `book` channel.
//!
//! Novig's book has one ladder per outcome, and every order buys. Each ladder lists resting
//! orders best price first (highest), earliest first within a price: the array order is the
//! queue. A bid at 0.665 on one outcome is an offer at 0.335 on the other.
//!
//! Delta rules (docs.novig.com/api/streaming/book):
//! - `add` joins the back of its price level
//! - `remove` with `reason: fill` is a trade, `reason: cancel` is not
//! - a partial fill is a `remove` then an `add` of the remainder, which keeps its queue position

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use uuid::Uuid;

use crate::types::{BookSnapshot, Price, RestingOrder};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BookDelta {
    Add { order: Uuid, outcome: Uuid, price: Price, qty: i32 },
    Remove { order: Uuid, #[serde(default)] reason: Option<RemoveReason> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoveReason {
    Fill,
    Cancel,
}

/// A resting order leaving the book: a fill (fully or partly executed) or a cancel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Removal {
    pub order: Uuid,
    pub outcome: Uuid,
    pub price: Price,
    pub resting_qty: i32,
    /// Contracts that traded (0 for a cancel).
    pub executed: i32,
    pub reason: RemoveReason,
}

/// One aggregated price level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Level {
    pub price: Price,
    pub qty: i64,
    pub orders: usize,
}

/// Best bid and best offer on one outcome. The offer comes from the other outcomes' bids.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Quote {
    pub bid: Option<Level>,
    pub offer: Option<Level>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Book {
    pub market_id: Option<Uuid>,
    pub seq: i64,
    /// outcome → resting orders in queue order.
    ladders: BTreeMap<Uuid, Vec<RestingOrder>>,
    #[serde(skip)]
    index: HashMap<Uuid, Uuid>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ApplyReport {
    pub added: usize,
    pub filled: usize,
    pub canceled: usize,
    /// Removes for orders we never saw: harmless after a resync, a bug signal otherwise.
    pub unknown_removes: usize,
}

impl Book {
    pub fn new(outcomes: impl IntoIterator<Item = Uuid>) -> Self {
        let mut b = Self::default();
        for o in outcomes {
            b.ladders.entry(o).or_default();
        }
        b
    }

    pub fn from_snapshot(s: &BookSnapshot) -> Self {
        let mut b = Self::default();
        b.load(Some(s.market_id), s.seq, &s.orders);
        b
    }

    /// Replaces everything with a snapshot (REST or websocket).
    pub fn load(&mut self, market_id: Option<Uuid>, seq: i64, orders: &BTreeMap<Uuid, Vec<RestingOrder>>) {
        if market_id.is_some() {
            self.market_id = market_id;
        }
        self.seq = seq;
        for ladder in self.ladders.values_mut() {
            ladder.clear();
        }
        self.index.clear();
        for (outcome, list) in orders {
            let ladder = self.ladders.entry(*outcome).or_default();
            ladder.extend(list.iter().cloned());
            // The exchange sends queue order already; a stable sort by price keeps time priority.
            ladder.sort_by(|a, b| b.price.cmp(&a.price));
            for o in list {
                self.index.insert(o.order_id, *outcome);
            }
        }
    }

    /// Applies one batch atomically, as the docs require ("changes that happen together arrive
    /// in one message"). Sequence checking lives in [`crate::seq::Sequencer`].
    pub fn apply(&mut self, seq: i64, deltas: &[BookDelta]) -> ApplyReport {
        let mut report = ApplyReport::default();
        // Orders removed by a fill in this batch, with their queue position, so a re-add of the
        // remainder goes back where it was.
        let mut filled_at: HashMap<Uuid, usize> = HashMap::new();
        for d in deltas {
            match d {
                BookDelta::Add { order, outcome, price, qty } => {
                    report.added += 1;
                    let ladder = self.ladders.entry(*outcome).or_default();
                    let resting = RestingOrder { order_id: *order, price: *price, qty: *qty };
                    let pos = match filled_at.remove(order) {
                        Some(i) if i <= ladder.len() => i,
                        // Back of its level: after the last order at a price >= this one.
                        _ => ladder.partition_point(|o| o.price >= *price),
                    };
                    ladder.insert(pos, resting);
                    self.index.insert(*order, *outcome);
                }
                BookDelta::Remove { order, reason } => {
                    match reason {
                        Some(RemoveReason::Fill) => report.filled += 1,
                        _ => report.canceled += 1,
                    }
                    let Some(outcome) = self.index.remove(order) else {
                        report.unknown_removes += 1;
                        continue;
                    };
                    let ladder = self.ladders.get_mut(&outcome).expect("indexed ladder exists");
                    if let Some(i) = ladder.iter().position(|o| o.order_id == *order) {
                        ladder.remove(i);
                        if *reason == Some(RemoveReason::Fill) {
                            filled_at.insert(*order, i);
                        }
                    }
                }
            }
        }
        self.seq = seq;
        report
    }

    /// The resting order with this id, and its outcome.
    pub fn find(&self, order: &Uuid) -> Option<(Uuid, RestingOrder)> {
        let outcome = self.index.get(order)?;
        self.queue(outcome).iter().find(|o| &o.order_id == order).map(|o| (*outcome, o.clone()))
    }

    /// Describes what a batch will remove, before it's applied: which order, where it rested,
    /// and (for a partial fill) how much comes back. Used for paper fills and fill analytics.
    pub fn removals(&self, deltas: &[BookDelta]) -> Vec<Removal> {
        let mut out = Vec::new();
        for (i, d) in deltas.iter().enumerate() {
            if let BookDelta::Remove { order, reason } = d {
                let Some((outcome, resting)) = self.find(order) else { continue };
                let readded = deltas[i + 1..].iter().find_map(|x| match x {
                    BookDelta::Add { order: o, qty, .. } if o == order => Some(*qty),
                    _ => None,
                });
                out.push(Removal {
                    order: *order,
                    outcome,
                    price: resting.price,
                    resting_qty: resting.qty,
                    executed: if *reason == Some(RemoveReason::Fill) { resting.qty - readded.unwrap_or(0) } else { 0 },
                    reason: reason.unwrap_or(RemoveReason::Cancel),
                });
            }
        }
        out
    }

    pub fn outcomes(&self) -> impl Iterator<Item = &Uuid> {
        self.ladders.keys()
    }

    /// Resting orders on one outcome, in queue order.
    pub fn queue(&self, outcome: &Uuid) -> &[RestingOrder] {
        self.ladders.get(outcome).map(Vec::as_slice).unwrap_or(&[])
    }

    /// Aggregated levels, best first.
    pub fn levels(&self, outcome: &Uuid, depth: usize) -> Vec<Level> {
        let mut out: Vec<Level> = Vec::new();
        for o in self.queue(outcome) {
            match out.last_mut() {
                Some(l) if l.price == o.price => {
                    l.qty += o.qty as i64;
                    l.orders += 1;
                }
                _ => {
                    if out.len() == depth {
                        break;
                    }
                    out.push(Level { price: o.price, qty: o.qty as i64, orders: 1 });
                }
            }
        }
        out
    }

    pub fn best_bid(&self, outcome: &Uuid) -> Option<Level> {
        self.levels(outcome, 1).into_iter().next()
    }

    /// For a two-outcome market: the best price you can buy this outcome at right now is the
    /// complement of the best bid on the other outcome.
    pub fn quote(&self, outcome: &Uuid) -> Quote {
        let bid = self.best_bid(outcome);
        let offer = self
            .ladders
            .keys()
            .filter(|o| *o != outcome)
            .filter_map(|o| self.best_bid(o))
            .map(|l| Level { price: l.price.complement(), ..l })
            .min_by_key(|l| l.price);
        Quote { bid, offer }
    }

    /// Where a new order at `price` would sit: contracts ahead of it in the queue.
    pub fn queue_ahead(&self, outcome: &Uuid, price: Price) -> i64 {
        self.queue(outcome).iter().filter(|o| o.price >= price).map(|o| o.qty as i64).sum()
    }

    pub fn order_count(&self) -> usize {
        self.index.len()
    }

    /// Back to the wire shape, e.g. to compare against a fresh `GET .../book`.
    pub fn to_snapshot(&self) -> BTreeMap<Uuid, Vec<RestingOrder>> {
        self.ladders.iter().filter(|(_, v)| !v.is_empty()).map(|(k, v)| (*k, v.clone())).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn p(s: &str) -> Price {
        Price::from_str(s).unwrap()
    }
    fn id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    #[test]
    fn docs_ladder_and_complement_quote() {
        let (chiefs, bills) = (id(1), id(2));
        let mut b = Book::new([chiefs, bills]);
        b.apply(1, &[
            BookDelta::Add { order: id(10), outcome: chiefs, price: p("0.665"), qty: 110 },
            BookDelta::Add { order: id(11), outcome: chiefs, price: p("0.660"), qty: 250 },
            BookDelta::Add { order: id(12), outcome: bills, price: p("0.335"), qty: 180 },
        ]);
        let q = b.quote(&chiefs);
        assert_eq!(q.bid.unwrap().price, p("0.665"));
        assert_eq!(q.offer.unwrap().price, p("0.665"), "0.335 on Bills is 0.665 on Chiefs");
    }

    #[test]
    fn add_joins_the_back_of_its_level() {
        let o = id(1);
        let mut b = Book::new([o]);
        b.apply(1, &[
            BookDelta::Add { order: id(10), outcome: o, price: p("0.500"), qty: 1 },
            BookDelta::Add { order: id(11), outcome: o, price: p("0.550"), qty: 1 },
            BookDelta::Add { order: id(12), outcome: o, price: p("0.500"), qty: 1 },
            BookDelta::Add { order: id(13), outcome: o, price: p("0.450"), qty: 1 },
        ]);
        let order: Vec<_> = b.queue(&o).iter().map(|r| r.order_id).collect();
        assert_eq!(order, vec![id(11), id(10), id(12), id(13)]);
    }

    #[test]
    fn partial_fill_keeps_queue_position() {
        let o = id(1);
        let mut b = Book::new([o]);
        b.apply(1, &[
            BookDelta::Add { order: id(10), outcome: o, price: p("0.500"), qty: 100 },
            BookDelta::Add { order: id(11), outcome: o, price: p("0.500"), qty: 100 },
        ]);
        let r = b.apply(2, &[
            BookDelta::Remove { order: id(10), reason: Some(RemoveReason::Fill) },
            BookDelta::Add { order: id(10), outcome: o, price: p("0.500"), qty: 60 },
        ]);
        assert_eq!(r.filled, 1);
        assert_eq!(b.queue(&o)[0].order_id, id(10), "still first in line");
        assert_eq!(b.queue(&o)[0].qty, 60);
        assert_eq!(b.levels(&o, 5), vec![Level { price: p("0.500"), qty: 160, orders: 2 }]);
    }

    /// Replaying random deltas from a snapshot must equal the exchange's next snapshot.
    /// Here the "exchange" is a naive reference model built from the same operations.
    #[test]
    fn deltas_equal_a_fresh_snapshot() {
        let outcomes = [id(1), id(2)];
        let grid: Vec<Price> = Price::grid().collect();
        let mut rng = 0x9e3779b97f4a7c15u64;
        let mut next = move || {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            rng
        };
        // Reference: a plain list per outcome, appended in time order, sorted stably by price.
        let mut reference: BTreeMap<Uuid, Vec<RestingOrder>> = BTreeMap::new();
        let mut book = Book::new(outcomes);
        let mut live: Vec<(Uuid, Uuid)> = vec![];
        for seq in 1..=2000 {
            let mut batch = vec![];
            for _ in 0..(next() % 4 + 1) {
                if live.is_empty() || next() % 3 != 0 {
                    let outcome = outcomes[(next() % 2) as usize];
                    let order = id(seq as u128 * 100 + batch.len() as u128 + 1000);
                    let price = grid[(next() % grid.len() as u64) as usize];
                    let qty = (next() % 500 + 1) as i32;
                    batch.push(BookDelta::Add { order, outcome, price, qty });
                    let list = reference.entry(outcome).or_default();
                    let pos = list.partition_point(|o| o.price >= price);
                    list.insert(pos, RestingOrder { order_id: order, price, qty });
                    live.push((order, outcome));
                } else {
                    let (order, outcome) = live.swap_remove((next() % live.len() as u64) as usize);
                    batch.push(BookDelta::Remove { order, reason: Some(RemoveReason::Cancel) });
                    reference.get_mut(&outcome).unwrap().retain(|o| o.order_id != order);
                }
            }
            book.apply(seq, &batch);
        }
        reference.retain(|_, v| !v.is_empty());
        assert_eq!(book.to_snapshot(), reference);
        let reloaded = Book::from_snapshot(&BookSnapshot { market_id: id(9), seq: 2000, orders: reference.clone() });
        assert_eq!(reloaded.to_snapshot(), reference);
    }
}
