import { Book, type Market } from "@semion/novig-v3";
import { useEffect, useState } from "react";
import { IconBot, IconCode, IconGauge, IconKey, IconMarkets, IconPulse, IconRocket, IconSearch } from "./components/icons.tsx";
import { ScreenBoundary } from "./components/ScreenBoundary.tsx";
import { Connection, useStatus } from "./screens/Connection.tsx";
import { GetSdk } from "./screens/GetSdk.tsx";
import { Markets } from "./screens/Markets.tsx";
import { Findings } from "./screens/Findings.tsx";
import { Quickstart } from "./screens/Quickstart.tsx";
import { SignatureLab } from "./screens/SignatureLab.tsx";
import { Throttle } from "./screens/Throttle.tsx";
import { Trading } from "./screens/Trading.tsx";
import { leagueName, pctRound, when } from "./lib/format.ts";
import { publicClient } from "./lib/novig.ts";
import { startEvents, usePoll, useStore } from "./lib/store.ts";
import { IS_DEMO } from "./lib/api.ts";

type Screen = "sdk" | "lab" | "connection" | "throttle" | "trading" | "findings" | "markets" | "quickstart";

// Ordered like the email: what I built, proof it works, what I noticed. Quickstart needs a key,
// so it only appears when the console runs locally.
const GROUPS: Array<{ title: string; items: Array<{ id: Screen; label: string; icon: typeof IconRocket }> }> = [
  { title: "What I built", items: [{ id: "sdk", label: "The SDK", icon: IconCode }] },
  { title: "Proof it works", items: [
    { id: "lab", label: "30/30 signing tests", icon: IconKey },
    { id: "connection", label: "Survives dropped data", icon: IconPulse },
    { id: "throttle", label: "Never hits rate limits", icon: IconGauge },
    { id: "trading", label: "Market maker", icon: IconBot },
  ] },
  { title: "What I noticed", items: [{ id: "findings", label: "4 findings", icon: IconSearch }] },
  { title: "Bonus", items: [{ id: "markets", label: "Live markets", icon: IconMarkets }] },
  ...(IS_DEMO ? [] : [{ title: "Local only", items: [{ id: "quickstart" as Screen, label: "Quickstart (your key)", icon: IconRocket }] }]),
];

const PAGES: Record<Screen, { group: string; title: string; lead: string }> = {
  sdk: { group: "What I built", title: "The SDK", lead: "Copy these into your terminal to go from a Novig key to placing and watching orders, in Rust or TypeScript." },
  lab: { group: "Proof it works", title: "30/30 signing tests", lead: "Every request to v3 must be signed exactly right. The SDK passes all 30 of Novig's official signing tests, checked live in this browser, and can name the mistake in a rejected signature." },
  connection: { group: "Proof it works", title: "Survives dropped data", lead: IS_DEMO ? "Watch the SDK recover when messages get lost. A practice exchange in this page drops messages on purpose; the SDK notices each gap and repairs its order book." : "Watch the SDK recover when messages get lost: against a practice exchange that drops messages on purpose, or against Novig QA." },
  throttle: { group: "Proof it works", title: "Never hits rate limits", lead: "Novig limits how fast each key can send requests. The SDK paces itself to those limits, so requests wait their turn instead of getting blocked with a 429." },
  trading: { group: "Proof it works", title: "Market maker", lead: "A reference bot built on the SDK: it quotes both sides around the fair price and books maker credits the way Novig's fee docs describe." },
  findings: { group: "What I noticed", title: "4 findings", lead: "Things I found in v3 while building the SDK, each with a way to reproduce it." },
  markets: { group: "Bonus", title: "Live markets", lead: "Novig's real production books and trades, read in this browser with the TypeScript SDK. No key needed." },
  quickstart: { group: "Local only", title: "Quickstart", lead: "Novig's five-call quickstart as buttons, against QA with your own key." },
};

function initialScreen(): Screen {
  const h = location.hash.replace("#", "") as Screen;
  if (h === "quickstart" && IS_DEMO) return "sdk";
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
            <button className="pill-btn" onClick={() => go(IS_DEMO ? "sdk" : "quickstart")}>
              <span className={`badge ${IS_DEMO ? "pos" : serverUp ? (st?.trading ? "pos" : "") : "neg"}`} style={{ height: 18, padding: "0 6px" }}><span className="pip" /></span>
              {IS_DEMO ? "Demo · in-browser mock" : !serverUp ? "Server offline" : st?.trading ? `QA · ${st.trading.keyId}` : st?.management ? "QA · management key" : "No key · public + mock"}
            </button>
          </div>
          <button className="btn primary" onClick={() => go("connection")}>Open stream</button>
        </div>
        <nav className="tabs">
          <button className={PAGES[screen].group === "What I built" ? "on" : ""} onClick={() => go("sdk")}>What I built</button>
          <button className={PAGES[screen].group === "Proof it works" ? "on" : ""} onClick={() => go("lab")}>Proof it works</button>
          <button className={PAGES[screen].group === "What I noticed" ? "on" : ""} onClick={() => go("findings")}>What I noticed</button>
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
            {screen === "sdk" && <GetSdk />}
            {screen === "findings" && <Findings />}
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
