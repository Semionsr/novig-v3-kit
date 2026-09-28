/**
 * Per-subject `seq` tracking with gap recovery (docs.novig.com/api/streaming/connection#gaps):
 * buffer after a gap, send `snapshot`, drop what it covers, replay the rest.
 */
export type Step<T> = { kind: "apply"; batch: T } | { kind: "stale" } | { kind: "buffered" } | { kind: "gap"; missing: number; got: number };

export interface SeqStats {
  lastSeq: number | null;
  applied: number;
  gaps: number;
  resyncs: number;
  stale: number;
  bufferedNow: number;
  awaitingSnapshot: boolean;
}

export class Sequencer<T> {
  private last: number | null = null;
  private buffer = new Map<number, T>();
  private awaiting = true;
  private s = { applied: 0, gaps: 0, resyncs: 0, stale: 0 };

  static startingAt<T>(seq: number): Sequencer<T> {
    const q = new Sequencer<T>();
    q.last = seq;
    q.awaiting = false;
    return q;
  }

  get lastSeq() {
    return this.last;
  }
  get awaitingSnapshot() {
    return this.awaiting;
  }

  stats(): SeqStats {
    return { lastSeq: this.last, ...this.s, bufferedNow: this.buffer.size, awaitingSnapshot: this.awaiting };
  }

  delta(seq: number, batch: T): Step<T> {
    if (this.awaiting) {
      this.buffer.set(seq, batch);
      return { kind: "buffered" };
    }
    const last = this.last ?? 0;
    if (seq <= last) {
      this.s.stale++;
      return { kind: "stale" };
    }
    if (seq === last + 1) {
      this.last = seq;
      this.s.applied++;
      return { kind: "apply", batch };
    }
    this.buffer.set(seq, batch);
    this.awaiting = true;
    this.s.gaps++;
    return { kind: "gap", missing: last + 1, got: seq };
  }

  /** Adopts a snapshot at `seq`; returns buffered batches to apply after it, in order. */
  snapshot(seq: number): Array<[number, T]> {
    if (this.last !== null && this.awaiting) this.s.resyncs++;
    this.last = seq;
    this.awaiting = false;
    const replay: Array<[number, T]> = [];
    for (const k of [...this.buffer.keys()].sort((a, b) => a - b)) {
      if (k <= seq) {
        this.buffer.delete(k);
        this.s.stale++;
      }
    }
    for (const k of [...this.buffer.keys()].sort((a, b) => a - b)) {
      if (k === this.last + 1) {
        replay.push([k, this.buffer.get(k)!]);
        this.buffer.delete(k);
        this.last = k;
        this.s.applied++;
      } else {
        this.awaiting = true;
        this.s.gaps++;
        break;
      }
    }
    return replay;
  }

  reset() {
    this.last = null;
    this.buffer.clear();
    this.awaiting = true;
  }
}
