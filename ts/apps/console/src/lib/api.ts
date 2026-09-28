/** Calls to the local console server (Rust, novig-v3). Everything signed goes through it. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

/** Hosted demo build: no server, the page answers /api itself (see src/demo/backend.ts). */
export const IS_DEMO = import.meta.env.VITE_DEMO === "1";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (IS_DEMO) return (await import("../demo/backend.ts")).demoCall<T>(method, path, body);
  let res: Response;
  try {
    res = await fetch(path, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "SERVER_DOWN", "The console server isn't running. Start it with `make dev` (or `cargo run -p console-server`).");
  }
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 502 && !data?.code) throw new ApiError(0, "SERVER_DOWN", "The console server isn't running. Start it with `make dev`.");
    throw new ApiError(res.status, data?.code ?? `HTTP_${res.status}`, data?.message ?? String(text).slice(0, 200), data?.requestId);
  }
  return data as T;
}

export const api = {
  get: <T,>(p: string) => call<T>("GET", p),
  post: <T,>(p: string, b: unknown = {}) => call<T>("POST", p, b),
  del: <T,>(p: string) => call<T>("DELETE", p),
};

export interface ServerStatus {
  version: string;
  env: string;
  wsUrl: string;
  management: { keyId: string; algorithm: string } | null;
  trading: { keyId: string; algorithm: string } | null;
  mock: { url: string; market: { market_id: string; event_id: string; home: string; away: string }; dropEvery: number };
  stream: null | { target: string; market: string | null; bot: boolean; stats: WsStats };
}

export interface SeqStats { last_seq: number | null; applied: number; gaps: number; resyncs: number; stale: number; buffered_now: number; awaiting_snapshot: boolean }
export interface WsStats {
  connected: boolean; connection: number; reconnects: number; nonce: number; messages: number; bytes: number; gaps: number; resyncs: number;
  server_errors: number; queued_verbs: number; last_message_ts: number | null; last_heartbeat_ts: number | null; subscribed_weight: number; watched_markets: number;
  subjects: Record<string, SeqStats>;
}
export interface BucketView { bucket: string; capacity: number; refill_per_sec: number; tokens: number; spent_total: number; waited_ms_total: number; rejections_429: number; blocked_ms: number }
export interface Level { price: string; qty: number; orders: number }
export interface BookViewWire { market_id: string; seq: number; orders: number; outcomes: Array<{ outcome_id: string; quote: { bid: Level | null; offer: Level | null }; levels: Level[] }> }
export interface RequestRecordWire { method: string; path: string; query: string; status: number; millis: number; bucket: string | null; cost: number; waited_ms: number; attempt: number; request_id: string | null; error_code: string | null; string_to_sign: string | null; ts: number }

export type WsEventWire =
  | { type: "connected"; url: string; connection: number }
  | { type: "disconnected"; reason: string; code: number | null; retry_in_ms: number }
  | { type: "subscribed"; nonce: number | null; subscribed: unknown }
  | { type: "book"; view: BookViewWire }
  | { type: "removals"; market_id: string; seq: number; removals: Array<{ order: string; outcome: string; price: string; resting_qty: number; executed: number; reason: "fill" | "cancel" }> }
  | { type: "book_reset"; market_id: string; seq: number }
  | { type: "trades"; market_id: string; seq: number; trades: Array<{ outcome: string; price: string; qty: number; ts: number }> }
  | { type: "lifecycle"; market_id: string; seq: number; status: string | null; transitions: string[] }
  | { type: "bbo"; market_id: string; seq: number; data: unknown }
  | { type: "orders"; seq: number; events: Array<{ kind: string; orderId: string; [k: string]: unknown }> }
  | { type: "orders_snapshot"; seq: number; open: unknown[] }
  | { type: "positions"; seq: number; positions: unknown[] }
  | { type: "gap"; subject: string; missing: number; got: number }
  | { type: "resynced"; subject: string; seq: number; replayed: number }
  | { type: "heartbeat"; ts: number | null; private: Record<string, number> }
  | { type: "server_error"; code: string; message: string; nonce: number | null }
  | { type: "ack"; nonce: number | null; body: unknown };

export interface BotStateWire {
  running: boolean; mode: "paper" | "live"; status: string; live: boolean; fair: number | null; skewed_fair: number | null;
  config: { market_id: string; outcomes: [string, string]; names: [string, string]; half_spread_ticks: number; size: number; max_position: number; fee: { coefficient: string; makerCredit: string; charged: string } };
  quotes: Array<{ outcome: string; name: string; order_id: string; price: string; qty: number; remaining: number; status: string; ahead: number; placed_ts: number }>;
  positions: Record<string, { qty: number; cost: string }>;
  pnl: { cost: string; mark_value: string; maker_credits: string; locked_pairs: number; total: string };
  counters: { placed: number; canceled: number; rejected: number; fills: number; requotes: number; golives: number; contracts_traded: number };
  fills: Array<{ ts: number; outcome: string; name: string; price: string; qty: number; maker_credit: string; live: boolean; how: string }>;
  log: Array<{ ts: number; level: string; text: string }>;
}
