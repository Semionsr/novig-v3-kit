/**
 * v3 wire types (from Novig's OpenAPI 3.1 spec; the full generated set is in `openapi.d.ts`),
 * plus the price grid and fee math. Money stays in strings / integer thousandths: never a float.
 */
import type { components } from "./openapi.d.ts";

type S = components["schemas"];
export type Market = S["Market"];
export type Event = S["Event"];
export type Outcome = S["Outcome"];
export type MarketFee = S["MarketFee"];
export type RestingOrder = S["RestingOrder"];
export type BookSnapshot = S["Book"];
export type Trade = S["Trade"];
export type Key = S["Key"];
export type CreateKey = S["CreateKey"];
export type CreateSubaccountKey = S["CreateSubaccountKey"];
export type KeyCreated = S["KeyCreated"];
export type Subaccount = S["Subaccount"];
export type OpenSubaccount = S["OpenSubaccount"];
export type Balance = S["Balance"];
export type TransferRequest = S["TransferRequest"];
export type Transfer = S["Transfer"];
export type Transaction = S["Transaction"];
export type TimeInForce = S["TimeInForce"];
export type OrderStatus = S["OrderStatus"];
export type PlaceOrder = S["PlaceOrder"];
export type OrderAccepted = S["OrderAccepted"];
export type Order = S["Order"];
export type OpenOrder = S["OpenOrder"];
export type OrdersSnapshot = S["OrdersSnapshot"];
export type Position = S["Position"];
export type PositionsSnapshot = S["PositionsSnapshot"];
export type BatchPlaceResult = S["BatchPlaceResult"];
export type BatchCancelResult = S["BatchCancelResult"];
export type CancelAccepted = S["CancelAccepted"];
export type CancelAllResult = S["CancelAllResult"];
export type Fill = S["Fill"];
export type Throttle = S["Throttle"];
export type ErrorBody = S["ErrorBody"];
export interface Page<T> {
  items: T[];
  next?: string;
}

/** The published defaults (docs.novig.com/api/throttling), used until GET /v3/limits answers. */
export const DEFAULT_THROTTLE: Throttle = {
  place: { capacity: 256, refillPerSec: 8 },
  cancel: { capacity: 256, refillPerSec: 16 },
  read: { capacity: 64, refillPerSec: 16 },
  account: { capacity: 64, refillPerSec: 8 },
  stream: { capacity: 512, refillPerSec: 4 },
  history: { capacity: 512, refillPerSec: 4 },
  maxWatchedMarkets: 2048,
};

/** Edge limit: bodies over 8 KiB get an HTML 403 before reaching Novig. */
export const EDGE_BODY_LIMIT = 8192;

// ---------- price grid ----------

/** A price in thousandths: 665 is "0.665". */
export type Milli = number;

/** Rounds down onto the 279-price grid (every order buys, so down never overpays). */
export function snapDown(milli: Milli): Milli | null {
  milli = Math.floor(milli);
  if ((milli >= 1 && milli <= 50) || (milli >= 950 && milli <= 999)) return milli;
  if (milli >= 51 && milli <= 949) return milli - (milli % 5);
  return null;
}

export function snapUp(milli: Milli): Milli | null {
  milli = Math.ceil(milli);
  if ((milli >= 1 && milli <= 50) || (milli >= 950 && milli <= 999)) return milli;
  if (milli >= 51 && milli <= 949) {
    const up = Math.ceil(milli / 5) * 5;
    return up > 945 ? 950 : up;
  }
  return null;
}

export function onGrid(milli: Milli): boolean {
  return snapDown(milli) === milli;
}

export function grid(): Milli[] {
  const out: Milli[] = [];
  for (let m = 1; m <= 999; m++) if (onGrid(m)) out.push(m);
  return out;
}

export function tick(milli: Milli): number {
  return milli >= 55 && milli <= 945 ? 5 : 1;
}

export function parsePrice(s: string): Milli {
  const m = /^0\.(\d{1,3})$/.exec(s);
  if (!m) throw new Error(`price must look like 0.665: ${JSON.stringify(s)}`);
  return Number(m[1]!.padEnd(3, "0"));
}

export function formatPrice(milli: Milli): string {
  return `0.${String(milli).padStart(3, "0")}`;
}

export function complement(milli: Milli): Milli {
  return 1000 - milli;
}

// ---------- fees (docs.novig.com/api/concepts/fees) ----------

/** Exact decimal math on strings, in units of 1e-10 dollars, rounded half up to $0.00001. */
function toUnits(s: string, scale: number): bigint {
  const [i, f = ""] = s.split(".");
  return BigInt(i! + f.padEnd(scale, "0").slice(0, scale));
}
function roundHalfUp(n: bigint, drop: bigint): bigint {
  const q = n / drop;
  return n % drop * 2n >= drop ? q + 1n : q;
}
function fmtDollars(units5: bigint): string {
  const s = units5.toString().padStart(6, "0");
  return `${s.slice(0, -5)}.${s.slice(-5)}`;
}

/** Taker fee in dollars: c · P(1-P) · N · 1¢, rounded half up to $0.00001. */
export function takerFee(fee: Pick<MarketFee, "coefficient">, price: Milli, qty: number): string {
  const c = toUnits(fee.coefficient, 4); // 1e-4
  const raw = c * BigInt(price) * BigInt(1000 - price) * BigInt(qty); // 1e-4 · 1e-6 · cents
  // cents → dollars (/100): total scale 1e-12 dollars; round to 1e-5
  return fmtDollars(roundHalfUp(raw, 10n ** 7n));
}

export function makerCredit(fee: Pick<MarketFee, "coefficient" | "makerCredit">, price: Milli, qty: number): string {
  const taker = toUnits(takerFee(fee, price, qty), 5);
  const share = toUnits(fee.makerCredit, 4);
  return fmtDollars(roundHalfUp(taker * share, 10n ** 4n));
}

/** Cost in dollars of `qty` contracts at `price` (each pays 1¢). */
export function cost(price: Milli, qty: number): string {
  return fmtDollars(BigInt(price) * BigInt(qty));
}
