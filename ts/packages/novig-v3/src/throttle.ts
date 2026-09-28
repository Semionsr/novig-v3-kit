/**
 * Client-side model of Novig's six per-key token buckets (docs.novig.com/api/throttling):
 * `tokens(t+Δt) = min(C, tokens(t) + r·Δt)`. Spend before sending, queue while short, and on a
 * 429 believe the server: empty the bucket and wait Retry-After.
 */
import { DEFAULT_THROTTLE, type Throttle } from "./types.ts";

export type Bucket = "place" | "cancel" | "read" | "account" | "stream" | "history" | "public";
export const BUCKETS: Bucket[] = ["place", "cancel", "read", "account", "stream", "history", "public"];

/**
 * The unauthenticated /v3/public routes are limited per IP by a `public` throttle the docs name
 * but don't define. Measured 2026-09-28: ~10-request burst, ~2/s refill (2/s steady is clean, 2.5/s rejects 1 in 5), shared by every public
 * route, 429 with Retry-After: 1.
 */
export const PUBLIC_LIMIT = { capacity: 8, refillPerSec: 2 }; // a little under the measured burst, for headroom
export type Cost = { bucket: Bucket; tokens: number } | null;

export const WS_WEIGHT = { upgrade: 32, lifecycle: 1, trades: 4, bbo: 8, book: 16, orders: 1, positions: 1 } as const;

interface State {
  capacity: number;
  refill: number;
  tokens: number;
  at: number;
  blockedUntil: number;
  spent: number;
  waitedMs: number;
  rejections: number;
}

export interface BucketView {
  bucket: Bucket;
  capacity: number;
  refillPerSec: number;
  tokens: number;
  spentTotal: number;
  waitedMsTotal: number;
  rejections429: number;
  blockedMs: number;
}

export class Throttler {
  private b = new Map<Bucket, State>();
  maxWatchedMarkets: number;

  constructor(
    limits: Throttle = DEFAULT_THROTTLE,
    private now: () => number = () => Date.now(),
  ) {
    this.maxWatchedMarkets = limits.maxWatchedMarkets;
    for (const k of BUCKETS) {
      const { capacity, refillPerSec } = k === "public" ? PUBLIC_LIMIT : limits[k];
      this.b.set(k, { capacity, refill: refillPerSec, tokens: capacity, at: this.now(), blockedUntil: 0, spent: 0, waitedMs: 0, rejections: 0 });
    }
  }

  update(limits: Throttle) {
    for (const k of BUCKETS) {
      if (k === "public") continue;
      const s = this.refilled(k);
      const ratio = s.capacity ? s.tokens / s.capacity : 1;
      s.capacity = limits[k].capacity;
      s.refill = limits[k].refillPerSec;
      s.tokens = ratio * s.capacity;
    }
    this.maxWatchedMarkets = limits.maxWatchedMarkets;
  }

  private refilled(k: Bucket): State {
    const s = this.b.get(k)!;
    const t = this.now();
    s.tokens = Math.min(s.capacity, s.tokens + (s.refill * (t - s.at)) / 1000);
    s.at = t;
    return s;
  }

  /** Milliseconds until `cost` can be paid; 0 means now. */
  peek(cost: Cost): number {
    if (!cost) return 0;
    const s = this.refilled(cost.bucket);
    const t = this.now();
    if (s.blockedUntil > t) return s.blockedUntil - t;
    const need = Math.min(cost.tokens, s.capacity);
    return s.tokens >= need ? 0 : Math.ceil(((need - s.tokens) / s.refill) * 1000);
  }

  tryAcquire(cost: Cost): number {
    const wait = this.peek(cost);
    if (wait === 0 && cost) {
      const s = this.b.get(cost.bucket)!;
      s.tokens = Math.max(0, s.tokens - cost.tokens);
      s.spent += cost.tokens;
    }
    return wait;
  }

  async acquire(cost: Cost): Promise<number> {
    let waited = 0;
    for (;;) {
      const w = this.tryAcquire(cost);
      if (w === 0) return waited;
      if (cost) this.b.get(cost.bucket)!.waitedMs += w;
      waited += w;
      await new Promise((r) => setTimeout(r, w));
    }
  }

  penalize(bucket: Bucket, retryAfterMs: number) {
    const s = this.refilled(bucket);
    s.tokens = 0;
    s.blockedUntil = this.now() + retryAfterMs;
    s.rejections++;
  }

  snapshot(): BucketView[] {
    return BUCKETS.map((k) => {
      const s = this.refilled(k);
      return {
        bucket: k,
        capacity: s.capacity,
        refillPerSec: s.refill,
        tokens: Math.round(s.tokens * 10) / 10,
        spentTotal: s.spent,
        waitedMsTotal: s.waitedMs,
        rejections429: s.rejections,
        blockedMs: Math.max(0, s.blockedUntil - this.now()),
      };
    });
  }
}
