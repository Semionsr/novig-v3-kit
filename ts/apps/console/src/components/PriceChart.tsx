/** The two-line price chart from novig.com's event card: outcome A in light gray, B in red. */
import { useEffect, useRef, useState } from "react";
import { pctRound } from "../lib/format.ts";

/** Draws at the container's real width so text stays at true size. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e!.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export interface Point {
  ts: number;
  milli: number; // outcome A's price
}

export function PriceChart({ points, height = 220 }: { points: Point[]; names?: [string, string]; height?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(560);
  return <div ref={ref} style={{ width: "100%" }}><Chart points={points} W={W} height={height} /></div>;
}

function Chart({ points, W, height }: { points: Point[]; W: number; height: number }) {
  const H = height;
  const padR = 56;
  const padB = 26;
  if (points.length < 2) {
    return <div className="empty-state footnote" style={{ height: H, display: "grid", placeItems: "center" }}>Not enough trades yet to draw a price line.</div>;
  }
  const a = points.map((p) => p.milli);
  const b = points.map((p) => 1000 - p.milli);
  const lo = Math.max(0, Math.min(...a, ...b) - 20);
  const hi = Math.min(1000, Math.max(...a, ...b) + 20);
  const t0 = points[0]!.ts;
  const t1 = points[points.length - 1]!.ts;
  const x = (ts: number) => ((ts - t0) / Math.max(1, t1 - t0)) * (W - padR - 8);
  const y = (m: number) => 8 + (1 - (m - lo) / Math.max(1, hi - lo)) * (H - padB - 16);
  const path = (vals: number[]) => points.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(vals[i]!).toFixed(1)}`).join(" ");
  const ticks = 5;
  const gridVals = Array.from({ length: ticks }, (_, i) => lo + ((hi - lo) * i) / (ticks - 1));
  const lastA = a[a.length - 1]!;
  const lastB = b[b.length - 1]!;
  const xs = [t0, (t0 + t1) / 2, t1];
  const label = (ts: number) => new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Price history">
      {gridVals.map((g) => (
        <g key={g}>
          <line x1={0} x2={W - padR} y1={y(g)} y2={y(g)} stroke="#292929" strokeDasharray="4 5" />
          <text x={W - 4} y={y(g) + 4} textAnchor="end" fill="#3f3f3e" fontSize="12" fontFamily="var(--font)">{pctRound(g)}</text>
        </g>
      ))}
      {xs.map((t, i) => (<text key={i} x={x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fill="#3f3f3e" fontSize="12" fontFamily="var(--font)">{label(t)}</text>))}
      <path d={path(a)} fill="none" stroke="#c9c4c1" strokeWidth="2" strokeLinejoin="round" />
      <path d={path(b)} fill="none" stroke="#ee3e3e" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(t1)} cy={y(lastA)} r="11" fill="rgba(201,196,193,0.18)" />
      <circle cx={x(t1)} cy={y(lastA)} r="5" fill="#c9c4c1" />
      <circle cx={x(t1)} cy={y(lastB)} r="11" fill="rgba(238,62,62,0.18)" />
      <circle cx={x(t1)} cy={y(lastB)} r="5" fill="#ee3e3e" />
    </svg>
  );
}

export function ChartLegend({ names, a }: { names: [string, string]; a: number | null }) {
  if (a === null) return null;
  return (
    <div style={{ display: "flex", gap: 22 }}>
      <div><div className="caption gray">{names[0]}</div><div className="hero-s" style={{ color: "#c9c4c1" }}>{pctRound(a)}</div></div>
      <div><div className="caption neg">{names[1]}</div><div className="hero-s neg">{pctRound(1000 - a)}</div></div>
    </div>
  );
}
