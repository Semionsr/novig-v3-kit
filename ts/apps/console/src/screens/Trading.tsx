/**
 * The reference maker, running. Paper mode rests virtual quotes in the real queue and fills them
 * only when the exchange's executions prove a taker reached them. Live mode (Novig QA) sends
 * post-only orders and trusts only the private stream. Plus a manual ticket for QA.
 */
import { snapDown, formatPrice } from "@semion/novig-v3";
import { useState } from "react";
import { OrderBook, type MyQuote } from "../components/OrderBook.tsx";
import { Card, Empty, ErrorLine, Notice, Stat } from "../components/ui.tsx";
import { IS_DEMO, api, type ServerStatus } from "../lib/api.ts";
import { sidesFromView } from "../lib/book.ts";
import { clock, int, pct, priceToMilli } from "../lib/format.ts";
import { usePoll, useStore } from "../lib/store.ts";

export function Trading({ status, go }: { status?: ServerStatus; go: (s: string) => void }) {
  const s = useStore();
  const bot = s.bot;
  const [err, setErr] = useState<unknown>();
  const [half, setHalf] = useState(1);
  const [size, setSize] = useState(500);
  const [maxPos, setMaxPos] = useState(5000);
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const connected = status?.stream;
  const act = async (f: () => Promise<unknown>) => { setErr(undefined); try { await f(); } catch (e) { setErr(e); } };

  const names: [string, string] = bot?.config.names ?? (connected?.target === "mock" ? ["Home", "Away"] : ["A", "B"]);
  const mine: MyQuote[] = (bot?.quotes ?? []).map((q) => ({ outcomeIndex: q.outcome === bot!.config.outcomes[0] ? 0 : 1, price: priceToMilli(q.price) }));
  const total = Number(bot?.pnl.total ?? 0);

  return (
    <div className="stack fade-in">
      {!connected && (
        <Card>
          <Empty title="Connect a market first">The bot trades whatever the websocket is watching. Open <a onClick={() => go("connection")} style={{ cursor: "pointer" }}>Connection</a> and connect the local mock exchange (no key) or a Novig QA market.</Empty>
        </Card>
      )}
      {connected && (
        <Card title="Reference maker" eyebrow={`novig-mm${IS_DEMO ? " (TypeScript port, in this page)" : ""} · ${connected.target === "mock" ? "mock exchange" : "Novig QA"}`} right={
          <div className="row">
            <div className="seg">
              <button className={mode === "paper" ? "on" : ""} onClick={() => setMode("paper")}>Paper</button>
              <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")} disabled={connected.target !== "qa"} title={connected.target !== "qa" ? "Live trades on Novig QA" : ""}>Live (QA)</button>
            </div>
            {bot?.running ? (
              <button className="btn danger" onClick={() => act(() => api.post("/api/bot/stop"))}>Stop & pull quotes</button>
            ) : (
              <button className="btn primary" onClick={() => act(() => api.post("/api/bot/start", { mode, halfSpreadTicks: half, size, maxPosition: maxPos }))}>Start</button>
            )}
          </div>
        }>
          <div className="grid g4" style={{ gap: 12 }}>
            <div className="field"><label>Half-spread (ticks from fair)</label><input className="input num" type="number" min={1} value={half} onChange={(e) => setHalf(Math.max(1, Number(e.target.value)))} /></div>
            <div className="field"><label>Size per quote (contracts)</label><input className="input num" type="number" min={1} value={size} onChange={(e) => setSize(Math.max(1, Number(e.target.value)))} /></div>
            <div className="field"><label>Max net position</label><input className="input num" type="number" min={1} value={maxPos} onChange={(e) => setMaxPos(Math.max(1, Number(e.target.value)))} /></div>
            <div className="field"><label>&nbsp;</label><button className="btn" disabled={!bot} onClick={() => act(() => api.post("/api/bot/config", { halfSpreadTicks: half, size, maxPosition: maxPos }))}>Apply to running bot</button></div>
          </div>
          <ErrorLine error={err} />
          {bot && (
            <>
              <div className="divider" />
              <div className="grid g4" style={{ gap: 10 }}>
                <Stat k="Status" v={bot.status} s={`${bot.mode} mode${bot.live ? " · market LIVE (fees on)" : " · pregame"}`} tone={bot.running ? "pos" : undefined} />
                <Stat k="Fair value" v={bot.fair ? pct(bot.fair) : "–"} s={bot.skewed_fair && bot.fair && Math.abs(bot.skewed_fair - bot.fair) > 0.01 ? `skewed to ${pct(bot.skewed_fair)} by inventory` : "mid, excluding our own orders"} />
                <Stat k="P&L (marked to fair)" v={`${total >= 0 ? "+" : "−"}$${Math.abs(total).toFixed(2)}`} s={`${bot.pnl.locked_pairs.toLocaleString()} pairs locked at 1¢`} tone={total >= 0 ? "pos" : "neg"} />
                <Stat k="Maker credits" v={`$${Number(bot.pnl.maker_credits).toFixed(4)}`} s={`${bot.config.fee.charged === "WHEN_LIVE" ? "earned only while live" : "earned on every fill"} · ${Math.round(Number(bot.config.fee.makerCredit) * 100)}% of taker fee`} tone="pos" />
                <Stat k="Fills" v={int(bot.counters.fills)} s={`${int(bot.counters.contracts_traded)} contracts`} />
                <Stat k="Quotes placed" v={int(bot.counters.placed)} s={`${int(bot.counters.requotes)} requotes · ${bot.counters.canceled} canceled`} />
                <Stat k="Rejected" v={int(bot.counters.rejected)} s="post-only that would cross" />
                <Stat k="GOLIVE events" v={int(bot.counters.golives)} s="each voids every resting order" tone={bot.counters.golives ? "caution" : undefined} />
              </div>
            </>
          )}
        </Card>
      )}

      {connected && bot && (
        <div className="grid g2" style={{ alignItems: "start" }}>
          <Card title="Book with our quotes" right={<span className="badge"><i className="mine" style={{ width: 6, height: 6, borderRadius: 3, background: "var(--data-yellow)", display: "inline-block" }} /> our quote</span>}>
            {s.book ? <OrderBook sides={sidesFromView(s.book, names, bot.config.outcomes)} depth={7} mine={mine} /> : <div className="footnote fg2">Waiting for the book…</div>}
          </Card>
          <Card title="Resting quotes">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Bid on</th><th className="num">Price</th><th className="num">Remaining</th><th className="num">Ahead in queue</th><th>Status</th></tr></thead>
                <tbody>
                  {bot.quotes.map((q) => (
                    <tr key={q.outcome}>
                      <td className="medium">{q.name} <span className="caption fg2">(= offer {bot.config.names[q.outcome === bot.config.outcomes[0] ? 1 : 0]} at {pct(1000 - priceToMilli(q.price))})</span></td>
                      <td className="num accent num">{pct(priceToMilli(q.price))}</td>
                      <td className="num num">{int(q.remaining)} / {int(q.qty)}</td>
                      <td className="num num">{bot.mode === "paper" ? int(q.ahead) : "–"}</td>
                      <td><span className={`badge ${q.status === "open" ? "pos" : "caution"}`}>{q.status}</span></td>
                    </tr>
                  ))}
                  {bot.quotes.length === 0 && <tr><td colSpan={5} className="fg2">No quotes resting ({bot.status}).</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid g2" style={{ gap: 10, marginTop: 14 }}>
              {bot.config.outcomes.map((o, i) => {
                const p = bot.positions[o];
                return <Stat key={o} k={`Position · ${bot.config.names[i]}`} v={int(p?.qty ?? 0)} s={`cost $${Number(p?.cost ?? 0).toFixed(2)}`} />;
              })}
            </div>
          </Card>
        </div>
      )}

      {connected && bot && (
        <div className="grid g2" style={{ alignItems: "start" }}>
          <Card title="Fills">
            <div className="table-wrap" style={{ maxHeight: 300 }}>
              <table className="table">
                <thead><tr><th>Time</th><th>Outcome</th><th className="num">Price</th><th className="num">Qty</th><th className="num">Credit</th><th>Why</th></tr></thead>
                <tbody>
                  {bot.fills.map((f, i) => (
                    <tr key={i} className={i === 0 ? "flash-up" : ""}>
                      <td className="num fg2">{clock(f.ts)}</td>
                      <td>{f.name}</td>
                      <td className="num accent num">{pct(priceToMilli(f.price))}</td>
                      <td className="num num">{int(f.qty)}</td>
                      <td className={`num num ${Number(f.maker_credit) > 0 ? "pos" : "fg2"}`}>${Number(f.maker_credit).toFixed(5)}</td>
                      <td className="caption fg2">{f.how}</td>
                    </tr>
                  ))}
                  {bot.fills.length === 0 && <tr><td colSpan={6} className="fg2">No fills yet. Paper fills need the queue ahead to clear first.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Bot log">
            <div className="log">
              {bot.log.map((l, i) => (<div key={i} className={l.level === "warn" ? "caution" : ""}><span className="t">{clock(l.ts)}</span>{l.text}</div>))}
            </div>
          </Card>
        </div>
      )}

      <ManualTicket status={status} />
    </div>
  );
}

function ManualTicket({ status }: { status?: ServerStatus }) {
  const [outcome, setOutcome] = useState("");
  const [price, setPrice] = useState("0.010");
  const [qty, setQty] = useState(100);
  const [tif, setTif] = useState("GTC");
  const [err, setErr] = useState<unknown>();
  const [last, setLast] = useState<unknown>();
  const resting = usePoll(() => (status?.trading ? api.get<{ seq: number; open: any[] }>("/api/signed/resting") : Promise.resolve(null)), 5000, [status?.trading?.keyId]);
  const act = async (f: () => Promise<unknown>) => { setErr(undefined); try { setLast(await f()); resting.reload(); } catch (e) { setErr(e); } };
  const milli = priceToMilli(price);
  const snapped = snapDown(milli);

  if (!status?.trading) {
    return (
      <Card title="Order ticket" eyebrow="Novig QA">
        <Notice>Placing real (test-money) orders needs a trading key on Novig QA. {IS_DEMO ? <>That part runs locally, so the key never leaves your machine: clone the kit, run <span className="kbd">make dev</span> and follow <b>Quickstart</b> (see the README).</> : <>Run <b>Quickstart</b>: it opens a subaccount, funds it, and saves its key locally.</>} Everything above works without one.</Notice>
      </Card>
    );
  }
  return (
    <Card title="Order ticket" eyebrow={`Novig QA · trading key ${status.trading.keyId}`}>
      <div className="grid g4" style={{ gap: 12 }}>
        <div className="field"><label>Outcome id</label><input className="input mono" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="uuid" /></div>
        <div className="field"><label>Price {snapped !== milli && snapped ? <span className="caution">→ {formatPrice(snapped)} on grid</span> : null}</label><input className="input num" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div className="field"><label>Contracts</label><input className="input num" type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
        <div className="field"><label>Time in force</label><select className="select" value={tif} onChange={(e) => setTif(e.target.value)}>{["GTC", "PO", "IOC", "FOK"].map((t) => <option key={t}>{t}</option>)}</select></div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={!outcome} onClick={() => act(() => api.post("/api/signed/orders", { outcomeId: outcome, price: snapped ? formatPrice(snapped) : price, qty, tif }))}>Place order</button>
        <button className="btn danger" onClick={() => act(() => api.post("/api/signed/cancel-all"))}>Cancel all</button>
        <span className="caption fg2">A 201 only means queued. The private stream's open (or reject) confirms.</span>
      </div>
      <ErrorLine error={err} />
      {last !== undefined && <pre className="code" style={{ marginTop: 12 }}>{JSON.stringify(last, null, 2)}</pre>}
      <div className="divider" />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Order</th><th>Outcome</th><th className="num">Price</th><th className="num">Qty</th><th>TIF</th><th /></tr></thead>
          <tbody>
            {(resting.data?.open ?? []).map((o: any) => (
              <tr key={o.orderId}>
                <td className="mono">{String(o.orderId).slice(0, 8)}…</td>
                <td className="mono fg2">{String(o.outcomeId).slice(0, 8)}…</td>
                <td className="num accent num">{pct(priceToMilli(o.price))}</td>
                <td className="num num">{int(o.qty)}</td>
                <td>{o.tif}</td>
                <td><button className="btn sm" onClick={() => act(() => api.del(`/api/signed/orders/${o.orderId}`))}>Cancel</button></td>
              </tr>
            ))}
            {!resting.data?.open?.length && <tr><td colSpan={6} className="fg2">No resting orders.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
