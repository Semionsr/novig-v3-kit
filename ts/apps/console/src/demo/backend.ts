/**
 * Stands in for the Rust console server when the console is hosted as a static site
 * (`VITE_DEMO=1`). It answers the same `/api/*` calls and pushes the same `{kind, data}` feed the
 * server sends over SSE, but everything runs in this tab: the TypeScript SDK's `NovigStream`
 * against an in-page port of the mock exchange, and a TypeScript port of the paper maker.
 * Signed calls need a Novig QA key, which only ever lives on the machine running the kit.
 */
import { Book, NovigStream, Sequencer, Throttler, formatPrice, type BookDelta, type BookView, type StreamEvent, type StreamStats } from "@semion/novig-v3";
import { ApiError, type BookViewWire, type ServerStatus, type WsEventWire, type WsStats } from "../lib/api.ts";
import { MOCK, MOCK_URL, MockEngine, MockSocket } from "./mockExchange.ts";
import { PaperMaker, type Removal } from "./maker.ts";

type Msg = { kind: string; data: unknown };
const subs = new Set<(m: Msg) => void>();
const emit = (kind: string, data: unknown) => { for (const s of subs) s({ kind, data }); };

export function subscribe(fn: (m: Msg) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

const engine = new MockEngine();

interface Session {
  stream: NovigStream;
  throttle: Throttler;
  timer: ReturnType<typeof setInterval>;
  bot: PaperMaker | null;
}
let session: Session | null = null;

// ---------- wire mapping (TypeScript SDK camelCase → the Rust server's snake_case) ----------

function wsStats(s: StreamStats): WsStats {
  return {
    connected: s.connected, connection: s.connection, reconnects: s.reconnects, nonce: s.nonce, messages: s.messages, bytes: s.bytes, gaps: s.gaps, resyncs: s.resyncs,
    server_errors: s.serverErrors, queued_verbs: s.queuedVerbs, last_message_ts: s.lastMessageTs ?? null, last_heartbeat_ts: s.lastHeartbeatTs ?? null,
    subscribed_weight: s.subscribedWeight, watched_markets: s.watchedMarkets,
    subjects: Object.fromEntries(Object.entries(s.subjects).map(([k, v]) => [k, { last_seq: v.lastSeq, applied: v.applied, gaps: v.gaps, resyncs: v.resyncs, stale: v.stale, buffered_now: v.bufferedNow, awaiting_snapshot: v.awaitingSnapshot }])),
  };
}

const level = (l?: { price: number; qty: number; orders: number }) => (l ? { price: formatPrice(l.price), qty: l.qty, orders: l.orders } : null);
function bookView(v: BookView): BookViewWire {
  return { market_id: v.marketId, seq: v.seq, orders: v.orders, outcomes: v.outcomes.map((o) => ({ outcome_id: o.outcomeId, quote: { bid: level(o.quote.bid), offer: level(o.quote.offer) }, levels: o.levels.map((l) => level(l)!) })) };
}

function wire(e: StreamEvent): WsEventWire {
  switch (e.type) {
    case "connected": return e;
    case "disconnected": return { type: "disconnected", reason: e.reason, code: e.code ?? null, retry_in_ms: e.retryInMs };
    case "subscribed": return { type: "subscribed", nonce: e.nonce ?? null, subscribed: e.subscribed };
    case "book": return { type: "book", view: bookView(e.view) };
    case "trades": return { type: "trades", market_id: e.marketId, seq: e.seq, trades: e.trades };
    case "lifecycle": return { type: "lifecycle", market_id: e.marketId, seq: e.seq, status: e.status ?? null, transitions: e.transitions };
    case "bbo": return { type: "bbo", market_id: e.marketId, seq: e.seq, data: e.data };
    case "orders": return { type: "orders", seq: e.seq, events: e.events as any };
    case "orders_snapshot": return { type: "orders_snapshot", seq: e.seq, open: e.open };
    case "positions": return { type: "positions", seq: e.seq, positions: e.positions };
    case "gap": return e;
    case "resynced": return e;
    case "heartbeat": return { type: "heartbeat", ts: e.ts ?? null, private: e.private };
    case "server_error": return { type: "server_error", code: e.code, message: e.message, nonce: e.nonce ?? null };
    case "ack": return { type: "ack", nonce: e.nonce ?? null, body: e.body };
  }
}

const bucketWire = (t: Throttler) => t.snapshot().map((b) => ({ bucket: b.bucket, capacity: b.capacity, refill_per_sec: b.refillPerSec, tokens: b.tokens, spent_total: b.spentTotal, waited_ms_total: b.waitedMsTotal, rejections_429: b.rejections429, blocked_ms: b.blockedMs }));

// ---------- removals: a shadow of the book the client saw, to know what each remove took ----------

/** Mirrors the frames the client received (same sequencing), and reports what each `remove` took off the book. */
class Shadow {
  private seq = new Sequencer<{ deltas: BookDelta[] }>();
  private book = new Book([MOCK.home, MOCK.away]);

  frame(v: any) {
    const snap = v.snapshot?.[MOCK.market_id]?.book;
    if (snap) {
      const replay = this.seq.snapshot(snap.seq);
      this.book.load(snap.seq, snap.orders ?? {});
      out({ type: "book_reset", market_id: MOCK.market_id, seq: snap.seq });
      for (const [n, b] of replay) this.apply(n, b.deltas);
    }
    const delta = v.delta?.[MOCK.market_id]?.book;
    if (delta) {
      const step = this.seq.delta(delta.seq, delta);
      if (step.kind === "apply") this.apply(delta.seq, delta.deltas);
    }
  }

  private apply(seq: number, deltas: BookDelta[]) {
    const where = new Map<string, { outcome: string; price: number; qty: number }>();
    for (const o of this.book.outcomes()) for (const r of this.book.queue(o)) where.set(r.id, { outcome: o, price: r.price, qty: r.qty });
    const readded = new Map<string, number>();
    for (const d of deltas) if (d.kind === "add") readded.set(d.order, d.qty);
    const removals: Removal[] = [];
    for (const d of deltas) {
      if (d.kind !== "remove") continue;
      const r = where.get(d.order);
      if (!r) continue;
      const reason = d.reason === "fill" ? "fill" : "cancel";
      const executed = reason === "fill" ? r.qty - (readded.get(d.order) ?? 0) : 0;
      removals.push({ order: d.order, outcome: r.outcome, price: r.price, resting_qty: r.qty, executed: Math.max(0, executed), reason });
    }
    this.book.apply(seq, deltas);
    if (removals.length) {
      emit("ws", { type: "removals", market_id: MOCK.market_id, seq, removals: removals.map((r) => ({ ...r, price: formatPrice(r.price) })) });
      session?.bot?.onRemovals(removals, Date.now());
    }
  }
}

function out(ev: WsEventWire) {
  emit("ws", ev);
  const s = session;
  if (!s?.bot) return;
  const now = Date.now();
  const book = s.stream.book(MOCK.market_id);
  if (ev.type === "lifecycle") s.bot.onLifecycle(ev.transitions, now);
  if (ev.type === "book_reset" && book) s.bot.onBookReset(book);
  if (book) s.bot.onBook(book, now);
}

// ---------- the /api surface ----------

function status(): ServerStatus {
  return {
    version: "demo",
    env: "demo",
    wsUrl: MOCK_URL,
    management: null,
    trading: null,
    mock: { url: MOCK_URL, market: MOCK, dropEvery: engine.dropEvery },
    stream: session ? { target: "mock", market: MOCK.market_id, bot: !!session.bot, stats: wsStats(session.stream.stats) } : null,
  };
}

function connect() {
  disconnect();
  const throttle = new Throttler();
  const shadow = new Shadow();
  const stream = new NovigStream({ url: MOCK_URL, throttler: throttle, bookDepth: 15, socketFactory: () => new MockSocket(engine, (f) => shadow.frame(f)) });
  stream.on((e) => out(wire(e)));
  const timer = setInterval(() => {
    if (!session) return;
    emit("stats", { ws: wsStats(session.stream.stats), stream: bucketWire(session.throttle), signed: [], mockDropEvery: engine.dropEvery });
    if (session.bot) emit("bot", session.bot.state());
  }, 500);
  session = { stream, throttle, timer, bot: null };
  stream.connect();
  stream.subscribe({ markets: { [MOCK.market_id]: "book" } });
  return { url: MOCK_URL, market: MOCK.market_id };
}

function disconnect() {
  if (!session) return;
  session.stream.close();
  clearInterval(session.timer);
  session = null;
}

const LOCAL_ONLY = "This step signs requests with a Novig QA key, and keys only ever live on the machine running the kit. Clone the repo and run `make dev` to use it (see the README). Everything else on this page runs right here.";

interface BotBody { mode?: string; halfSpreadTicks?: number; size?: number; maxPosition?: number }

export async function demoCall<T>(method: string, path: string, body?: any): Promise<T> {
  const p = path.split("?")[0]!;
  const r = (v: unknown) => v as T;
  if (method === "GET" && p === "/api/status") return r(status());
  if (p.startsWith("/api/signed/") || p === "/api/throttle/burst") throw new ApiError(428, "RUNS_LOCALLY", LOCAL_ONLY);
  if (method !== "POST") throw new ApiError(404, "NOT_FOUND", `${method} ${p} isn't part of the demo`);
  switch (p) {
    case "/api/stream/connect":
      if (body?.target === "qa") throw new ApiError(428, "RUNS_LOCALLY", LOCAL_ONLY);
      return r(connect());
    case "/api/stream/disconnect":
      disconnect();
      return r({});
    case "/api/stream/snapshot":
      if (!session) throw new ApiError(409, "NOT_CONNECTED", "connect first");
      session.stream.snapshot({ markets: { [MOCK.market_id]: "book" } });
      return r({});
    case "/api/mock/kill":
      engine.kill();
      return r({ killed: true });
    case "/api/mock/loss":
      engine.dropEvery = Math.max(0, Number(body?.dropEvery ?? 0));
      return r({ dropEvery: engine.dropEvery });
    case "/api/bot/start": {
      if (!session) throw new ApiError(409, "NOT_CONNECTED", "connect the stream to a market first");
      const b = (body ?? {}) as BotBody;
      if (b.mode === "live") throw new ApiError(409, "LIVE_NEEDS_QA", "live mode trades on Novig QA with a trading key; use paper mode on the mock");
      session.bot = new PaperMaker({
        marketId: MOCK.market_id, outcomes: [MOCK.home, MOCK.away], names: ["Home", "Away"],
        fee: { coefficient: "0.03", makerCredit: "0.5", charged: "WHEN_LIVE" },
        halfSpreadTicks: Math.max(1, b.halfSpreadTicks ?? 1), size: Math.max(1, b.size ?? 500), maxPosition: Math.max(1, b.maxPosition ?? 5000),
        skewTicksAtMax: 3, requoteTicks: 1, minRequoteMs: 400, goliveCooldownMs: 2000,
      });
      session.bot.start();
      emit("bot", session.bot.state());
      return r({ started: true });
    }
    case "/api/bot/stop":
      session?.bot?.stop();
      if (session?.bot) emit("bot", session.bot.state());
      return r({ stopped: true });
    case "/api/bot/config": {
      const bot = session?.bot;
      if (!bot) throw new ApiError(409, "NO_BOT", "start the bot first");
      const b = (body ?? {}) as BotBody;
      const cfg = { ...bot.config() };
      if (b.halfSpreadTicks !== undefined) cfg.halfSpreadTicks = Math.max(1, b.halfSpreadTicks);
      if (b.size !== undefined) cfg.size = Math.max(1, b.size);
      if (b.maxPosition !== undefined) cfg.maxPosition = Math.max(1, b.maxPosition);
      bot.setConfig(cfg);
      return r({});
    }
  }
  throw new ApiError(404, "NOT_FOUND", `POST ${p} isn't part of the demo`);
}

