/** What this is and why, for whoever opens it first. */
import { Card } from "../components/ui.tsx";
import { IconBot, IconGauge, IconKey, IconMarkets, IconPulse } from "../components/icons.tsx";
import { IS_DEMO } from "../lib/api.ts";

const TOOLS = [
  { id: "markets", icon: IconMarkets, title: "Markets", body: "Production books and trades from /v3/public, read in the browser with the TypeScript SDK. Shows the L3 queue, fee schedule and price grid each market carries." },
  { id: "lab", icon: IconKey, title: "Signature Lab", body: "Builds NOVIG-V3 requests, runs your 30 official vectors live, and diagnoses a partner's rejected signature: it names the exact mistake (a + for a space, {} hashed as the empty body, raw r‖s on P-256, and so on)." },
  { id: "connection", icon: IconPulse, title: "Connection", body: IS_DEMO ? "The TypeScript SDK's websocket client against an in-page port of the mock exchange that drops frames on purpose: gap detection, per-subject snapshots, replay, and reconnects, all visible. Run locally, the Rust client does the same against Novig QA." : "The Rust websocket client against a mock exchange that drops frames on purpose, or against QA: gap detection, per-subject snapshots, replay, and reconnects, all visible." },
  { id: "throttle", icon: IconGauge, title: "Throttle", body: "The six per-key buckets modelled client-side so requests queue instead of 429ing, the stream bucket's subscribe weights, and every signed call with what it cost." },
  { id: "trading", icon: IconBot, title: "Trading", body: "A reference two-sided maker: post-only quotes around mid with inventory skew, stands down on GOLIVE, and books maker credits exactly per the fee formula. Paper fills are queue-aware." },
];

const FINDINGS = [
  {
    title: "The public book's ETag changes on every request",
    body: "Four GETs of the same unchanged book (seq 12) returned four different ETags. The prefix looks like a per-instance id, so behind the load balancer If-None-Match almost never returns 304. An ETag built from market id + seq would make conditional polling work.",
  },
  {
    title: "Browsers can't read Retry-After, X-Request-Id or ETag",
    body: "Responses send Access-Control-Allow-Origin: * but no Access-Control-Expose-Headers, so a web client can't honor Retry-After, can't read ETag, and can't quote a request id to support. Exposing those three fixes it.",
  },
  {
    title: "The `public` throttle is named but not defined",
    body: "Every /v3/public route lists a `public` throttle that the throttling page doesn't describe. Measured: about a 10-request burst refilling about 2/s per IP, shared across public routes. Both SDKs now model it.",
  },
  {
    title: "The API changelog is empty",
    body: "v3 replaced OAuth with NOVIG-V3 signing and moved the old API under /deprecated, but the changelog page has no entries yet. Partners migrating from NBX v1 would benefit from a dated list.",
  },
];

export function Overview({ go }: { go: (s: string) => void }) {
  return (
    <div className="stack fade-in" style={{ maxWidth: 1180 }}>
      <section className="card" style={{ padding: "36px 36px 32px" }}>
        <div className="caps accent" style={{ marginBottom: 14 }}>Novig API v3 · integration toolkit</div>
        <h2 className="headline-l" style={{ margin: 0, maxWidth: 860 }}>Everything a trading partner needs to get onto v3, working on day one.</h2>
        <p className="body-large fg2" style={{ maxWidth: 780, margin: "18px 0 26px" }}>
          v3 moved signing to NOVIG-V3, added subaccounts, an L3 book and a new websocket, and there's no client library in any language yet (the <span className="kbd">novig</span> crate is reserved but empty). This kit is that library, in Rust and TypeScript, plus the console you're looking at, built on it.
        </p>
        <div className="row">
          <button className="btn primary" onClick={() => go("markets")}>Open live markets</button>
          <button className="btn" onClick={() => go("lab")}>Try the Signature Lab</button>
          <button className="btn" onClick={() => go("connection")}>Watch a lossy feed heal</button>
        </div>
      </section>
      <div className="grid g3">
        <Card flat><div className="hero-m">30/30</div><div className="footnote fg2" style={{ marginTop: 6 }}>official NOVIG-V3 vectors pass in Rust, in TypeScript, and in this browser</div></Card>
        <Card flat><div className="hero-m">46</div><div className="footnote fg2" style={{ marginTop: 6 }}>v3 routes typed in both SDKs, from your OpenAPI 3.1 spec, with per-route throttle costs</div></Card>
        <Card flat><div className="hero-m">0</div><div className="footnote fg2" style={{ marginTop: 6 }}>Node APIs in the TypeScript SDK: it runs in Expo / React Native, where your app lives</div></Card>
      </div>
      <div className="grid g2">
        {TOOLS.map((t) => (
          <section key={t.id} className="card" style={{ cursor: "pointer" }} onClick={() => go(t.id)}>
            <div className="row" style={{ marginBottom: 10 }}><t.icon className="accent" /><div className="title3">{t.title}</div></div>
            <div className="footnote fg2">{t.body}</div>
          </section>
        ))}
        <section className="card flat">
          <div className="title3" style={{ marginBottom: 10 }}>Details the SDKs handle for you</div>
          <ul className="footnote fg2" style={{ margin: 0, paddingLeft: 18, lineHeight: "22px" }}>
            <li>Signs the exact path, query and body bytes it sends, and always sends Content-Type on bodies</li>
            <li>Splits order batches under the edge's 8 KiB cap (~90 orders), which otherwise fails as an HTML 403</li>
            <li>Money as strings and exact decimals, prices snapped to the 279-price grid</li>
            <li>If-None-Match on books and snapshots (ready for when the ETag is stable, see below); cursor paging</li>
            <li>A 201 is "queued": state comes from the private stream's open / fill / cancel / reject</li>
          </ul>
        </section>
      </div>
      <Card title="Things I noticed in v3" eyebrow="checked on 2026-09-28, repro commands in the README">
        <div className="grid g2" style={{ gap: 14 }}>
          {FINDINGS.map((f) => (
            <div key={f.title} className="finding">
              <h4>{f.title}</h4>
              <div className="footnote fg2">{f.body}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
