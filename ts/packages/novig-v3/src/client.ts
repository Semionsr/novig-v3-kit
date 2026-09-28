/**
 * Typed REST for every v3 route, on `fetch` (browsers, React Native, Node 18+, workers).
 *
 * - Signs the path and query it actually sends (query built here, in canonical encoding).
 * - Serializes the body once and hashes those exact bytes; always sends Content-Type on bodies
 *   (without it the server hashes zero bytes).
 * - Paces through the Throttler; a 429 waits Retry-After and retries (a throttled request is
 *   refused before it acts, so even a retried POST /v3/orders can't double-place).
 * - Splits order batches under the edge's 8 KiB body cap (~90 orders), which otherwise fails
 *   with an HTML 403 that never reaches Novig.
 */
import { buildQuery } from "./query.ts";
import { type Credentials, sign } from "./sign.ts";
import { type Bucket, type Cost, Throttler } from "./throttle.ts";
import {
  EDGE_BODY_LIMIT,
  type Balance, type BatchCancelResult, type BatchPlaceResult, type BookSnapshot, type CancelAccepted, type CancelAllResult,
  type CreateKey, type CreateSubaccountKey, type ErrorBody, type Event, type Fill, type Key, type KeyCreated, type Market,
  type OpenSubaccount, type Order, type OrderAccepted, type OrdersSnapshot, type OrderStatus, type Page, type PlaceOrder,
  type Position, type PositionsSnapshot, type Subaccount, type Throttle, type Trade, type Transaction, type Transfer,
  type TransferRequest,
} from "./types.ts";

export const ENVIRONMENTS = {
  production: "https://api.novig.com",
  qa: "https://api.qa.novig.com",
} as const;
export type EnvironmentName = keyof typeof ENVIRONMENTS;

export class NovigError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly body?: ErrorBody | string,
  ) {
    super(`${status} ${code}: ${message}`);
  }
  /** The edge's HTML 403: the request never reached Novig's servers. */
  get fromEdge() {
    return this.code === "EDGE_REFUSED";
  }
}

export interface RequestRecord {
  method: string;
  path: string;
  query: string;
  status: number;
  ms: number;
  bucket?: Bucket;
  cost: number;
  waitedMs: number;
  attempt: number;
  requestId?: string;
  errorCode?: string;
  stringToSign?: string;
  ts: number;
}

export interface ClientOptions {
  env?: EnvironmentName | { baseUrl: string };
  credentials?: Credentials;
  throttler?: Throttler;
  fetch?: typeof fetch;
  onRequest?: (r: RequestRecord) => void;
  maxAttempts?: number;
}

type Q = Record<string, string | number | boolean | undefined | null>;
export interface CatalogFilter { league?: string; marketType?: string; eventStatus?: string; event?: string; status?: string; startsAfter?: number; startsBefore?: number; limit?: number; after?: string }
export interface OrderFilter { event?: string; market?: string; outcome?: string; order?: string; status?: OrderStatus; kind?: Transaction["kind"]; startsAfter?: number; startsBefore?: number; limit?: number; after?: string }
export type Conditional<T> = { notModified: true } | { notModified: false; value: T; etag?: string };

const read: Cost = { bucket: "read", tokens: 1 };
const pub: Cost = { bucket: "public", tokens: 1 };
const account: Cost = { bucket: "account", tokens: 1 };
const pick = (f: object, keys: string[]): Q => Object.fromEntries(Object.entries(f).filter(([k]) => keys.includes(k)));
const utf8 = new TextEncoder();

export class NovigClient {
  readonly baseUrl: string;
  readonly throttler: Throttler;
  private readonly creds?: Credentials;
  private readonly f: typeof fetch;
  private readonly onRequest?: (r: RequestRecord) => void;
  private readonly maxAttempts: number;

  constructor(opts: ClientOptions = {}) {
    const env = opts.env ?? "production";
    this.baseUrl = typeof env === "string" ? ENVIRONMENTS[env] : env.baseUrl.replace(/\/$/, "");
    this.creds = opts.credentials;
    this.throttler = opts.throttler ?? new Throttler();
    this.f = opts.fetch ?? ((...a) => fetch(...a));
    this.onRequest = opts.onRequest;
    this.maxAttempts = opts.maxAttempts ?? 4;
  }

  get wsUrl() {
    return `${this.baseUrl.replace(/^http/, "ws")}/v3/ws`;
  }

  // ----- public (no key) -----
  publicMarkets(f: CatalogFilter = {}) { return this.get<Page<Market>>("/v3/public/catalog/markets", pick(f, ["league", "marketType", "eventStatus", "event", "startsAfter", "startsBefore", "limit", "after"]), pub, false); }
  publicMarket(id: string) { return this.get<Market>(`/v3/public/catalog/markets/${id}`, {}, pub, false); }
  publicEvents(f: CatalogFilter = {}) { return this.get<Page<Event>>("/v3/public/catalog/events", pick(f, ["league", "status", "startsAfter", "startsBefore", "limit", "after"]), pub, false); }
  publicEvent(id: string) { return this.get<Event>(`/v3/public/catalog/events/${id}`, {}, pub, false); }
  publicBook(id: string, etag?: string) { return this.conditional<BookSnapshot>(`/v3/public/catalog/markets/${id}/book`, pub, false, etag); }
  publicTrades(id: string, limit?: number, after?: string) { return this.get<Page<Trade>>(`/v3/public/catalog/markets/${id}/trades`, { limit, after }, pub, false); }
  publicTypes(kind: "leagues" | "sports" | "markets" | "event-statuses") { return this.get<string[]>(`/v3/public/types/${kind}`, {}, pub, false); }

  // ----- signed catalog -----
  markets(f: CatalogFilter = {}) { return this.get<Page<Market>>("/v3/catalog/markets", pick(f, ["league", "marketType", "eventStatus", "event", "startsAfter", "startsBefore", "limit", "after"]), read); }
  market(id: string) { return this.get<Market>(`/v3/catalog/markets/${id}`, {}, read); }
  events(f: CatalogFilter = {}) { return this.get<Page<Event>>("/v3/catalog/events", pick(f, ["league", "status", "startsAfter", "startsBefore", "limit", "after"]), read); }
  event(id: string) { return this.get<Event>(`/v3/catalog/events/${id}`, {}, read); }
  book(id: string, etag?: string) { return this.conditional<BookSnapshot>(`/v3/catalog/markets/${id}/book`, read, true, etag); }
  trades(id: string, limit?: number, after?: string) { return this.get<Page<Trade>>(`/v3/catalog/markets/${id}/trades`, { limit, after }, read); }

  // ----- keys -----
  echo(body: unknown = {}) { return this.send<unknown>("POST", "/v3/echo", {}, body, null); }
  async limits() { const t = await this.get<Throttle>("/v3/limits", {}, null); this.throttler.update(t); return t; }
  keys() { return this.get<Key[]>("/v3/keys", {}, account); }
  key(id: string) { return this.get<Key>(`/v3/keys/${id}`, {}, account); }
  createKey(b: CreateKey) { return this.send<KeyCreated>("POST", "/v3/keys", {}, b, account); }
  revokeKey(id: string) { return this.send<void>("DELETE", `/v3/keys/${id}`, {}, undefined, account); }

  // ----- subaccounts -----
  openSubaccount(b: OpenSubaccount) { return this.send<Subaccount>("POST", "/v3/account/subaccounts", {}, b, account); }
  subaccounts() { return this.get<Subaccount[]>("/v3/account/subaccounts", {}, account); }
  issueSubaccountKey(keyId: string, b: CreateSubaccountKey) { return this.send<KeyCreated>("POST", `/v3/account/subaccounts/${keyId}/keys`, {}, b, account); }
  balance(keyId: string) { return this.get<Balance>(`/v3/account/subaccounts/${keyId}/balance`, {}, account); }
  transfer(keyId: string, b: TransferRequest) { return this.send<Transfer>("POST", `/v3/account/subaccounts/${keyId}/transfer`, {}, b, account); }
  getTransfer(keyId: string, id: string) { return this.get<Transfer>(`/v3/account/subaccounts/${keyId}/transfers/${id}`, {}, account); }
  labelSubaccount(keyId: string, label: string) { return this.send<Subaccount>("PATCH", `/v3/account/subaccounts/${keyId}`, {}, { label }, account); }
  transactions(keyId: string, f: OrderFilter = {}) {
    return this.get<Page<Transaction>>(`/v3/account/subaccounts/${keyId}/transactions`, pick(f, ["kind", "startsAfter", "startsBefore", "limit", "after"]), { bucket: "history", tokens: 6 + Math.ceil((f.limit ?? 100) / 100) });
  }

  // ----- orders -----
  /** A 201 means queued, not resting: the private stream's `open` or `reject` confirms. */
  placeOrder(o: PlaceOrder) { return this.send<OrderAccepted>("POST", "/v3/orders", {}, o, { bucket: "place", tokens: 1 }); }
  /** Places any number of orders, split into batches that fit the edge's 8 KiB body cap. */
  async placeOrders(orders: PlaceOrder[]): Promise<BatchPlaceResult> {
    const accepted: OrderAccepted[] = [];
    for (const chunk of chunkByBytes(orders, (os) => JSON.stringify({ orders: os }))) {
      const r = await this.send<BatchPlaceResult>("POST", "/v3/orders/batch", {}, { orders: chunk }, { bucket: "place", tokens: chunk.length });
      accepted.push(...r.accepted);
    }
    return { accepted };
  }
  order(id: string) { return this.get<Order>(`/v3/orders/${id}`, {}, read); }
  orders(f: OrderFilter = {}) {
    const settled = f.status === "FILLED" || f.status === "CANCELED" || f.status === "REJECTED";
    return this.get<Page<Order>>("/v3/orders", pick(f, ["event", "market", "outcome", "status", "limit", "after"]), settled ? { bucket: "history", tokens: 4 + Math.ceil((f.limit ?? 100) / 100) } : read);
  }
  cancelOrder(id: string) { return this.send<CancelAccepted>("DELETE", `/v3/orders/${id}`, {}, undefined, { bucket: "cancel", tokens: 1 }); }
  /** 207 (partial) and 404 (none found) still carry `canceled`/`notCanceled`, so they resolve. */
  async cancelOrders(orderIds: string[]): Promise<BatchCancelResult> {
    const out: BatchCancelResult = { canceled: [], notCanceled: [] };
    for (const chunk of chunkByBytes(orderIds, (ids) => JSON.stringify({ orderIds: ids }))) {
      const r = await this.send<BatchCancelResult>("DELETE", "/v3/orders/batch", {}, { orderIds: chunk }, { bucket: "cancel", tokens: chunk.length }, [207, 404]);
      out.canceled.push(...r.canceled);
      out.notCanceled.push(...r.notCanceled);
    }
    return out;
  }
  cancelAll(f: Pick<OrderFilter, "event" | "market" | "outcome"> = {}) { return this.send<CancelAllResult>("DELETE", "/v3/orders", pick(f, ["event", "market", "outcome"]), undefined, { bucket: "cancel", tokens: 1 }); }
  restingOrders(etag?: string) { return this.conditional<OrdersSnapshot>("/v3/account/orders", account, true, etag); }
  positionsSnapshot(etag?: string) { return this.conditional<PositionsSnapshot>("/v3/account/positions", account, true, etag); }
  fills(f: OrderFilter = {}) { return this.get<Page<Fill>>("/v3/portfolio/fills", pick(f, ["event", "market", "outcome", "order", "startsAfter", "startsBefore", "limit", "after"]), { bucket: "history", tokens: 8 + Math.ceil((f.limit ?? 100) / 50) }); }
  positions(f: Pick<OrderFilter, "event" | "market" | "outcome"> = {}) { return this.get<Position[]>("/v3/portfolio/positions", pick(f, ["event", "market", "outcome"]), read); }

  /** Follows `next` cursors. */
  async *pages<T>(fetchPage: (after?: string) => Promise<Page<T>>, maxPages = 50): AsyncGenerator<T[]> {
    let after: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const p = await fetchPage(after);
      yield p.items;
      if (!p.next) return;
      after = p.next;
    }
  }

  // ----- transport -----
  private get<T>(path: string, query: Q, cost: Cost, signed = true) {
    return this.request<T>("GET", path, query, undefined, cost, signed).then((r) => r.body);
  }
  private send<T>(method: string, path: string, query: Q, body: unknown, cost: Cost, okStatuses: number[] = []) {
    return this.request<T>(method, path, query, body, cost, true, undefined, okStatuses).then((r) => r.body);
  }
  private async conditional<T>(path: string, cost: Cost, signed: boolean, etag?: string): Promise<Conditional<T>> {
    const r = await this.request<T>("GET", path, {}, undefined, cost, signed, etag);
    return r.status === 304 ? { notModified: true } : { notModified: false, value: r.body, etag: r.etag };
  }

  private async request<T>(method: string, path: string, query: Q, body: unknown, cost: Cost, signed: boolean, ifNoneMatch?: string, okStatuses: number[] = []): Promise<{ status: number; body: T; etag?: string }> {
    if (signed && !this.creds) throw new NovigError(0, "NO_CREDENTIALS", "this route needs a signed request, but the client has no key");
    const qs = buildQuery(query);
    const bytes = body === undefined ? undefined : utf8.encode(JSON.stringify(body));
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
    for (let attempt = 1; ; attempt++) {
      const waitedMs = await this.throttler.acquire(cost);
      const headers: Record<string, string> = { Accept: "application/json" };
      let stringToSign: string | undefined;
      if (signed) {
        const s = sign(this.creds!, { method, path, query: qs, body: bytes });
        Object.assign(headers, s.headers);
        stringToSign = s.stringToSign;
      }
      if (bytes || method === "POST" || method === "PATCH" || method === "PUT") headers["Content-Type"] = "application/json";
      if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
      const started = Date.now();
      const res = await this.f(url, { method, headers, body: bytes as BodyInit | undefined });
      const text = await res.text();
      const requestId = res.headers.get("x-request-id") ?? undefined;
      let parsed: unknown;
      try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
      const errBody = !res.ok && res.status !== 304 && parsed && typeof parsed === "object" && "code" in parsed ? (parsed as ErrorBody) : undefined;
      this.onRequest?.({ method, path, query: qs, status: res.status, ms: Date.now() - started, bucket: cost?.bucket, cost: cost?.tokens ?? 0, waitedMs, attempt, requestId, errorCode: errBody?.code, stringToSign, ts: Date.now() });

      if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after") ?? "1") || 1;
        if (cost) this.throttler.penalize(cost.bucket, retry * 1000);
        // A free route has no bucket to block, so wait here or the retry fires instantly.
        else await new Promise((r) => setTimeout(r, retry * 1000));
        if (attempt < this.maxAttempts) continue;
        throw new NovigError(429, "RATE_LIMIT_EXCEEDED", `still rate limited after ${attempt} attempts`, requestId, errBody);
      }
      if (res.ok || res.status === 304 || okStatuses.includes(res.status)) return { status: res.status, body: parsed as T, etag: res.headers.get("etag") ?? undefined };
      if (res.status === 403 && !errBody) throw new NovigError(403, "EDGE_REFUSED", "the edge refused the request (HTML 403): it never reached Novig. Usually a body over 8 KiB or the per-IP rate.", requestId, text.slice(0, 300));
      throw new NovigError(res.status, errBody?.code ?? `HTTP_${res.status}`, errBody?.message ?? text.slice(0, 300), requestId, errBody ?? text);
    }
  }
}

/** Greedily packs items so each serialized body stays under the edge limit. */
export function chunkByBytes<T>(items: T[], serialize: (chunk: T[]) => string, limit = EDGE_BODY_LIMIT - 256): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const it of items) {
    const next = [...cur, it];
    if (cur.length && utf8.encode(serialize(next)).length > limit) {
      out.push(cur);
      cur = [it];
    } else cur = next;
  }
  if (cur.length) out.push(cur);
  return out;
}
