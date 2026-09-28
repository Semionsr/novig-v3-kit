/**
 * The six per-key token buckets, modelled client-side so requests queue instead of 429ing.
 * With a key: the server's live model of your real buckets, plus a burst button. Without one:
 * the same TypeScript Throttler, simulated in the page, so you can see the pacing math.
 */
import { DEFAULT_THROTTLE, PUBLIC_LIMIT, Throttler, type Bucket } from "@semion/novig-v3";
import { useEffect, useRef, useState } from "react";
import { Meters } from "../components/Meters.tsx";
import { Card, ErrorLine, Notice } from "../components/ui.tsx";
import { IS_DEMO, api, type ServerStatus } from "../lib/api.ts";
import { clock } from "../lib/format.ts";
import { useStore } from "../lib/store.ts";
import { publicClient } from "../lib/novig.ts";

export function Throttle({ status }: { status?: ServerStatus }) {
  const s = useStore();
  const hasKey = !!(status?.trading || status?.management);
  const [err, setErr] = useState<unknown>();
  const signed = s.stats?.signed ?? [];
  const stream = s.stats?.stream ?? [];
  const toMeter = (b: (typeof signed)[number]) => ({ bucket: b.bucket, capacity: b.capacity, refillPerSec: b.refill_per_sec, tokens: b.tokens, spent: b.spent_total, waitedMs: b.waited_ms_total, rejections: b.rejections_429, blockedMs: b.blocked_ms });

  return (
    <div className="stack fade-in">
      <Notice>
        Novig throttles <b>per key</b> with six token buckets (burst capacity, refill per second) and <b>per IP</b> at the edge. The docs ask clients to model the buckets and queue while short. Both SDKs do: a request waits for tokens instead of being sent into a <span className="kbd">429</span>, and a <span className="kbd">429</span> that still happens empties the bucket and honors <span className="kbd">Retry-After</span>.
      </Notice>
      <div className="grid g2" style={{ alignItems: "start" }}>
        <Card title="Your key's buckets" eyebrow={IS_DEMO ? "published defaults" : "live model in the Rust client"} right={hasKey ? <button className="btn sm" onClick={() => api.post("/api/throttle/burst", { n: 120 }).catch(setErr)}>Burst 120 reads</button> : <span className="badge">needs a key</span>}>
          {signed.length ? <Meters buckets={signed.map(toMeter)} /> : <Meters buckets={Object.entries(DEFAULT_THROTTLE).filter(([k]) => k !== "maxWatchedMarkets").map(([k, v]) => ({ bucket: k, capacity: (v as any).capacity, refillPerSec: (v as any).refillPerSec, tokens: (v as any).capacity }))} />}
          <ErrorLine error={err} />
          {!hasKey && <div className="caption fg2" style={{ marginTop: 10 }}>Showing the published defaults. With a key, <span className="kbd">GET /v3/limits</span> (free) replaces them with your schedule.</div>}
        </Card>
        <Card title="Websocket stream bucket" eyebrow="subscribe / snapshot weights">
          {stream.length ? <Meters buckets={stream.filter((b) => b.bucket === "stream").map(toMeter)} /> : <div className="footnote fg2">Connect the websocket to see the stream bucket move.</div>}
          <div className="caption fg2" style={{ marginTop: 10 }}>The upgrade costs 32. Each subscribed pair costs its weight: book 16, bbo 8, trades 4, lifecycle 1. A request above capacity passes only when the bucket is full, and empties it.</div>
        </Card>
      </div>
      <BrowserPublic />
      <Simulator />
      <RequestLog />
    </div>
  );
}

/** This tab's own public-route bucket, from the TypeScript SDK the Markets screen uses. */
function BrowserPublic() {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 400); return () => clearInterval(t); }, []);
  const b = publicClient.throttler.snapshot().find((x) => x.bucket === "public")!;
  return (
    <Card title="This browser's public bucket" eyebrow="per IP · measured, not documented">
      <Meters buckets={[{ bucket: "public", capacity: b.capacity, refillPerSec: b.refillPerSec, tokens: b.tokens, spent: b.spentTotal, waitedMs: b.waitedMsTotal, rejections: b.rejections429, blockedMs: b.blockedMs }]} />
      <div className="caption fg2" style={{ marginTop: 10 }}>Every <span className="kbd">/v3/public</span> route names a <span className="kbd">public</span> throttle that the throttling page doesn't define. Measured on 2026-09-28: a burst of about 10, refilling about 2/s, shared across public routes, answered with <span className="kbd">429 · Retry-After: 1</span>. The SDK models it so the Markets screen queues instead of tripping it.</div>
    </Card>
  );
}

function Simulator() {
  const [bucket, setBucket] = useState<Bucket>("place");
  const [n, setN] = useState(400);
  const [series, setSeries] = useState<Array<{ t: number; tokens: number; sent: number }>>([]);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);

  const run = async () => {
    stop.current = false;
    setRunning(true);
    const th = new Throttler();
    const t0 = Date.now();
    let sent = 0;
    const out: Array<{ t: number; tokens: number; sent: number }> = [];
    const sample = () => {
      const v = th.snapshot().find((b) => b.bucket === bucket)!;
      out.push({ t: (Date.now() - t0) / 1000, tokens: v.tokens, sent });
      setSeries([...out]);
    };
    const iv = setInterval(sample, 100);
    for (let i = 0; i < n && !stop.current; i++) {
      await th.acquire({ bucket, tokens: 1 });
      sent++;
    }
    sample();
    clearInterval(iv);
    setRunning(false);
  };
  useEffect(() => () => { stop.current = true; }, []);

  const lim = bucket === "public" ? PUBLIC_LIMIT : DEFAULT_THROTTLE[bucket];
  const cap = lim.capacity;
  const rate = lim.refillPerSec;
  const expectedT = Math.max(0, (n - (bucket === "public" ? PUBLIC_LIMIT : DEFAULT_THROTTLE[bucket]).capacity) / (bucket === "public" ? PUBLIC_LIMIT : DEFAULT_THROTTLE[bucket]).refillPerSec) + 1;
  const T = Math.max(expectedT, ...series.map((p) => p.t));
  const W = 900;
  const H = 180;
  const x = (t: number) => (t / T) * (W - 40);
  const yT = (v: number) => H - 20 - (v / cap) * (H - 30);
  const yS = (v: number) => H - 20 - (v / n) * (H - 30);
  const expected = Math.max(0, (n - cap) / rate);

  return (
    <Card title="Pacing simulator" eyebrow="the TypeScript Throttler, in this page" right={
      <div className="row">
        <select className="select" style={{ width: 130 }} value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)}>
          {["place", "cancel", "read", "account", "stream", "history", "public"].map((b) => <option key={b}>{b}</option>)}
        </select>
        <input className="input num" style={{ width: 100 }} type="number" value={n} onChange={(e) => setN(Math.max(1, Math.min(2000, Number(e.target.value))))} />
        <button className="btn primary" disabled={running} onClick={run}>{running ? "Sending…" : `Send ${n}`}</button>
      </div>
    }>
      <div className="caption fg2" style={{ marginBottom: 10 }}>{n} requests against <span className="kbd">{bucket}</span> ({cap} burst, {rate}/s): the first {Math.min(n, cap)} go immediately, the rest are paced at {rate}/s, finishing in about {expected.toFixed(1)} s. Zero 429s.</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <line x1={0} x2={W - 40} y1={H - 20} y2={H - 20} stroke="#292929" />
        {series.length > 1 && (
          <>
            <path d={series.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${yT(p.tokens)}`).join(" ")} fill="none" stroke="#179be7" strokeWidth="2" />
            <path d={series.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${yS(p.sent)}`).join(" ")} fill="none" stroke="#24bf6c" strokeWidth="2" />
          </>
        )}
        <text x={W - 36} y={yT(cap) + 4} fill="#179be7" fontSize="12">tokens</text>
        <text x={W - 36} y={yS(n) + 16} fill="#24bf6c" fontSize="12">sent</text>
      </svg>
    </Card>
  );
}

function RequestLog() {
  const s = useStore();
  return (
    <Card title="Signed requests" eyebrow={IS_DEMO ? "runs locally with a QA key" : "every call the Rust client made for this console"}>
      <div className="table-wrap" style={{ maxHeight: 320 }}>
        <table className="table">
          <thead><tr><th>Time</th><th>Request</th><th className="num">Status</th><th>Bucket</th><th className="num">Cost</th><th className="num">Queued ms</th><th className="num">ms</th><th>Code</th></tr></thead>
          <tbody>
            {s.requests.slice(0, 80).map((r, i) => (
              <tr key={i}>
                <td className="num fg2">{clock(r.ts)}</td>
                <td className="mono" title={r.string_to_sign ?? ""}>{r.method} {r.path}{r.query ? `?${r.query}` : ""}</td>
                <td className={`num ${r.status >= 400 ? "neg" : "pos"}`}>{r.status}</td>
                <td className="fg2">{r.bucket ?? "free"}</td>
                <td className="num fg2">{r.cost}</td>
                <td className={`num ${r.waited_ms > 0 ? "caution" : "fg2"}`}>{r.waited_ms}</td>
                <td className="num fg2">{r.millis}</td>
                <td className="neg caption">{r.error_code ?? ""}</td>
              </tr>
            ))}
            {s.requests.length === 0 && <tr><td colSpan={8} className="fg2">{IS_DEMO ? "Signed calls run locally with a QA key (see the README), so none are made from this hosted page." : "No signed requests yet. They appear here once a key is loaded."}</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
