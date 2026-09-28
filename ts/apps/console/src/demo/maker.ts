/**
 * The reference maker from `novig-mm`, ported to TypeScript for the hosted demo (paper mode only).
 *
 * Every Novig order buys, so a two-sided quote is a bid on each outcome. Fair value is the mid of
 * the book excluding our own orders, skewed against inventory; each outcome is bid `halfSpread`
 * ticks under fair, snapped down to the grid, never crossing. Paper quotes rest virtually in the
 * real queue and fill only when the exchange's executions prove a taker reached them. `GOLIVE`
 * voids everything, turns fees on and stands the bot down. Maker credits follow the fee formula.
 */
import { complement, cost as costOf, formatPrice, makerCredit, snapDown, tick as tickOf, type Book } from "@semion/novig-v3";
import type { BotStateWire } from "../lib/api.ts";

export interface Removal { order: string; outcome: string; price: number; resting_qty: number; executed: number; reason: "fill" | "cancel" }

export interface MakerConfig {
  marketId: string;
  outcomes: [string, string];
  names: [string, string];
  fee: { coefficient: string; makerCredit: string; charged: "ALWAYS" | "WHEN_LIVE" | "NEVER" };
  halfSpreadTicks: number;
  size: number;
  maxPosition: number;
  skewTicksAtMax: number;
  requoteTicks: number;
  minRequoteMs: number;
  goliveCooldownMs: number;
}

interface Quote {
  outcome: string;
  orderId: string;
  price: number;
  qty: number;
  remaining: number;
  ahead: number;
  placedTs: number;
  aheadOrders: Map<string, number>;
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

export class PaperMaker {
  private running = false;
  private live = false;
  private quotes = new Map<string, Quote>();
  private positions = new Map<string, { qty: number; cost: number }>();
  private credits = 0;
  private fair: number | null = null;
  private skewed: number | null = null;
  private cooldownUntil = 0;
  private lastRequote = 0;
  private counters = { placed: 0, canceled: 0, rejected: 0, fills: 0, requotes: 0, golives: 0, contracts_traded: 0 };
  private fills: BotStateWire["fills"] = [];
  private log: BotStateWire["log"] = [];
  private status = "stopped";

  constructor(private cfg: MakerConfig) {
    this.info(`ready: paper mode, ${cfg.names[0]} vs ${cfg.names[1]}`);
  }

  config() {
    return this.cfg;
  }

  setConfig(cfg: MakerConfig) {
    this.info(`config: ±${cfg.halfSpreadTicks} ticks, size ${cfg.size}, max ${cfg.maxPosition}`);
    this.cfg = cfg;
    this.lastRequote = 0;
  }

  start() {
    this.running = true;
    this.status = "quoting";
    this.info("started");
  }

  stop() {
    this.running = false;
    this.status = "stopped";
    this.info("stopped: pulling quotes");
    this.counters.canceled += this.quotes.size;
    this.quotes.clear();
  }

  onLifecycle(transitions: string[], now: number) {
    for (const t of transitions) {
      if (t === "GOLIVE") {
        this.counters.golives++;
        this.live = true;
        this.quotes.clear();
        this.cooldownUntil = now + this.cfg.goliveCooldownMs;
        this.warn(`GOLIVE: every resting order voided, taker fees on. Standing down ${this.cfg.goliveCooldownMs} ms.`);
      } else if (t === "UNLIVE") {
        this.live = false;
        this.quotes.clear();
        this.warn("UNLIVE: book drained, taker fees off");
      } else if (t === "CLOSE" || t === "GRADE") {
        this.quotes.clear();
        this.running = false;
        this.status = `market ${t.toLowerCase()}`;
        this.warn(`${t}: market no longer trades, bot stopped`);
      }
    }
  }

  /** After a resync, queue estimates can't be trusted: re-measure from the book. */
  onBookReset(book: Book) {
    const alive = new Set<string>();
    for (const o of book.outcomes()) for (const r of book.queue(o)) alive.add(r.id);
    for (const q of this.quotes.values()) {
      for (const id of [...q.aheadOrders.keys()]) if (!alive.has(id)) q.aheadOrders.delete(id);
      q.ahead = [...q.aheadOrders.values()].reduce((a, b) => a + b, 0);
    }
  }

  /** Queue-aware paper fills. */
  onRemovals(removals: Removal[], now: number) {
    const fills: Array<[string, number, number, string]> = [];
    for (const q of this.quotes.values()) {
      for (const r of removals.filter((x) => x.outcome === q.outcome)) {
        const ahead = q.aheadOrders.get(r.order);
        if (ahead !== undefined) {
          const gone = r.reason === "fill" ? r.executed : r.resting_qty;
          const left = ahead - Math.min(gone, ahead);
          if (r.reason === "cancel" || left === 0) q.aheadOrders.delete(r.order);
          else q.aheadOrders.set(r.order, left);
          q.ahead = [...q.aheadOrders.values()].reduce((a, b) => a + b, 0);
          continue;
        }
        if (r.reason !== "fill" || r.executed === 0 || r.price > q.price) continue;
        // A trade at our price behind us, or at a worse price: the taker went through us.
        const n = Math.min(q.remaining, r.executed);
        if (n > 0) {
          q.remaining -= n;
          q.aheadOrders.clear();
          q.ahead = 0;
          fills.push([q.outcome, q.price, n, r.price === q.price ? "queue reached at our price" : `trade at worse price ${formatPrice(r.price)}`]);
        }
      }
    }
    for (const [o, p, n, how] of fills) this.recordFill(o, p, n, now, how);
    for (const [o, q] of [...this.quotes]) if (q.remaining <= 0) this.quotes.delete(o);
  }

  onBook(book: Book, now: number) {
    this.updateFair(book);
    if (this.running) this.requote(book, now);
  }

  private recordFill(outcome: string, price: number, qty: number, now: number, how: string) {
    const charged = this.cfg.fee.charged === "ALWAYS" || (this.cfg.fee.charged === "WHEN_LIVE" && this.live);
    const credit = charged ? makerCredit(this.cfg.fee, price, qty) : "0.00000";
    this.credits = r5(this.credits + Number(credit));
    const p = this.positions.get(outcome) ?? { qty: 0, cost: 0 };
    p.qty += qty;
    p.cost = r5(p.cost + Number(costOf(price, qty)));
    this.positions.set(outcome, p);
    this.counters.fills++;
    this.counters.contracts_traded += qty;
    const name = this.name(outcome);
    this.fills = [{ ts: now, outcome, name, price: formatPrice(price), qty, maker_credit: credit, live: this.live, how }, ...this.fills].slice(0, 50);
    this.info(`filled ${qty} ${name} @ ${formatPrice(price)}${Number(credit) > 0 ? ` (+$${credit} maker credit)` : ""}`);
  }

  private name(o: string) {
    return o === this.cfg.outcomes[0] ? this.cfg.names[0] : this.cfg.names[1];
  }

  private bestBid(book: Book, outcome: string): number | undefined {
    return book.queue(outcome)[0]?.price;
  }

  private updateFair(book: Book) {
    const [a, b] = this.cfg.outcomes;
    const bidA = this.bestBid(book, a);
    const oppB = this.bestBid(book, b);
    const offerA = oppB === undefined ? undefined : complement(oppB);
    if (bidA !== undefined && offerA !== undefined) this.fair = offerA > bidA ? (bidA + offerA) / 2 : Math.min(bidA, offerA);
    else this.fair = null;
    const net = this.net();
    const skew = this.cfg.maxPosition > 0 ? Math.max(-1, Math.min(1, net / this.cfg.maxPosition)) * this.cfg.skewTicksAtMax * 5 : 0;
    // Long A: lower fair so we bid A less and B more.
    this.skewed = this.fair === null ? null : this.fair - skew;
  }

  private net() {
    return (this.positions.get(this.cfg.outcomes[0])?.qty ?? 0) - (this.positions.get(this.cfg.outcomes[1])?.qty ?? 0);
  }

  private requote(book: Book, now: number) {
    if (now < this.cooldownUntil) {
      this.status = "cooling down after GOLIVE";
      return;
    }
    const fair = this.skewed;
    if (fair === null) {
      this.status = "waiting for a two-sided book";
      return;
    }
    if (now - this.lastRequote < this.cfg.minRequoteMs) return;
    this.status = "quoting";
    const [a, b] = this.cfg.outcomes;
    const net = this.net();
    let changed = false;
    for (const [outcome, fairO] of [[a, fair], [b, 1000 - fair]] as Array<[string, number]>) {
      const t = fairO >= 55 && fairO <= 945 ? 5 : 1;
      let price = snapDown(Math.max(1, Math.floor(fairO - this.cfg.halfSpreadTicks * t)));
      if (price === null) continue;
      // Stay a maker: never at or through the best price we could buy at right now.
      const opp = this.bestBid(book, outcome === a ? b : a);
      if (opp !== undefined) {
        const offer = complement(opp);
        if (price >= offer) {
          price = snapDown(Math.max(0, offer - 1));
          if (price === null) continue;
        }
      }
      const exposure = outcome === a ? net : -net;
      const want = exposure < this.cfg.maxPosition;
      const cur = this.quotes.get(outcome);
      if (!want && cur) {
        this.quotes.delete(outcome);
        this.counters.canceled++;
        changed = true;
      } else if (want && cur && Math.abs(cur.price - price) >= this.cfg.requoteTicks * tickOf(price)) {
        this.quotes.delete(outcome);
        this.counters.canceled++;
        this.place(book, outcome, price, now);
        this.counters.requotes++;
        changed = true;
      } else if (want && !cur) {
        this.place(book, outcome, price, now);
        changed = true;
      }
    }
    if (changed) this.lastRequote = now;
  }

  private place(book: Book, outcome: string, price: number, now: number) {
    // Everything resting at our price now is ahead of us; later arrivals are behind.
    const aheadOrders = new Map<string, number>();
    for (const o of book.queue(outcome)) if (o.price === price) aheadOrders.set(o.id, o.qty);
    const ahead = [...aheadOrders.values()].reduce((x, y) => x + y, 0);
    this.quotes.set(outcome, { outcome, orderId: uuid(), price, qty: this.cfg.size, remaining: this.cfg.size, ahead, placedTs: now, aheadOrders });
    this.counters.placed++;
  }

  state(): BotStateWire {
    const [a, b] = this.cfg.outcomes;
    const pa = this.positions.get(a) ?? { qty: 0, cost: 0 };
    const pb = this.positions.get(b) ?? { qty: 0, cost: 0 };
    const cost = r5(pa.cost + pb.cost);
    const mark = this.fair === null ? 0 : r5((pa.qty * (this.fair / 1000) + pb.qty * (1 - this.fair / 1000)) / 100);
    const quotes = [...this.quotes.values()]
      .sort((x, y) => (x.outcome === a ? 0 : 1) - (y.outcome === a ? 0 : 1))
      .map((q) => ({ outcome: q.outcome, name: this.name(q.outcome), order_id: q.orderId, price: formatPrice(q.price), qty: q.qty, remaining: q.remaining, status: "open", ahead: q.ahead, placed_ts: q.placedTs }));
    return {
      running: this.running,
      mode: "paper",
      status: this.status,
      live: this.live,
      fair: this.fair,
      skewed_fair: this.skewed,
      config: { market_id: this.cfg.marketId, outcomes: this.cfg.outcomes, names: this.cfg.names, half_spread_ticks: this.cfg.halfSpreadTicks, size: this.cfg.size, max_position: this.cfg.maxPosition, fee: this.cfg.fee },
      quotes,
      positions: { [a]: { qty: pa.qty, cost: pa.cost.toFixed(5) }, [b]: { qty: pb.qty, cost: pb.cost.toFixed(5) } },
      pnl: { cost: cost.toFixed(5), mark_value: mark.toFixed(5), maker_credits: this.credits.toFixed(5), locked_pairs: Math.min(pa.qty, pb.qty), total: r5(mark - cost + this.credits).toFixed(5) },
      counters: { ...this.counters },
      fills: this.fills,
      log: this.log,
    };
  }

  private info(text: string) {
    this.log = [{ ts: Date.now(), level: "info", text }, ...this.log].slice(0, 100);
  }
  private warn(text: string) {
    this.log = [{ ts: Date.now(), level: "warn", text }, ...this.log].slice(0, 100);
  }
}
