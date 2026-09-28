/**
 * The mock exchange from `novig-v3/src/mock.rs`, ported to run in the page for the hosted demo.
 *
 * One synthetic two-outcome market whose book moves every tick (adds, cancels, fills), speaking
 * the documented `/v3/ws` protocol: nonces, per-market `seq`, snapshots, `GOLIVE`. It misbehaves
 * on purpose (`dropEvery` loses one frame every N ticks, `kill` drops the socket with no close
 * frame) so the TypeScript SDK's recovery can be watched. `MockSocket` is a `SocketLike`, so it
 * plugs straight into `NovigStream` through `socketFactory`.
 */
import { formatPrice, snapDown, type SocketLike } from "@semion/novig-v3";

export const MOCK = {
  market_id: "01990000-0000-7000-8000-000000000001",
  event_id: "01990000-0000-7000-8000-000000000002",
  home: "01990000-0000-7000-8000-0000000000a1",
  away: "01990000-0000-7000-8000-0000000000b2",
};
export const MOCK_URL = "mock://in-browser/v3/ws";

interface Resting { id: string; price: number; qty: number }

class Exchange {
  bookSeq = 0;
  tradesSeq = 0;
  lifeSeq = 1;
  ladders = new Map<string, Resting[]>([[MOCK.home, []], [MOCK.away, []]]);
  recentTrades: unknown[] = [];
  mid = 0.56;
  tick = 0;
  private rng: number;
  private nextId = 1;

  constructor(seed: number) {
    this.rng = seed | 1;
    for (let i = 0; i < 30; i++) this.randomAdd();
    this.bookSeq = 100;
  }

  rand(): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng;
  }

  private id(): string {
    this.nextId++;
    return `01991111-0000-7000-8000-${this.nextId.toString(16).padStart(12, "0")}`;
  }

  private randomAdd() {
    const homeSide = this.rand() % 2 === 0;
    const outcome = homeSide ? MOCK.home : MOCK.away;
    const fair = homeSide ? this.mid : 1 - this.mid;
    const depthTicks = this.rand() % 8;
    const milli = Math.min(945, Math.max(55, Math.round((fair - 0.005 - depthTicks * 0.005) * 1000)));
    const price = snapDown(milli)!;
    const qty = [100, 250, 500, 1000, 2500, 10_000][this.rand() % 6]!;
    const id = this.id();
    const ladder = this.ladders.get(outcome)!;
    let pos = 0;
    while (pos < ladder.length && ladder[pos]!.price >= price) pos++;
    ladder.splice(pos, 0, { id, price, qty });
    return { kind: "add", order: id, outcome, price: formatPrice(price), qty };
  }

  /** One tick of market activity: book deltas, trade prints, lifecycle transitions. */
  step(golive: boolean): [unknown[], unknown[], string[]] {
    this.tick++;
    // Fair value is sticky: it moves one tick about one step in six.
    if (this.rand() % 6 === 0) {
      const up = this.rand() % 2 === 0;
      this.mid = Math.min(0.8, Math.max(0.2, this.mid + (up ? 0.005 : -0.005)));
    }
    const deltas: unknown[] = [];
    const prints: unknown[] = [];
    if (golive) {
      // GOLIVE voids every resting order.
      for (const ladder of this.ladders.values()) {
        for (const o of ladder.splice(0)) deltas.push({ kind: "remove", order: o.id, reason: "cancel" });
      }
      return [deltas, prints, ["GOLIVE"]];
    }
    const adds = (this.rand() % 3) + 1;
    for (let i = 0; i < adds; i++) deltas.push(this.randomAdd());
    // Cancel something deep.
    if (this.rand() % 2 === 0) {
      const ladder = this.ladders.get(this.rand() % 2 === 0 ? MOCK.home : MOCK.away)!;
      if (ladder.length > 12) deltas.push({ kind: "remove", order: ladder.pop()!.id, reason: "cancel" });
    }
    // A taker buys one outcome, trading against the other outcome's best bids, walking the queue.
    if (this.rand() % 2 === 0) {
      const outcome = this.rand() % 2 === 0 ? MOCK.home : MOCK.away;
      let size = [100, 250, 500, 1000, 2500, 6000][this.rand() % 6]!;
      const ts = Date.now();
      const ladder = this.ladders.get(outcome)!;
      while (size > 0 && ladder.length) {
        const best = ladder[0]!;
        const traded = Math.min(size, best.qty);
        size -= traded;
        deltas.push({ kind: "remove", order: best.id, reason: "fill" });
        prints.push({ outcome, price: formatPrice(best.price), qty: traded, ts });
        best.qty -= traded;
        if (best.qty > 0) deltas.push({ kind: "add", order: best.id, outcome, price: formatPrice(best.price), qty: best.qty });
        else ladder.shift();
      }
    }
    return [deltas, prints, []];
  }

  bookJson() {
    const orders: Record<string, unknown[]> = {};
    for (const [o, l] of this.ladders) orders[o] = l.map((r) => ({ order: r.id, price: formatPrice(r.price), qty: r.qty }));
    return { seq: this.bookSeq, orders };
  }

  marketSnapshot(channel: string) {
    const body: Record<string, unknown> = { eventId: MOCK.event_id, lifecycle: { seq: this.lifeSeq, status: "OPEN" } };
    if (channel === "book") body.book = this.bookJson();
    if (channel === "trades") body.trades = { seq: this.tradesSeq, trades: this.recentTrades };
    return { [MOCK.market_id]: body };
  }
}

export interface MockConfig { tickMs: number; dropEvery: number; goliveEvery: number; heartbeatMs: number; seed: number }

/** The engine: one clock for every connection, like the Rust mock's broadcast channel. */
export class MockEngine {
  private ex: Exchange;
  private sockets = new Set<MockSocket>();
  private timer?: ReturnType<typeof setInterval>;
  dropEvery: number;

  constructor(private cfg: MockConfig = { tickMs: 250, dropEvery: 60, goliveEvery: 300, heartbeatMs: 15_000, seed: 7 }) {
    this.ex = new Exchange(cfg.seed);
    this.dropEvery = cfg.dropEvery;
  }

  get exchange() {
    return this.ex;
  }
  get heartbeatMs() {
    return this.cfg.heartbeatMs;
  }

  attach(s: MockSocket) {
    this.sockets.add(s);
    if (!this.timer) this.timer = setInterval(() => this.tick(), this.cfg.tickMs);
  }

  detach(s: MockSocket) {
    this.sockets.delete(s);
    if (!this.sockets.size && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Drops every open connection without a close frame (the client sees 1006). */
  kill() {
    for (const s of [...this.sockets]) s.drop();
  }

  private tick() {
    const x = this.ex;
    const golive = this.cfg.goliveEvery > 0 && x.tick > 0 && (x.tick + 1) % this.cfg.goliveEvery === 0;
    const [deltas, prints, life] = x.step(golive);
    const body: Record<string, unknown> = { eventId: MOCK.event_id };
    if (deltas.length) {
      x.bookSeq++;
      body.book = { seq: x.bookSeq, deltas };
    }
    if (prints.length) {
      x.tradesSeq++;
      const batch = { seq: x.tradesSeq, deltas: prints };
      x.recentTrades.push(batch);
      if (x.recentTrades.length > 5) x.recentTrades.shift();
      body.trades = batch;
    }
    if (life.length) {
      x.lifeSeq++;
      body.lifecycle = { seq: x.lifeSeq, deltas: life };
    }
    for (const s of this.sockets) s.feed(x.tick, body);
  }
}

/** One connection to the engine. Implements the `SocketLike` the SDK's stream expects. */
export class MockSocket implements SocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private lastNonce = 0;
  private subscribed: string | null = null;
  private priv: string[] = [];
  private open = true;
  private hb: ReturnType<typeof setInterval>;

  /** `tap` sees every frame this socket delivers, after the client handled it. */
  constructor(private engine: MockEngine, private tap?: (frame: any) => void) {
    engine.attach(this);
    setTimeout(() => this.open && this.onopen?.({}), 30);
    this.hb = setInterval(() => {
      if (this.priv.includes("orders")) this.deliver({ heartbeat: { orders: 0, ts: Date.now() } });
    }, engine.heartbeatMs);
  }

  private deliver(v: unknown) {
    if (!this.open) return;
    this.onmessage?.({ data: JSON.stringify(v) });
    this.tap?.(v);
  }

  private shut(code: number, reason: string) {
    if (!this.open) return;
    this.open = false;
    clearInterval(this.hb);
    this.engine.detach(this);
    setTimeout(() => this.onclose?.({ code, reason }), 0);
  }

  close(code = 1000, reason = "") {
    this.shut(code, reason);
  }

  drop() {
    this.shut(1006, "");
  }

  feed(tick: number, body: Record<string, unknown>) {
    const ch = this.subscribed;
    if (!ch || !this.open) return;
    // Each channel carries itself plus lifecycle, nothing else.
    const b: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) if (k === "eventId" || k === "lifecycle" || k === ch) b[k] = v;
    if (Object.keys(b).length <= 1) return;
    // Misbehave on purpose: lose one frame now and then.
    const n = this.engine.dropEvery;
    if (n > 0 && tick % n === 0) return;
    this.deliver({ ts: Date.now(), delta: { [MOCK.market_id]: b } });
  }

  send(data: string) {
    setTimeout(() => this.receive(data), 5);
  }

  private receive(text: string) {
    if (!this.open) return;
    let v: any;
    try { v = JSON.parse(text); } catch {
      this.deliver({ code: "BAD_FRAME", message: "frame is not JSON" });
      return;
    }
    const nonce: number = typeof v.nonce === "number" ? v.nonce : 0;
    if (nonce <= this.lastNonce) {
      this.deliver({ nonce, code: "STALE_NONCE", message: "nonce must increase" });
      return;
    }
    this.lastNonce = nonce;
    const x = this.engine.exchange;
    const mid = MOCK.market_id;
    const sel = v.subscribe ?? v.snapshot;
    if (sel) {
      const isSub = v.subscribe !== undefined;
      let snap = {};
      const ch = sel.markets?.[mid];
      if (typeof ch === "string") {
        if (isSub) this.subscribed = ch;
        snap = x.marketSnapshot(ch);
      }
      const out: Record<string, unknown> = { ts: Date.now(), nonce, snapshot: snap };
      for (const p of (sel.private ?? []) as string[]) {
        if (isSub && !this.priv.includes(p)) this.priv.push(p);
        if (p === "orders") out.orders = { seq: 0, open: [] };
        if (p === "positions") out.positions = { seq: 0, positions: [] };
      }
      if (isSub) out.subscribed = { markets: sel.markets ?? {}, events: {}, private: this.priv };
      this.deliver(out);
    } else if (v.unsubscribe) {
      if ((v.unsubscribe as string[]).includes(`market:${mid}`)) this.subscribed = null;
      this.deliver({ nonce, unsubscribed: v.unsubscribe });
    } else if (v.status !== undefined) {
      this.deliver({ nonce, status: { markets: this.subscribed ? { [mid]: this.subscribed } : {}, private: this.priv } });
    } else {
      this.deliver({ nonce, code: "UNKNOWN_VERB", message: "expected subscribe, unsubscribe, snapshot, status" });
    }
  }
}
