//! Per-subject sequence tracking and gap recovery (docs.novig.com/api/streaming/connection#gaps).
//!
//! Every market channel numbers its messages per market; `orders` and `positions` number per
//! subaccount. A snapshot carries the `seq` it was taken at, and the first delta after it
//! carries `seq + 1`. On a skipped `seq`:
//! 1. buffer what arrives after the gap,
//! 2. ask for a `snapshot` (it leaves subscriptions unchanged),
//! 3. apply the snapshot, drop buffered deltas it already covers, replay the rest.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step<T> {
    /// In order: apply it now.
    Apply(T),
    /// Already covered by the current state (a duplicate, or older than the snapshot).
    Stale,
    /// A gap opened: the delta is buffered and the caller should send `snapshot`.
    /// `missing` is the first seq we never saw.
    Gap { missing: i64, got: i64 },
    /// Still waiting on a snapshot that was already requested; the delta is buffered.
    Buffered,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct SeqStats {
    pub last_seq: Option<i64>,
    pub applied: u64,
    pub gaps: u64,
    pub resyncs: u64,
    pub stale: u64,
    pub buffered_now: usize,
    pub awaiting_snapshot: bool,
}

#[derive(Debug, Clone)]
pub struct Sequencer<T> {
    last: Option<i64>,
    buffer: BTreeMap<i64, T>,
    awaiting_snapshot: bool,
    stats: SeqStats,
}

impl<T> Default for Sequencer<T> {
    fn default() -> Self {
        Self { last: None, buffer: BTreeMap::new(), awaiting_snapshot: true, stats: SeqStats { awaiting_snapshot: true, ..Default::default() } }
    }
}

impl<T> Sequencer<T> {
    pub fn new() -> Self {
        Self::default()
    }

    /// A subject that starts with no snapshot at seq 0, e.g. a market that opens under an
    /// `events` subscription: its first delta carries seq 1.
    pub fn starting_at(seq: i64) -> Self {
        let mut s = Self::default();
        s.last = Some(seq);
        s.awaiting_snapshot = false;
        s.stats.last_seq = Some(seq);
        s.stats.awaiting_snapshot = false;
        s
    }

    pub fn last_seq(&self) -> Option<i64> {
        self.last
    }

    pub fn awaiting_snapshot(&self) -> bool {
        self.awaiting_snapshot
    }

    pub fn stats(&self) -> SeqStats {
        SeqStats { last_seq: self.last, buffered_now: self.buffer.len(), awaiting_snapshot: self.awaiting_snapshot, ..self.stats.clone() }
    }

    /// Feeds one delta batch.
    pub fn delta(&mut self, seq: i64, batch: T) -> Step<T> {
        if self.awaiting_snapshot {
            self.buffer.insert(seq, batch);
            return Step::Buffered;
        }
        let last = self.last.unwrap_or(0);
        if seq <= last {
            self.stats.stale += 1;
            return Step::Stale;
        }
        if seq == last + 1 {
            self.last = Some(seq);
            self.stats.applied += 1;
            return Step::Apply(batch);
        }
        self.buffer.insert(seq, batch);
        self.awaiting_snapshot = true;
        self.stats.gaps += 1;
        Step::Gap { missing: last + 1, got: seq }
    }

    /// Adopts a snapshot taken at `seq`. Returns the buffered batches to apply after it, in order.
    /// If the buffer still has a hole after the snapshot, the sequencer asks for another one
    /// (`awaiting_snapshot()` stays true) and keeps what it has.
    pub fn snapshot(&mut self, seq: i64) -> Vec<(i64, T)> {
        let was_resync = self.last.is_some();
        self.last = Some(seq);
        self.awaiting_snapshot = false;
        if was_resync {
            self.stats.resyncs += 1;
        }
        // Drop what the snapshot already covers.
        let keep = self.buffer.split_off(&(seq + 1));
        self.stats.stale += self.buffer.len() as u64;
        self.buffer = keep;

        let mut replay = Vec::new();
        while let Some((&s, _)) = self.buffer.first_key_value() {
            if s == self.last.unwrap() + 1 {
                let (s, b) = self.buffer.pop_first().unwrap();
                self.last = Some(s);
                self.stats.applied += 1;
                replay.push((s, b));
            } else {
                self.awaiting_snapshot = true;
                self.stats.gaps += 1;
                break;
            }
        }
        replay
    }

    /// After a reconnect `seq`s restart and must never be compared across connections.
    pub fn reset(&mut self) {
        self.last = None;
        self.buffer.clear();
        self.awaiting_snapshot = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_docs_example() {
        // Snapshot at 48121 then 48122; 48123 is lost; 48124 arrives; snapshot comes back at 48125.
        let mut s = Sequencer::new();
        assert!(s.snapshot(48121).is_empty());
        assert_eq!(s.delta(48122, "a"), Step::Apply("a"));
        assert_eq!(s.delta(48124, "c"), Step::Gap { missing: 48123, got: 48124 });
        assert_eq!(s.delta(48126, "e"), Step::Buffered);
        let replay = s.snapshot(48125);
        assert_eq!(replay, vec![(48126, "e")], "drops 48124 (covered), replays 48126");
        assert!(!s.awaiting_snapshot());
        assert_eq!(s.delta(48127, "f"), Step::Apply("f"));
        let st = s.stats();
        assert_eq!((st.gaps, st.resyncs), (1, 1));
    }

    #[test]
    fn deltas_before_the_first_snapshot_are_buffered_then_replayed() {
        let mut s = Sequencer::new();
        assert_eq!(s.delta(11, 11), Step::Buffered);
        assert_eq!(s.delta(12, 12), Step::Buffered);
        assert_eq!(s.snapshot(10), vec![(11, 11), (12, 12)]);
    }

    #[test]
    fn a_hole_after_the_snapshot_asks_again() {
        let mut s = Sequencer::new();
        s.snapshot(1);
        assert!(matches!(s.delta(3, 3), Step::Gap { .. }));
        s.delta(6, 6);
        let replay = s.snapshot(3);
        assert!(replay.is_empty());
        assert!(s.awaiting_snapshot(), "4 and 5 are still missing");
    }

    #[test]
    fn duplicates_are_stale() {
        let mut s = Sequencer::starting_at(0);
        assert_eq!(s.delta(1, ()), Step::Apply(()));
        assert_eq!(s.delta(1, ()), Step::Stale);
    }
}
