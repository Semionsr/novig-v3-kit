/**
 * Live production markets, read straight from api.novig.com/v3/public with the TypeScript SDK
 * (no key, no server). Layout follows novig.com's event card; the extras are what v3 newly
 * exposes: the full L3 queue, per-market fee schedule, and the price grid.
 */
import { Book, type Market, type Event, takerFee, makerCredit, snapDown, formatPrice, tick } from "@semion/novig-v3";
import { useEffect, useMemo, useState } from "react";
import { OrderBook, QueueView, type SideLevels } from "../components/OrderBook.tsx";
import { ChartLegend, PriceChart, type Point } from "../components/PriceChart.tsx";
import { IconArrow, IconChevron } from "../components/icons.tsx";
import { Card, Empty, ErrorLine, Notice, Stat } from "../components/ui.tsx";
import { leagueName, pct, pctRound, payoutOf100, usd, when, clock, int } from "../lib/format.ts";
import { publicClient, useBrowserRequests } from "../lib/novig.ts";
import { usePoll } from "../lib/store.ts";

const PREFERRED = ["NFL", "MLB", "NCAAF", "WNBA", "NHL", "NBA", "UFC", "ATP", "WTA", "EPL", "MLS"];

interface Loaded {
  events: Event[];
  markets: Market[];
}

async function loadLeague(league: string): Promise<Loaded> {
  // Ask for the headline market types directly: a league can have thousands of props, and a
  // plain listing pages through them in id order.
  const [ev, money] = await Promise.all([
    publicClient.publicEvents({ league, limit: 200 }),
    publicClient.publicMarkets({ league, marketType: "MONEY", limit: 500 }),
  ]);
  let markets = money.items;
  if (markets.length === 0) markets = (await publicClient.publicMarkets({ league, marketType: "SPREAD", limit: 500 })).items;
  if (markets.length === 0) markets = (await publicClient.publicMarkets({ league, limit: 500 })).items;
  return { events: ev.items, markets };
}

/** The headline market of an event: the moneyline if it has one, else any two-outcome market. */
function headline(markets: Market[], eventId: string): Market | undefined {
  const mine = markets.filter((m) => m.eventId === eventId && m.outcomes.length === 2 && m.status === "OPEN");
  return mine.find((m) => m.marketType === "MONEY") ?? mine.find((m) => m.marketType === "SPREAD") ?? mine[0];
}

function sidesOf(book: Book | undefined, m: Market): [SideLevels, SideLevels] {
  const [a, b] = m.outcomes;
  const lv = (o: string) => (book ? book.levels(o, 8).map((l) => ({ price: l.price, qty: l.qty, orders: l.orders })) : []);
  return [
    { name: a!.name, bids: lv(a!.outcomeId) },
    { name: b!.name, bids: lv(b!.outcomeId) },
  ];
}

export function Markets({ search }: { search: string }) {
  const leagues = usePoll(() => publicClient.publicTypes("leagues"), 0);
  const [league, setLeague] = useState("NFL");
  const data = usePoll(() => loadLeague(league), 60_000, [league]);
  const [idx, setIdx] = useState(0);

  const featured = useMemo(() => {
    if (!data.data) return [];
    const { events, markets } = data.data;
    const q = search.trim().toLowerCase();
    return events
      .filter((e) => e.status === "OPEN_PREGAME" || e.status === "OPEN_INGAME")
      .filter((e) => !q || e.description.toLowerCase().includes(q))
      .map((e) => ({ event: e, market: headline(markets, e.eventId) }))
      .filter((x): x is { event: Event; market: Market } => !!x.market)
      .sort((x, y) => x.event.startsTs - y.event.startsTs);
  }, [data.data, search]);

  useEffect(() => setIdx(0), [league, search]);
  const current = featured[Math.min(idx, Math.max(0, featured.length - 1))];
  const shown = PREFERRED.filter((l) => leagues.data?.includes(l));

  return (
    <div className="stack fade-in">
      <div className="row">
        <div className="chips">
          {shown.map((l) => (
            <button key={l} className={`chip ${l === league ? "active" : ""}`} onClick={() => setLeague(l)}>{leagueName(l)}</button>
          ))}
        </div>
        <div className="spacer" />
        <span className="badge"><span className="pip pos" style={{ color: "var(--positive-default)" }} /> api.novig.com · public v3 · no key</span>
      </div>
      <ErrorLine error={data.error} />
      {!data.data && !data.error && <Card><Empty title="Loading markets…">Reading /v3/public/catalog with the TypeScript SDK.</Empty></Card>}
      {data.data && featured.length === 0 && <Card><Empty title={`No open ${leagueName(league)} markets right now`}>Try another league.</Empty></Card>}
      {current && (
        <div className="grid g-main">
          <EventCard key={current.market.marketId} event={current.event} market={current.market} index={idx} total={featured.length} onMove={(d) => setIdx((i) => (i + d + featured.length) % featured.length)} />
          <MarketSide market={current.market} />
        </div>
      )}
      {featured.length > 1 && <Board rows={featured.slice(0, 10)} onPick={(i) => setIdx(i)} active={idx} />}
      <BrowserLog />
    </div>
  );
}

function EventCard({ event, market, index, total, onMove }: { event: Event; market: Market; index: number; total: number; onMove: (d: number) => void }) {
  const [book, setBook] = useState<Book>();
  const [err, setErr] = useState<unknown>();
  const [points, setPoints] = useState<Point[]>([]);
  const [a, b] = market.outcomes;

  useEffect(() => {
    let alive = true;
    let tag: string | undefined;
    const pull = async () => {
      try {
        const r = await publicClient.publicBook(market.marketId, tag);
        if (!alive || r.notModified) return;
        const bk = new Book(market.outcomes.map((o) => o.outcomeId));
        bk.load(r.value.seq, r.value.orders as never);
        tag = r.etag;
        setBook(bk);
        setErr(undefined);
      } catch (e) {
        if (alive) setErr(e);
      }
    };
    const trades = async () => {
      try {
        const page = await publicClient.publicTrades(market.marketId, 500);
        if (!alive) return;
        const pts = page.items
          .map((t) => ({ ts: t.ts, milli: t.outcomeId === a!.outcomeId ? Math.round(Number(t.price) * 1000) : 1000 - Math.round(Number(t.price) * 1000) }))
          .sort((x, y) => x.ts - y.ts);
        setPoints(pts);
      } catch {
        /* chart is optional */
      }
    };
    pull();
    trades();
    const t1 = setInterval(pull, 5000);
    const t2 = setInterval(trades, 15000);
    return () => { alive = false; clearInterval(t1); clearInterval(t2); };
  }, [market.marketId]);

  const qa = book?.quote(a!.outcomeId);
  const qb = book?.quote(b!.outcomeId);
  const buyA = qa?.offer?.price;
  const buyB = qb?.offer?.price;
  const lastA = points.length ? points[points.length - 1]!.milli : buyA ?? null;
  const w = when(event.startsTs);
  const names = splitNames(event.description, a!.name, b!.name);
  const depth = book ? book.outcomes().reduce((s, o) => s + book.levels(o, 50).reduce((x, l) => x + (l.price * l.qty) / 100000, 0), 0) : 0;

  return (
    <section className="card" style={{ padding: 24 }}>
      <div className="grid g2" style={{ gap: 32 }}>
        <div>
          <div className="eyebrow">{leagueName(event.league)} · {market.marketType.replace(/_/g, " ").toLowerCase()}{market.strike && market.strike !== "0" ? ` ${market.strike}` : ""}</div>
          <h2 className="title1" style={{ margin: "0 0 20px" }}>{names[0]} <span className="fg2">at</span> {names[1]}</h2>
          <div className="grid g2" style={{ gap: 12 }}>
            {[{ o: a!, p: buyA }, { o: b!, p: buyB }].map(({ o, p }) => (
              <div key={o.outcomeId}>
                <div className="pick">{o.name} <b>{p ? pctRound(p) : "–"}</b></div>
                <div className="payout">$100<IconArrow />{p ? `$${payoutOf100(p)}` : "–"}</div>
              </div>
            ))}
          </div>
          <div className="divider" />
          {book ? <OrderBook sides={sidesOf(book, market)} /> : <Empty title="Loading book…" />}
          <ErrorLine error={err} />
          <div className="row" style={{ marginTop: 18 }}>
            <span className="chip static">{usd(depth, { compact: true })} resting</span>
            <span className="chip static">{book?.orderCount ?? 0} orders · seq {book?.seq ?? "–"}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="title3">{a!.name}</div>
            <div style={{ textAlign: "center" }}>
              <div className="accent medium">{w.time}</div>
              <div className="title3">{w.day}</div>
              <div className="caps fg3" style={{ marginTop: 18 }}>{event.status.replace("_", " ")}</div>
            </div>
            <div className="title3">{b!.name}</div>
          </div>
          <div className="row" style={{ marginTop: 24, justifyContent: "flex-end" }}>
            <ChartLegend names={[a!.name, b!.name]} a={lastA} />
          </div>
          <PriceChart points={points} />
          <div className="row" style={{ marginTop: "auto", paddingTop: 12 }}>
            <span className="caption fg2">{points.length} recent trades</span>
            <div className="spacer" />
            <span className="footnote fg2">{index + 1} of {total}</span>
            <button className="btn icon" onClick={() => onMove(-1)} aria-label="Previous"><IconChevron dir="left" /></button>
            <button className="btn icon" onClick={() => onMove(1)} aria-label="Next"><IconChevron /></button>
          </div>
        </div>
      </div>
      {book && (
        <>
          <div className="divider" />
          <div className="grid g2" style={{ gap: 32 }}>
            <QueueView name={a!.name} queue={book.queue(a!.outcomeId)} />
            <QueueView name={b!.name} queue={book.queue(b!.outcomeId)} />
          </div>
          <div className="caption fg2" style={{ marginTop: 10 }}>Each block is one resting order. v3's book is order-level (L3), so a maker can see exactly how many contracts sit ahead of it.</div>
        </>
      )}
    </section>
  );
}

function splitNames(desc: string, a: string, b: string): [string, string] {
  const m = /^(.*?)\s+@\s+(.*)$/.exec(desc);
  return m ? [m[1]!, m[2]!] : [a, b];
}

function MarketSide({ market }: { market: Market }) {
  const [price, setPrice] = useState("0.500");
  const [qty, setQty] = useState(10000);
  const milli = Math.round(Number(price) * 1000) || 0;
  const snapped = snapDown(milli);
  const onGrid = snapped === milli;
  const game = market.fee.charged === "WHEN_LIVE";
  return (
    <div className="stack">
      <Card title="Market" eyebrow={market.marketId}>
        <div className="grid g2" style={{ gap: 10 }}>
          <Stat k="Type" v={market.marketType.replace(/_/g, " ")} s={market.strike && market.strike !== "0" ? `strike ${market.strike}` : "no strike"} />
          <Stat k="Status" v={market.status} s={`voids at ${market.voids === "FMV" ? "fair value" : "stake (push)"}`} />
          <Stat k="Fee schedule" v={`c = ${market.fee.coefficient}`} s={game ? "Game: taker pays only while live" : "Futures: charged always"} />
          <Stat k="Maker credit" v={`${Math.round(Number(market.fee.makerCredit) * 100)}%`} s="of the taker's fee on each fill" tone="pos" />
        </div>
      </Card>
      <Card title="Fee & grid calculator">
        <div className="grid g2" style={{ gap: 12 }}>
          <div className="field"><label>Price</label><input className="input num" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div className="field"><label>Contracts</label><input className="input num" type="number" value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value)))} /></div>
        </div>
        <div style={{ marginTop: 14 }} className="stack">
          {!onGrid && milli > 0 && milli < 1000 && (
            <Notice warn>{price} is off Novig's 279-price grid and would be rejected with <span className="kbd">INVALID_PRICE</span>. Snapped down: <b>{snapped ? formatPrice(snapped) : "–"}</b> (tick {snapped ? tick(snapped) / 1000 : "–"}).</Notice>
          )}
          {snapped !== null && milli > 0 && (
            <div className="grid g3" style={{ gap: 10 }}>
              <Stat k="Cost" v={`$${((snapped * qty) / 100000).toFixed(2)}`} s={`pays $${(qty / 100).toFixed(2)}`} />
              <Stat k="Taker fee" v={`$${Number(takerFee(market.fee, snapped, qty)).toFixed(4)}`} s={game ? "only while live" : "every fill"} tone="neg" />
              <Stat k="Maker credit" v={`$${Number(makerCredit(market.fee, snapped, qty)).toFixed(4)}`} s="to the resting side" tone="pos" />
            </div>
          )}
          <div className="caption fg2">Fee = c · P(1−P) · N · 1¢, rounded half up to $0.00001, computed with exact integer math (the SDK never uses floats for money).</div>
        </div>
      </Card>
    </div>
  );
}

function Board({ rows, onPick, active }: { rows: Array<{ event: Event; market: Market }>; onPick: (i: number) => void; active: number }) {
  const books = usePoll(async () => {
    const out: Record<string, Book> = {};
    // The SDK's public bucket paces these (Novig allows ~10 burst, ~2/s per IP).
    await Promise.all(rows.map(async (r) => {
      const res = await publicClient.publicBook(r.market.marketId);
      if (!res.notModified) {
        const b = new Book(r.market.outcomes.map((o) => o.outcomeId));
        b.load(res.value.seq, res.value.orders as never);
        out[r.market.marketId] = b;
      }
    }));
    return out;
  }, 30_000, [rows.map((r) => r.market.marketId).join()]);

  return (
    <Card title="The Board" right={<span className="caption fg2">buy prices from live books · refreshes every 30s</span>}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Event</th><th>Starts</th><th className="num">Buy</th><th className="num">Buy</th><th className="num">Spread</th><th className="num">Orders</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const bk = books.data?.[r.market.marketId];
              const [a, b] = r.market.outcomes;
              const pa = bk?.quote(a!.outcomeId).offer?.price;
              const pb = bk?.quote(b!.outcomeId).offer?.price;
              const w = when(r.event.startsTs);
              return (
                <tr key={r.market.marketId} onClick={() => onPick(i)} style={{ cursor: "pointer", background: i === active ? "var(--fill-default)" : undefined }}>
                  <td className="medium">{r.event.description}</td>
                  <td className="fg2">{w.day} <span className="accent">{w.time}</span></td>
                  <td className="num">{a!.name} <span className="accent num">{pa ? pct(pa) : "–"}</span></td>
                  <td className="num">{b!.name} <span className="accent num">{pb ? pct(pb) : "–"}</span></td>
                  <td className="num num fg2">{pa && pb ? `${((pa + pb - 1000) / 10).toFixed(1)}pt` : "–"}</td>
                  <td className="num num fg2">{bk ? int(bk.orderCount) : "…"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function BrowserLog() {
  const log = useBrowserRequests();
  return (
    <Card title="Requests from this browser" right={<span className="caption fg2">TypeScript SDK · fetch · CORS</span>}>
      <div className="table-wrap" style={{ maxHeight: 260 }}>
        <table className="table">
          <thead><tr><th>Time</th><th>Request</th><th className="num">Status</th><th className="num">ms</th></tr></thead>
          <tbody>
            {log.slice(0, 40).map((r, i) => (
              <tr key={i}>
                <td className="num fg2">{clock(r.ts)}</td>
                <td className="mono">{r.method} {r.path}{r.query ? `?${r.query}` : ""}</td>
                <td className={`num ${r.status === 304 ? "fg2" : r.status >= 400 ? "neg" : "pos"}`}>{r.status}</td>
                <td className="num fg2">{r.ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
