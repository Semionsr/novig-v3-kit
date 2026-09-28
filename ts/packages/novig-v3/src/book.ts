/**
 * L3 order book for one market. One ladder per outcome, best (highest) price first, time
 * priority within a price: the array order is the queue. A bid at 0.665 on one outcome is an
 * offer at 0.335 on the other. A partial fill is `remove` then `add`, which keeps queue position.
 */
import { complement, parsePrice, type Milli, type RestingOrder } from "./types.ts";

export type BookDelta =
  | { kind: "add"; order: string; outcome: string; price: string; qty: number }
  | { kind: "remove"; order: string; reason?: "fill" | "cancel" };

export interface Level {
  price: Milli;
  qty: number;
  orders: number;
}

export interface Quote {
  bid?: Level;
  offer?: Level;
}

interface Resting {
  id: string;
  price: Milli;
  qty: number;
}

export class Book {
  seq = 0;
  private ladders = new Map<string, Resting[]>();
  private index = new Map<string, string>();

  constructor(outcomes: string[] = []) {
    for (const o of outcomes) this.ladders.set(o, []);
  }

  /** Replaces everything with a snapshot. Accepts REST (`orderId`) and websocket (`order`) shapes. */
  load(seq: number, orders: Record<string, Array<RestingOrder | { order: string; price: string; qty: number }>>) {
    this.seq = seq;
    for (const l of this.ladders.values()) l.length = 0;
    this.index.clear();
    for (const [outcome, list] of Object.entries(orders)) {
      const ladder = this.ladders.get(outcome) ?? [];
      this.ladders.set(outcome, ladder);
      for (const o of list) {
        const id = "orderId" in o ? o.orderId : o.order;
        ladder.push({ id, price: parsePrice(o.price), qty: o.qty });
        this.index.set(id, outcome);
      }
      ladder.sort((a, b) => b.price - a.price); // stable: keeps time priority
    }
  }

  apply(seq: number, deltas: BookDelta[]) {
    const filledAt = new Map<string, number>();
    for (const d of deltas) {
      if (d.kind === "add") {
        const price = parsePrice(d.price);
        const ladder = this.ladders.get(d.outcome) ?? [];
        this.ladders.set(d.outcome, ladder);
        let pos = filledAt.get(d.order);
        filledAt.delete(d.order);
        if (pos === undefined || pos > ladder.length) {
          pos = 0;
          while (pos < ladder.length && ladder[pos]!.price >= price) pos++;
        }
        ladder.splice(pos, 0, { id: d.order, price, qty: d.qty });
        this.index.set(d.order, d.outcome);
      } else {
        const outcome = this.index.get(d.order);
        if (outcome === undefined) continue;
        this.index.delete(d.order);
        const ladder = this.ladders.get(outcome)!;
        const i = ladder.findIndex((o) => o.id === d.order);
        if (i >= 0) {
          ladder.splice(i, 1);
          if (d.reason === "fill") filledAt.set(d.order, i);
        }
      }
    }
    this.seq = seq;
  }

  outcomes(): string[] {
    return [...this.ladders.keys()];
  }

  queue(outcome: string): ReadonlyArray<Resting> {
    return this.ladders.get(outcome) ?? [];
  }

  levels(outcome: string, depth = 10): Level[] {
    const out: Level[] = [];
    for (const o of this.queue(outcome)) {
      const last = out[out.length - 1];
      if (last && last.price === o.price) {
        last.qty += o.qty;
        last.orders++;
      } else {
        if (out.length === depth) break;
        out.push({ price: o.price, qty: o.qty, orders: 1 });
      }
    }
    return out;
  }

  quote(outcome: string): Quote {
    const bid = this.levels(outcome, 1)[0];
    let offer: Level | undefined;
    for (const o of this.outcomes()) {
      if (o === outcome) continue;
      const best = this.levels(o, 1)[0];
      if (best && (!offer || complement(best.price) < offer.price)) offer = { ...best, price: complement(best.price) };
    }
    return { bid, offer };
  }

  get orderCount() {
    return this.index.size;
  }
}
