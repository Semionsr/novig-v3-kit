//! A client-side model of Novig's per-key throttles (docs.novig.com/api/throttling).
//!
//! Each throttle is a token bucket: `tokens(t+Δt) = min(C, tokens(t) + r·Δt)`. The docs say
//! to model every bucket, subtract each request's cost, and queue while the model is short.
//! That's what [`Throttler::acquire`] does. A `429` still happens sometimes (their servers share
//! counts gradually), so [`Throttler::penalize`] empties the bucket and honors `Retry-After`.

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::types::{Throttle, ThrottleBucket};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Bucket {
    Place,
    Cancel,
    Read,
    Account,
    Stream,
    History,
    /// The unauthenticated `/v3/public/*` routes, limited per IP. The docs name a `public`
    /// throttle on every public route but never define it; measured 2026-09-28 at about a
    /// 10-request burst refilling ~2/s (re-measured at steady rates: 2/s clean, 2.5/s rejects 1 in 5), shared across all public routes, 429 with Retry-After: 1.
    Public,
}

/// The measured public-route limit (see [`Bucket::Public`]).
pub const PUBLIC_LIMIT: ThrottleBucket = ThrottleBucket { capacity: 8, refill_per_sec: 2 };

impl Bucket {
    pub const ALL: [Bucket; 7] = [Bucket::Place, Bucket::Cancel, Bucket::Read, Bucket::Account, Bucket::Stream, Bucket::History, Bucket::Public];

    fn index(self) -> usize {
        self as usize
    }
}

/// What a request costs, per the "Throttle / Cost" row on each API reference page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cost {
    /// `/v3/echo` and `/v3/limits`.
    Free,
    Tokens(Bucket, u32),
}

#[derive(Debug, Clone, Copy)]
struct State {
    capacity: f64,
    refill: f64,
    tokens: f64,
    at: Instant,
    /// Set by a 429: nothing leaves this bucket before then.
    blocked_until: Option<Instant>,
}

impl State {
    fn new(b: ThrottleBucket, now: Instant) -> Self {
        Self { capacity: b.capacity as f64, refill: b.refill_per_sec as f64, tokens: b.capacity as f64, at: now, blocked_until: None }
    }

    fn refill(&mut self, now: Instant) {
        let dt = now.saturating_duration_since(self.at).as_secs_f64();
        self.tokens = (self.tokens + self.refill * dt).min(self.capacity);
        self.at = now;
    }

    /// How long until `cost` tokens are available (zero if now). A request above capacity
    /// passes only when the bucket is full, and then empties it (the docs' rule for `stream`).
    fn wait_for(&self, cost: f64, now: Instant) -> Duration {
        if let Some(until) = self.blocked_until {
            if until > now {
                return until - now;
            }
        }
        let need = cost.min(self.capacity);
        if self.tokens >= need {
            Duration::ZERO
        } else {
            Duration::from_secs_f64((need - self.tokens) / self.refill.max(f64::MIN_POSITIVE))
        }
    }
}

/// Live numbers for one bucket, e.g. to draw the meters on the console's Throttle screen.
#[derive(Debug, Clone, Serialize)]
pub struct BucketView {
    pub bucket: Bucket,
    pub capacity: u32,
    pub refill_per_sec: u32,
    pub tokens: f64,
    pub spent_total: u64,
    pub waited_ms_total: u64,
    pub rejections_429: u64,
    pub blocked_ms: u64,
}

#[derive(Debug)]
struct Inner {
    buckets: [State; 7],
    spent: [u64; 7],
    waited_ms: [u64; 7],
    rejections: [u64; 7],
    max_watched_markets: u32,
}

/// Shared, thread-safe pacing for one API key. Clone the `Arc` it lives in across tasks.
#[derive(Debug)]
pub struct Throttler {
    inner: Mutex<Inner>,
}

impl Default for Throttler {
    fn default() -> Self {
        Self::new(Throttle::default())
    }
}

impl Throttler {
    pub fn new(limits: Throttle) -> Self {
        let now = Instant::now();
        let s = |b| State::new(b, now);
        Self {
            inner: Mutex::new(Inner {
                buckets: [s(limits.place), s(limits.cancel), s(limits.read), s(limits.account), s(limits.stream), s(limits.history), s(PUBLIC_LIMIT)],
                spent: [0; 7],
                waited_ms: [0; 7],
                rejections: [0; 7],
                max_watched_markets: limits.max_watched_markets,
            }),
        }
    }

    /// Adopts the schedule `GET /v3/limits` returned, keeping the current fill ratio.
    pub fn update_limits(&self, limits: Throttle) {
        let mut g = self.inner.lock().unwrap();
        let now = Instant::now();
        let new = [limits.place, limits.cancel, limits.read, limits.account, limits.stream, limits.history];
        for (state, b) in g.buckets.iter_mut().zip(new) {
            state.refill(now);
            let ratio = if state.capacity > 0.0 { state.tokens / state.capacity } else { 1.0 };
            state.capacity = b.capacity as f64;
            state.refill = b.refill_per_sec as f64;
            state.tokens = ratio * state.capacity;
        }
        g.max_watched_markets = limits.max_watched_markets;
    }

    pub fn max_watched_markets(&self) -> u32 {
        self.inner.lock().unwrap().max_watched_markets
    }

    /// Non-blocking: spends the tokens and returns zero, or returns how long to wait.
    pub fn try_acquire(&self, cost: Cost) -> Duration {
        let Cost::Tokens(bucket, n) = cost else { return Duration::ZERO };
        let mut g = self.inner.lock().unwrap();
        let now = Instant::now();
        let i = bucket.index();
        let st = &mut g.buckets[i];
        st.refill(now);
        let wait = st.wait_for(n as f64, now);
        if wait.is_zero() {
            st.blocked_until = None;
            st.tokens = (st.tokens - n as f64).max(0.0);
            g.spent[i] += n as u64;
        }
        wait
    }

    /// How long until `cost` could be paid, without paying it.
    pub fn try_peek(&self, cost: Cost) -> Duration {
        let Cost::Tokens(bucket, n) = cost else { return Duration::ZERO };
        let mut g = self.inner.lock().unwrap();
        let now = Instant::now();
        let st = &mut g.buckets[bucket.index()];
        st.refill(now);
        st.wait_for(n as f64, now)
    }

    /// Waits (asynchronously) until the bucket can pay, then pays.
    pub async fn acquire(&self, cost: Cost) {
        loop {
            let wait = self.try_acquire(cost);
            if wait.is_zero() {
                return;
            }
            if let Cost::Tokens(b, _) = cost {
                self.inner.lock().unwrap().waited_ms[b.index()] += wait.as_millis() as u64;
            }
            tokio::time::sleep(wait).await;
        }
    }

    /// Records a `429`: the server says the bucket is empty, so believe it over the model.
    pub fn penalize(&self, bucket: Bucket, retry_after: Duration) {
        let mut g = self.inner.lock().unwrap();
        let now = Instant::now();
        let i = bucket.index();
        g.buckets[i].tokens = 0.0;
        g.buckets[i].at = now;
        g.buckets[i].blocked_until = Some(now + retry_after);
        g.rejections[i] += 1;
    }

    pub fn snapshot(&self) -> Vec<BucketView> {
        let mut g = self.inner.lock().unwrap();
        let now = Instant::now();
        Bucket::ALL
            .iter()
            .map(|&b| {
                let i = b.index();
                g.buckets[i].refill(now);
                let st = g.buckets[i];
                BucketView {
                    bucket: b,
                    capacity: st.capacity as u32,
                    refill_per_sec: st.refill as u32,
                    tokens: (st.tokens * 10.0).round() / 10.0,
                    spent_total: g.spent[i],
                    waited_ms_total: g.waited_ms[i],
                    rejections_429: g.rejections[i],
                    blocked_ms: st.blocked_until.map(|u| u.saturating_duration_since(now).as_millis() as u64).unwrap_or(0),
                }
            })
            .collect()
    }
}

/// Websocket weights per (subject, channel) pair, from docs.novig.com/api/streaming/connection.
pub mod ws_weight {
    pub const UPGRADE: u32 = 32;
    pub const LIFECYCLE: u32 = 1;
    pub const TRADES: u32 = 4;
    pub const BBO: u32 = 8;
    pub const BOOK: u32 = 16;
    pub const ORDERS: u32 = 1;
    pub const POSITIONS: u32 = 1;

    pub fn channel(name: &str) -> u32 {
        match name {
            "lifecycle" => LIFECYCLE,
            "trades" => TRADES,
            "bbo" => BBO,
            "book" => BOOK,
            "orders" => ORDERS,
            "positions" => POSITIONS,
            _ => 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn paces_instead_of_overdrawing() {
        let t = Throttler::default(); // read: 64 burst, 16/s
        for _ in 0..64 {
            assert!(t.try_acquire(Cost::Tokens(Bucket::Read, 1)).is_zero());
        }
        let wait = t.try_acquire(Cost::Tokens(Bucket::Read, 1));
        assert!(wait > Duration::from_millis(50) && wait <= Duration::from_millis(63), "{wait:?}");
    }

    #[test]
    fn oversized_request_waits_for_a_full_bucket_then_empties_it() {
        let t = Throttler::default(); // stream: 512
        assert!(t.try_acquire(Cost::Tokens(Bucket::Stream, 800)).is_zero());
        let v = &t.snapshot()[Bucket::Stream as usize];
        assert!(v.tokens < 1.0);
        assert!(!t.try_acquire(Cost::Tokens(Bucket::Stream, 800)).is_zero());
    }

    #[test]
    fn a_429_blocks_the_bucket_for_retry_after() {
        let t = Throttler::default();
        t.penalize(Bucket::Place, Duration::from_secs(3));
        let wait = t.try_acquire(Cost::Tokens(Bucket::Place, 1));
        assert!(wait > Duration::from_millis(2900));
        assert_eq!(t.snapshot()[Bucket::Place as usize].rejections_429, 1);
    }
}
