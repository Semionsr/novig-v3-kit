/**
 * The order book the way novig.com draws it: one column per outcome listing the prices you can
 * BUY at (the complement of the other outcome's resting bids), as percents, with dollar depth
 * and grey bars growing out from the center. A "Resting bids" mode shows the raw ladders.
 */
import { useState } from "react";
import { notional, pct, usd } from "../lib/format.ts";

export interface SideLevels {
  name: string;
  /** Resting bids on this outcome, best first: price in thousandths, qty in contracts. */
  bids: Array<{ price: number; qty: number; orders: number }>;
}

export interface MyQuote {
  outcomeIndex: 0 | 1;
  price: number;
}

interface Cell {
  price: number;
  dollars: number;
  mine: boolean;
}

function buyLadder(other: SideLevels, mine: MyQuote[], otherIndex: 0 | 1, depth: number): Cell[] {
  // Buying this outcome at 1-P trades against the other outcome's bid at P.
  return other.bids.slice(0, depth).map((l) => ({
    price: 1000 - l.price,
    dollars: notional(1000 - l.price, l.qty),
    mine: mine.some((q) => q.outcomeIndex === otherIndex && q.price === l.price),
  }));
}

function bidLadder(side: SideLevels, mine: MyQuote[], index: 0 | 1, depth: number): Cell[] {
  return side.bids.slice(0, depth).map((l) => ({ price: l.price, dollars: notional(l.price, l.qty), mine: mine.some((q) => q.outcomeIndex === index && q.price === l.price) }));
}

export function OrderBook({ sides, depth = 5, mine = [], compact }: { sides: [SideLevels, SideLevels]; depth?: number; mine?: MyQuote[]; compact?: boolean }) {
  const [mode, setMode] = useState<"buy" | "bids">("buy");
  const left = mode === "buy" ? buyLadder(sides[1], mine, 1, depth) : bidLadder(sides[0], mine, 0, depth);
  const right = mode === "buy" ? buyLadder(sides[0], mine, 0, depth) : bidLadder(sides[1], mine, 1, depth);
  const max = Math.max(1, ...left.map((c) => c.dollars), ...right.map((c) => c.dollars));
  const rows = Math.max(left.length, right.length);
  const heaviest = Math.max(...left.map((c) => c.dollars), ...right.map((c) => c.dollars));

  return (
    <div>
      {!compact && (
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="title3" style={{ fontSize: 17 }}>Order Book</div>
          <div className="spacer" />
          <div className="seg">
            <button className={mode === "buy" ? "on" : ""} onClick={() => setMode("buy")}>Buy prices</button>
            <button className={mode === "bids" ? "on" : ""} onClick={() => setMode("bids")}>Resting bids</button>
          </div>
        </div>
      )}
      <div className="ob">
        <div className="ob-head">
          <div>{sides[0].name}</div>
          <div>{sides[1].name}</div>
        </div>
        {rows === 0 && <div className="ob-empty footnote">No resting orders yet.</div>}
        {Array.from({ length: rows }, (_, i) => {
          const l = left[i];
          const r = right[i];
          return (
            <div className="ob-row" key={i}>
              <div className="ob-cell left" style={l && l.dollars === heaviest ? { background: "var(--fill-raised)" } : undefined}>
                {l && <i className="bar" style={{ width: `${Math.max(3, (l.dollars / max) * 42)}%` }} />}
                {l ? (<><span className="pct">{pct(l.price)}</span><span className="row tight">{l.mine && <i className="mine" title="Your quote" />}<span className="amt">{usd(l.dollars)}</span></span></>) : <span />}
              </div>
              <div className="ob-cell right" style={r && r.dollars === heaviest ? { background: "var(--fill-raised)" } : undefined}>
                {r && <i className="bar" style={{ width: `${Math.max(3, (r.dollars / max) * 42)}%` }} />}
                {r ? (<><span className="row tight"><span className="amt">{usd(r.dollars)}</span>{r.mine && <i className="mine" title="Your quote" />}</span><span className="pct">{pct(r.price)}</span></>) : <span />}
              </div>
            </div>
          );
        })}
      </div>
      {mode === "buy" && !compact && <div className="caption fg2" style={{ marginTop: 8 }}>Each price is what a taker pays for that outcome. It trades against the other outcome's resting bid at 100% minus the price.</div>}
    </div>
  );
}

/** L3 view: every resting order at the best levels, in queue order. Only v3 exposes this. */
export function QueueView({ name, queue, mineOrder, depth = 4 }: { name: string; queue: ReadonlyArray<{ id: string; price: number; qty: number }>; mineOrder?: string; depth?: number }) {
  const levels: Array<{ price: number; orders: Array<{ id: string; qty: number }> }> = [];
  for (const o of queue) {
    const last = levels[levels.length - 1];
    if (last && last.price === o.price) last.orders.push(o);
    else if (levels.length < depth) levels.push({ price: o.price, orders: [o] });
    else break;
  }
  const max = Math.max(1, ...levels.map((l) => l.orders.reduce((a, o) => a + o.qty, 0)));
  return (
    <div className="queue">
      <div className="caption fg2" style={{ marginBottom: 4 }}>{name} bids, queue order</div>
      {levels.map((l) => {
        const total = l.orders.reduce((a, o) => a + o.qty, 0);
        return (
          <div className="qrow" key={l.price}>
            <span className="tab-s accent">{pct(l.price)}</span>
            <div className="qbar" style={{ width: `${Math.max(6, (total / max) * 100)}%` }}>
              {l.orders.map((o, i) => (<i key={o.id} className={o.id === mineOrder ? "me" : i === 0 ? "first" : ""} style={{ flex: o.qty }} title={`${o.qty.toLocaleString()} contracts`} />))}
            </div>
            <span className="tab-s fg2" style={{ textAlign: "right" }}>{l.orders.length} orders</span>
          </div>
        );
      })}
      {levels.length === 0 && <div className="caption fg3">Empty</div>}
    </div>
  );
}
