import type { SideLevels } from "../components/OrderBook.tsx";
import type { BookViewWire } from "./api.ts";
import { priceToMilli } from "./format.ts";

/** Server BookView → the two sides the OrderBook component draws. */
export function sidesFromView(v: BookViewWire, names: [string, string], order?: [string, string]): [SideLevels, SideLevels] {
  const pick = (id?: string, i = 0) => (id ? v.outcomes.find((o) => o.outcome_id === id) : v.outcomes[i]);
  const a = pick(order?.[0], 0);
  const b = pick(order?.[1], 1);
  const lv = (o?: BookViewWire["outcomes"][number]) => (o ? o.levels.map((l) => ({ price: priceToMilli(l.price), qty: l.qty, orders: l.orders })) : []);
  return [
    { name: names[0], bids: lv(a) },
    { name: names[1], bids: lv(b) },
  ];
}
