import { Book, type Market } from "@semion/novig-v3";
import { useEffect, useState } from "react";
import { IconBot, IconCode, IconGauge, IconKey, IconMarkets, IconPulse, IconRocket, IconSearch } from "./components/icons.tsx";
import { ScreenBoundary } from "./components/ScreenBoundary.tsx";
import { Connection, useStatus } from "./screens/Connection.tsx";
import { GetSdk } from "./screens/GetSdk.tsx";
import { Markets } from "./screens/Markets.tsx";
import { Overview } from "./screens/Overview.tsx";
import { Quickstart } from "./screens/Quickstart.tsx";
import { SignatureLab } from "./screens/SignatureLab.tsx";
import { Throttle } from "./screens/Throttle.tsx";
import { Trading } from "./screens/Trading.tsx";
import { leagueName, pctRound, when } from "./lib/format.ts";
import { publicClient } from "./lib/novig.ts";
import { startEvents, usePoll, useStore } from "./lib/store.ts";
import { IS_DEMO } from "./lib/api.ts";

type Screen = "sdk" | "overview" | "quickstart" | "markets" | "lab" | "connection" | "throttle" | "trading";

const GROUPS: Array<{ title: string; items: Array<{ id: Screen; label: string; icon: typeof IconRocket }> }> = [
  { title: "Start", items: [{ id: "sdk", label: "Use the SDK", icon: IconCode }, { id: "overview", label: "Overview", icon: IconRocket }, { id: "quickstart", label: "Quickstart", icon: IconKey }] },
  { title: "Market data", items: [{ id: "markets", label: "Markets", icon: IconMarkets }] },
  { title: "Authentication", items: [{ id: "lab", label: "Signature Lab", icon: IconKey }] },
  { title: "Streaming", items: [{ id: "connection", label: "Connection", icon: IconPulse }] },
  { title: "Troubleshooting", items: [{ id: "throttle", label: "Throttle", icon: IconGauge }] },
  { title: "Trading", items: [{ id: "trading", label: "Reference maker", icon: IconBot }] },
];

const PAGES: Record<Screen, { group: string; title: string; lead: string }> = {
  sdk: { group: "Start", title: "Use the SDK", lead: "Copy these into your terminal to go from a Novig key to placing and watching orders, in Rust or TypeScript." },
  overview: { group: "Start", title: "Overview", lead: "A client toolkit for the v3 API in Rust and TypeScript, and this console built on it." },
  quickstart: { group: "Start", title: "Quickstart", lead: "Go from a management key to a resting order in five calls, on QA." },
  markets: { group: "Market data", title: "Markets", lead: "Live production books and trades from /v3/public, read in this browser with the TypeScript SDK." },
  lab: { group: "Authentication", title: "Signature Lab", lead: "Build a NOVIG-V3 request, check it against your 30 vectors, and name the mistake in a rejected one." },
  connection: { group: "Streaming", title: "Connection", lead: IS_DEMO ? "One websocket for every channel: gaps detected, snapshots requested per subject, deltas replayed. Here, the TypeScript SDK against an in-page mock exchange." : "One websocket for every channel: gaps detected, snapshots requested per subject, deltas replayed." },
  throttle: { group: "Troubleshooting", title: "Throttle", lead: "The per-key buckets, modelled client-side so requests queue instead of drawing a 429." },
  trading: { group: "Trading", title: "Reference maker", lead: "Two-sided post-only quotes around mid, paper or live, with maker credits booked per the fee formula." },
};

function initialScreen(): Screen {
  const h = location.hash.replace("#", "") as Screen;
  return h in PAGES ? h : "sdk";
}

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [search, setSearch] = useState("");
  const status = useStatus();
  const store = useStore();
  useEffect(() => { startEvents(); }, []);
  useEffect(() => {
    const on = () => setScreen(initialScreen());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (s: string) => { location.hash = s; setScreen(s as Screen); };
  const st = status.data;
  const serverUp = !status.error;
  const page = PAGES[screen];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-row">
          <a className="wordmark" href="#sdk" onClick={() => go("sdk")}>
            <span className="mark">v3</span>
            <span className="word">CONSOLE</span>
            <span className="sub">unofficial</span>
          </a>
          <div className="topbar-center">
            <label className="search">
              <IconSearch />
              <input placeholder="Search events, teams & players" value={search} onChange={(e) => { setSearch(e.target.value); if (screen !== "markets") go("markets"); }} />
            </label>
            <button className="pill-btn" onClick={() => go("quickstart")}>
              <span className={`badge ${IS_DEMO ? "pos" : serverUp ? (st?.trading ? "pos" : "") : "neg"}`} style={{ height: 18, padding: "0 6px" }}><span className="pip" /></span>
              {IS_DEMO ? "Demo · in-browser mock" : !serverUp ? "Server offline" : st?.trading ? `QA · ${st.trading.keyId}` : st?.management ? "QA · management key" : "No key · public + mock"}
            </button>
          </div>
          <button className="btn primary" onClick={() => go("connection")}>Open stream</button>
        </div>
        <nav className="tabs">
          <button className={screen === "sdk" ? "on" : ""} onClick={() => go("sdk")}>SDK</button>
          <button className={screen !== "sdk" ? "on" : ""} onClick={() => go(screen === "sdk" ? "overview" : screen)}>Console</button>
          <a href="https://docs.novig.com/api/quickstart" target="_blank" rel="noreferrer">Guides</a>
          <a href="https://docs.novig.com/api-reference/changelog" target="_blank" rel="noreferrer">API Reference</a>
          <a href="https://docs.novig.com/api/signing#test-vectors" target="_blank" rel="noreferrer">Test vectors</a>
        </nav>
        <div className="banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <b>Unofficial toolkit</b>
          <span>Built against the v3 private preview by Semion Reznik. Not affiliated with Novig. {IS_DEMO ? "This hosted demo runs entirely in your browser: live public data from api.novig.com plus a simulated exchange." : "Keys never leave this machine."}</span>
        </div>
      </header>
      <aside className="sidebar">
        {GROUPS.map((g) => (
          <div className="nav-group" key={g.title}>
            <div className="nav-group-title">{g.title}</div>
            <nav className="nav">
              {g.items.map((n) => (
                <button key={n.id} className={screen === n.id ? "active" : ""} onClick={() => go(n.id)}>
                  <n.icon />
                  {n.label}
                  {n.id === "connection" && <span className={`dot ${st?.stream?.stats.connected ? "on" : ""}`} />}
                  {n.id === "trading" && store.bot?.running && <span className="dot on" />}
                </button>
              ))}
            </nav>
          </div>
        ))}
        <div className="side-foot">
          <span className="fg3">Rust <span className="kbd">novig-v3</span></span>
          <span className="fg3">TypeScript <span className="kbd">@semion/novig-v3</span></span>
        </div>
      </aside>
      <main className="main">
        <div className="content">
          <div className="page-head">
            <div className="page-eyebrow">{page.group}</div>
            <h1>{page.title}</h1>
            <p>{page.lead}</p>
          </div>
          <ScreenBoundary key={screen}>
            {screen === "sdk" && <GetSdk go={go} />}
            {screen === "overview" && <Overview go={go} />}
            {screen === "markets" && (<div className="stack"><Ticker onPick={() => {}} /><Markets search={search} /></div>)}
            {screen === "lab" && <SignatureLab />}
            {screen === "connection" && <Connection status={st} refresh={status.reload} />}
            {screen === "throttle" && <Throttle status={st} />}
            {screen === "trading" && <Trading status={st} go={go} />}
            {screen === "quickstart" && <Quickstart status={st} refresh={status.reload} />}
          </ScreenBoundary>
        </div>
      </main>
    </div>
  );
}

/** The soonest moneylines with buy prices (the strip across the top of novig.com). */
function Ticker({ onPick }: { onPick: () => void }) {
  const data = usePoll(async () => {
    const page = await publicClient.publicMarkets({ marketType: "MONEY", limit: 400 });
    const now = Date.now();
    const soon = page.items.filter((m) => m.outcomes.length === 2 && m.status === "OPEN" && m.startsTs > now - 3 * 3600_000).sort((a, b) => a.startsTs - b.startsTs).slice(0, 8);
    const events = await Promise.all(soon.map((m) => publicClient.publicEvent(m.eventId).catch(() => null)));
    return Promise.all(soon.map(async (m, i) => {
      const res = await publicClient.publicBook(m.marketId);
      let a: number | undefined, b: number | undefined;
      if (!res.notModified) {
        const bk = new Book(m.outcomes.map((o) => o.outcomeId));
        bk.load(res.value.seq, res.value.orders as never);
        a = bk.quote(m.outcomes[0]!.outcomeId).offer?.price;
        b = bk.quote(m.outcomes[1]!.outcomeId).offer?.price;
      }
      return { m, league: events[i]?.league ?? "", a, b } as { m: Market; league: string; a?: number; b?: number };
    }));
  }, 90_000);
  return (
    <div className="ticker">
      {(data.data ?? []).map(({ m, league, a, b }) => {
        const w = when(m.startsTs);
        return (
          <div key={m.marketId} className="tick" onClick={onPick}>
            <div className="tick-head">{leagueName(league)} · <b>{w.day}</b> <em>{w.time}</em></div>
            <div className="tick-row"><span>{m.outcomes[0]!.name}</span><span className="accent num">{a ? pctRound(a) : "–"}</span></div>
            <div className="tick-row"><span>{m.outcomes[1]!.name}</span><span className="accent num">{b ? pctRound(b) : "–"}</span></div>
          </div>
        );
      })}
      {!data.data && <div className="tick"><div className="tick-head">Loading live markets…</div></div>}
    </div>
  );
}
