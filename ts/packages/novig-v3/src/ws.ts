/**
 * One websocket for every channel, with the recovery rules from
 * docs.novig.com/api/streaming/connection: nonces from 1, per-subject `seq`, gap → `snapshot`
 * for just that subject, drop covered deltas, replay the rest; private heartbeats reveal dropped
 * `orders`/`positions` frames; reconnect and re-subscribe on SLOW_CONSUMER or a silent drop.
 * Outgoing verbs are paced by the `stream` bucket in a queue, so reading never stalls.
 *
 * The upgrade must be signed. React Native's WebSocket and Node's `ws` accept headers; browsers
 * don't, so a browser app connects through a small signing proxy (the console server does this).
 */
import { Book, type BookDelta, type Level, type Quote } from "./book.ts";
import { Sequencer, type SeqStats } from "./seq.ts";
import { type Credentials, sign } from "./sign.ts";
import { Throttler, WS_WEIGHT } from "./throttle.ts";
import type { OpenOrder, Position } from "./types.ts";

export interface Selection {
  markets?: Record<string, string>;
  events?: Record<string, string>;
  private?: string[];
}

export type OrderEvent =
  | { kind: "open"; orderId: string; clientId?: string; marketId: string; outcomeId: string; price: string; qty: number; tif: string; expiresAt?: number }
  | { kind: "fill"; orderId: string; clientId?: string; outcomeId: string; price: string; qty: number; remaining: number }
  | { kind: "cancel"; orderId: string; reason?: "GO_LIVE" | "MARKET_CLOSED" | "SETTLED" | "NEUTRALIZED" | string }
  | { kind: "reject"; orderId: string };

export interface BookView {
  marketId: string;
  seq: number;
  orders: number;
  outcomes: Array<{ outcomeId: string; quote: Quote; levels: Level[] }>;
}

export type StreamEvent =
  | { type: "connected"; url: string; connection: number }
  | { type: "disconnected"; reason: string; code?: number; retryInMs: number }
  | { type: "subscribed"; nonce?: number; subscribed: unknown }
  | { type: "book"; view: BookView }
  | { type: "trades"; marketId: string; seq: number; trades: Array<{ outcome: string; price: string; qty: number; ts: number }> }
  | { type: "lifecycle"; marketId: string; seq: number; status?: string; transitions: string[] }
  | { type: "bbo"; marketId: string; seq: number; data: unknown }
  | { type: "orders"; seq: number; events: OrderEvent[] }
  | { type: "orders_snapshot"; seq: number; open: OpenOrder[] }
  | { type: "positions"; seq: number; positions: Position[] }
  | { type: "gap"; subject: string; missing: number; got: number }
  | { type: "resynced"; subject: string; seq: number; replayed: number }
  | { type: "heartbeat"; ts?: number; private: Record<string, number> }
  | { type: "server_error"; code: string; message: string; nonce?: number }
  | { type: "ack"; nonce?: number; body: unknown };

/** The subset of WebSocket this needs; RN's WebSocket, the DOM one, and `ws` all fit. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike;

/** React Native / `ws` style: `new WebSocket(url, protocols, { headers })`. */
export const defaultSocketFactory: SocketFactory = (url, headers) => {
  const WS = (globalThis as unknown as { WebSocket: new (u: string, p?: string[] | undefined, o?: unknown) => SocketLike }).WebSocket;
  return new WS(url, undefined, { headers });
};

export interface StreamOptions {
  url: string;
  credentials?: Credentials;
  throttler?: Throttler;
  socketFactory?: SocketFactory;
  bookDepth?: number;
  idleTimeoutMs?: number;
}

export interface StreamStats {
  connected: boolean;
  connection: number;
  reconnects: number;
  nonce: number;
  messages: number;
  bytes: number;
  gaps: number;
  resyncs: number;
  serverErrors: number;
  queuedVerbs: number;
  lastMessageTs?: number;
  lastHeartbeatTs?: number;
  subscribedWeight: number;
  watchedMarkets: number;
  subjects: Record<string, SeqStats>;
}

const weightOf = (ch: string) => (WS_WEIGHT as Record<string, number>)[ch] ?? 1;
export function selectionWeight(s: Selection): number {
  return [...Object.values(s.markets ?? {}), ...Object.values(s.events ?? {}), ...(s.private ?? [])].reduce((a, c) => a + weightOf(c), 0);
}

export class NovigStream {
  private socket?: SocketLike;
  private seqs = new Map<string, Sequencer<any>>();
  private books = new Map<string, Book>();
  private desired: Required<Selection> = { markets: {}, events: {}, private: [] };
  private outbox: Array<{ verb: string; payload: unknown; weight: number }> = [];
  private listeners = new Set<(e: StreamEvent) => void>();
  private timers: { idle?: ReturnType<typeof setTimeout>; send?: ReturnType<typeof setTimeout>; retry?: ReturnType<typeof setTimeout> } = {};
  private backoff = 500;
  private closed = false;
  readonly throttler: Throttler;
  readonly stats: StreamStats = { connected: false, connection: 0, reconnects: 0, nonce: 0, messages: 0, bytes: 0, gaps: 0, resyncs: 0, serverErrors: 0, queuedVerbs: 0, subscribedWeight: 0, watchedMarkets: 0, subjects: {} };

  constructor(private opts: StreamOptions) {
    this.throttler = opts.throttler ?? new Throttler();
  }

  on(fn: (e: StreamEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  connect() {
    this.closed = false;
    this.open();
    return this;
  }

  subscribe(sel: Selection) {
    Object.assign(this.desired.markets, sel.markets ?? {});
    Object.assign(this.desired.events, sel.events ?? {});
    for (const p of sel.private ?? []) if (!this.desired.private.includes(p)) this.desired.private.push(p);
    for (const [id, ch] of Object.entries(sel.markets ?? {})) this.seqs.set(`market:${id}:${ch}`, new Sequencer());
    this.updateDesiredStats();
    this.enqueue("subscribe", sel, selectionWeight(sel));
  }

  /** Subjects: `market:<id>`, `event:<id>`, or `PRIVATE`. */
  unsubscribe(subjects: string[]) {
    for (const s of subjects) {
      if (s === "PRIVATE") this.desired.private = [];
      else if (s.startsWith("market:")) {
        const id = s.slice(7);
        delete this.desired.markets[id];
        this.books.delete(id);
        for (const k of [...this.seqs.keys()]) if (k.startsWith(s)) this.seqs.delete(k);
      } else if (s.startsWith("event:")) delete this.desired.events[s.slice(6)];
    }
    this.updateDesiredStats();
    this.enqueue("unsubscribe", subjects, subjects.length);
  }

  snapshot(sel: Selection) {
    this.enqueue("snapshot", sel, selectionWeight(sel));
  }

  status() {
    this.enqueue("status", {}, 1);
  }

  book(marketId: string): Book | undefined {
    return this.books.get(marketId);
  }

  close() {
    this.closed = true;
    for (const t of Object.values(this.timers)) if (t) clearTimeout(t);
    this.socket?.close(1000, "bye");
  }

  // ----- internals -----
  private emit(e: StreamEvent) {
    for (const l of this.listeners) l(e);
  }

  private open() {
    const headers: Record<string, string> = {};
    if (this.opts.credentials) {
      const u = new URL(this.opts.url);
      Object.assign(headers, sign(this.opts.credentials, { method: "GET", path: u.pathname, query: u.search.replace(/^\?/, "") }).headers);
    }
    this.throttler.tryAcquire({ bucket: "stream", tokens: WS_WEIGHT.upgrade });
    const socket = (this.opts.socketFactory ?? defaultSocketFactory)(this.opts.url, headers);
    this.socket = socket;
    const connection = ++this.stats.connection;
    socket.onopen = () => {
      this.backoff = 500;
      this.stats.connected = true;
      this.stats.nonce = 0;
      this.emit({ type: "connected", url: this.opts.url, connection });
      if (selectionWeight(this.desired) > 0) {
        for (const [id, ch] of Object.entries(this.desired.markets)) this.seqs.set(`market:${id}:${ch}`, new Sequencer());
        this.outbox.unshift({ verb: "subscribe", payload: this.compactDesired(), weight: selectionWeight(this.desired) });
      }
      this.flush();
      this.touch();
    };
    socket.onmessage = (ev) => {
      this.touch();
      const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
      this.stats.messages++;
      this.stats.bytes += text.length;
      this.stats.lastMessageTs = Date.now();
      let v: any;
      try { v = JSON.parse(text); } catch { return; }
      for (const sel of this.route(v)) this.enqueue("snapshot", sel, selectionWeight(sel));
      this.stats.subjects = Object.fromEntries([...this.seqs].map(([k, s]) => [k, s.stats()]));
    };
    socket.onerror = () => {};
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.stats.connected = false;
      for (const k of ["idle", "send"] as const) if (this.timers[k]) clearTimeout(this.timers[k]);
      if (this.closed) return;
      this.stats.reconnects++;
      const reason = ev.reason === "SLOW_CONSUMER" ? "SLOW_CONSUMER: reconnecting and taking fresh snapshots" : ev.reason || (ev.code === 1006 ? "dropped without a close frame" : "closed");
      this.emit({ type: "disconnected", reason, code: ev.code, retryInMs: this.backoff });
      this.seqs.clear();
      this.outbox = this.outbox.filter((o) => o.verb !== "snapshot" && o.verb !== "subscribe");
      this.timers.retry = setTimeout(() => this.open(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 10_000);
    };
  }

  private touch() {
    if (this.timers.idle) clearTimeout(this.timers.idle);
    this.timers.idle = setTimeout(() => this.socket?.close(4000, "idle timeout"), this.opts.idleTimeoutMs ?? 40_000);
  }

  private compactDesired(): Selection {
    const s: Selection = {};
    if (Object.keys(this.desired.markets).length) s.markets = this.desired.markets;
    if (Object.keys(this.desired.events).length) s.events = this.desired.events;
    if (this.desired.private.length) s.private = this.desired.private;
    return s;
  }

  private updateDesiredStats() {
    this.stats.subscribedWeight = selectionWeight(this.desired);
    this.stats.watchedMarkets = Object.keys(this.desired.markets).length;
  }

  private enqueue(verb: string, payload: unknown, weight: number) {
    const key = JSON.stringify(payload);
    if (verb === "snapshot" && this.outbox.some((o) => o.verb === "snapshot" && JSON.stringify(o.payload) === key)) return;
    this.outbox.push({ verb, payload, weight });
    this.flush();
  }

  private flush() {
    if (!this.stats.connected || !this.socket) return;
    while (this.outbox.length) {
      const next = this.outbox[0]!;
      const wait = this.throttler.tryAcquire({ bucket: "stream", tokens: Math.max(1, next.weight) });
      if (wait > 0) {
        if (this.timers.send) clearTimeout(this.timers.send);
        this.timers.send = setTimeout(() => this.flush(), wait);
        break;
      }
      this.outbox.shift();
      this.stats.nonce++;
      this.socket.send(JSON.stringify({ nonce: this.stats.nonce, [next.verb]: next.payload }));
    }
    this.stats.queuedVerbs = this.outbox.length;
  }

  private route(v: any): Selection[] {
    const heal: Selection[] = [];
    const nonce: number | undefined = v.nonce;
    if (typeof v.code === "string") {
      this.stats.serverErrors++;
      this.emit({ type: "server_error", code: v.code, message: v.message ?? "", nonce });
      return heal;
    }
    if (v.heartbeat) {
      const priv: Record<string, number> = {};
      for (const ch of ["orders", "positions"]) {
        const server = v.heartbeat[ch];
        if (typeof server !== "number") continue;
        priv[ch] = server;
        const s = this.seqs.get(`private:${ch}`);
        if (s && s.lastSeq !== null && server > s.lastSeq && !s.awaitingSnapshot) {
          const missing = s.lastSeq + 1;
          s.reset();
          this.stats.gaps++;
          this.emit({ type: "gap", subject: `private:${ch}`, missing, got: server });
          heal.push({ private: [ch] });
        }
      }
      this.stats.lastHeartbeatTs = v.heartbeat.ts ?? Date.now();
      this.emit({ type: "heartbeat", ts: v.heartbeat.ts, private: priv });
      return heal;
    }
    if (v.subscribed) this.emit({ type: "subscribed", nonce, subscribed: v.subscribed });

    for (const [marketId, body] of Object.entries<any>(v.snapshot ?? {})) {
      for (const ch of ["book", "trades", "bbo", "lifecycle"]) if (body[ch]) this.marketSnapshot(marketId, ch, body[ch]);
    }
    for (const ch of ["orders", "positions"]) if (v[ch] && !v[ch].deltas) this.privateSnapshot(ch, v[ch]);
    for (const [marketId, body] of Object.entries<any>(v.delta ?? {})) {
      for (const ch of ["book", "trades", "bbo", "lifecycle"]) {
        if (!body[ch]) continue;
        const h = this.marketDelta(marketId, ch, body[ch]);
        if (h) heal.push(h);
      }
    }
    for (const ch of ["orders", "positions"]) {
      if (v[ch]?.deltas) {
        const h = this.privateDelta(ch, v[ch]);
        if (h) heal.push(h);
      }
    }
    const known = new Set(["nonce", "ts", "subscribed", "snapshot", "delta", "orders", "positions"]);
    if (Object.keys(v).some((k) => !known.has(k))) this.emit({ type: "ack", nonce, body: v });
    return heal;
  }

  private view(marketId: string, book: Book): BookView {
    return { marketId, seq: book.seq, orders: book.orderCount, outcomes: book.outcomes().map((o) => ({ outcomeId: o, quote: book.quote(o), levels: book.levels(o, this.opts.bookDepth ?? 10) })) };
  }

  private marketSnapshot(marketId: string, ch: string, chan: any) {
    const subject = `market:${marketId}:${ch}`;
    const seq: number = chan.seq ?? 0;
    let s = this.seqs.get(subject);
    if (!s) this.seqs.set(subject, (s = new Sequencer()));
    const healing = s.lastSeq !== null && s.awaitingSnapshot;
    const replay = s.snapshot(seq);
    if (ch === "book") {
      const book = this.books.get(marketId) ?? new Book();
      this.books.set(marketId, book);
      book.load(seq, chan.orders ?? {});
      for (const [n, b] of replay) book.apply(n, b.deltas ?? []);
      this.emit({ type: "book", view: this.view(marketId, book) });
    } else if (ch === "trades") {
      this.emit({ type: "trades", marketId, seq, trades: (chan.trades ?? []).flatMap((b: any) => b.deltas ?? []) });
      for (const [n, b] of replay) this.emitMarket(marketId, ch, n, b);
    } else if (ch === "lifecycle") {
      this.emit({ type: "lifecycle", marketId, seq, status: chan.status, transitions: [] });
      for (const [n, b] of replay) this.emitMarket(marketId, ch, n, b);
    } else this.emit({ type: "bbo", marketId, seq, data: chan });
    if (healing) {
      this.stats.resyncs++;
      this.emit({ type: "resynced", subject, seq, replayed: replay.length });
    }
  }

  private marketDelta(marketId: string, ch: string, chan: any): Selection | undefined {
    const wanted = this.desired.markets[marketId];
    if (ch !== "lifecycle" && wanted && wanted !== ch) return;
    const subject = `market:${marketId}:${ch}`;
    let s = this.seqs.get(subject);
    if (!s) this.seqs.set(subject, (s = Sequencer.startingAt(0)));
    const step = s.delta(chan.seq, chan);
    if (step.kind === "apply") {
      if (ch === "book") {
        const book = this.books.get(marketId) ?? new Book();
        this.books.set(marketId, book);
        book.apply(chan.seq, chan.deltas as BookDelta[]);
        this.emit({ type: "book", view: this.view(marketId, book) });
      } else this.emitMarket(marketId, ch, chan.seq, chan);
    } else if (step.kind === "gap") {
      this.stats.gaps++;
      this.emit({ type: "gap", subject, missing: step.missing, got: step.got });
      return { markets: { [marketId]: wanted ?? ch } };
    }
  }

  private emitMarket(marketId: string, ch: string, seq: number, batch: any) {
    if (ch === "trades") this.emit({ type: "trades", marketId, seq, trades: batch.deltas ?? [] });
    else if (ch === "lifecycle") {
      const transitions: string[] = batch.deltas ?? [];
      const map: Record<string, string> = { OPEN: "OPEN", CLOSE: "CLOSED", GRADE: "SETTLED" };
      const status = [...transitions].reverse().map((t) => map[t]).find(Boolean);
      this.emit({ type: "lifecycle", marketId, seq, status, transitions });
    } else this.emit({ type: "bbo", marketId, seq, data: batch });
  }

  private privateSnapshot(ch: string, p: any) {
    const subject = `private:${ch}`;
    let s = this.seqs.get(subject);
    if (!s) this.seqs.set(subject, (s = new Sequencer()));
    const healing = s.lastSeq !== null && s.awaitingSnapshot;
    const replay = s.snapshot(p.seq ?? 0);
    if (ch === "orders") this.emit({ type: "orders_snapshot", seq: p.seq ?? 0, open: p.open ?? [] });
    else this.emit({ type: "positions", seq: p.seq ?? 0, positions: p.positions ?? [] });
    for (const [n, b] of replay) this.emitPrivate(ch, n, b);
    if (healing) {
      this.stats.resyncs++;
      this.emit({ type: "resynced", subject, seq: p.seq ?? 0, replayed: replay.length });
    }
  }

  private privateDelta(ch: string, p: any): Selection | undefined {
    const subject = `private:${ch}`;
    let s = this.seqs.get(subject);
    if (!s) this.seqs.set(subject, (s = new Sequencer()));
    const step = s.delta(p.seq, p);
    if (step.kind === "apply") this.emitPrivate(ch, p.seq, p);
    else if (step.kind === "gap") {
      this.stats.gaps++;
      this.emit({ type: "gap", subject, missing: step.missing, got: step.got });
      return { private: [ch] };
    }
  }

  private emitPrivate(ch: string, seq: number, batch: any) {
    if (ch === "orders") this.emit({ type: "orders", seq, events: batch.deltas ?? [] });
    else this.emit({ type: "positions", seq, positions: batch.deltas ?? [] });
  }
}
