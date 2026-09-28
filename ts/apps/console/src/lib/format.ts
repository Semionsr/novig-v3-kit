/** Formatting in Novig's own conventions: prices as percents, depth as dollars. */

export const pct = (milli: number, digits = 1) => `${(milli / 10).toFixed(digits)}%`;
export const pctRound = (milli: number) => `${Math.round(milli / 10)}%`;
export const priceToMilli = (p: string) => Math.round(Number(p) * 1000);

/** Dollars it costs to buy `qty` contracts at `milli` (each contract pays 1¢). */
export const notional = (milli: number, qty: number) => (milli * qty) / 100_000;

export function usd(n: number, opts: { cents?: boolean; compact?: boolean } = {}) {
  if (opts.compact && Math.abs(n) >= 1000) {
    const units: Array<[number, string]> = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
    for (const [v, s] of units) if (Math.abs(n) >= v) return `$${(n / v).toFixed(1).replace(/\.0$/, "")}${s}`;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0 });
}

export const usd5 = (s: string | number) => `$${Number(s).toFixed(5)}`;
export const int = (n: number) => n.toLocaleString("en-US");

/** "$100 ➤ $198": what $100 returns if this outcome wins at `milli`. */
export const payoutOf100 = (milli: number) => (milli > 0 ? Math.floor(100000 / milli) : 0);

export function clock(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function when(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return { day: "Today", time };
  if (d.toDateString() === tomorrow.toDateString()) return { day: "Tomorrow", time };
  return { day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), time };
}

export const ago = (ts?: number | null) => {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

const LEAGUE_NAMES: Record<string, string> = {
  NFL: "Pro Football", NCAAF: "College Football", MLB: "Pro Baseball", NBA: "Pro Basketball", WNBA: "Pro Basketball (W)",
  NHL: "Hockey", NCAAB: "College Basketball", UFC: "MMA", ATP: "Tennis (M)", WTA: "Tennis (W)", PGA: "Golf", EPL: "Premier League",
  MLS: "MLS", KBO: "KBO", NPB: "NPB", Boxing: "Boxing",
};
export const leagueName = (l: string) => LEAGUE_NAMES[l] ?? l;

/** "HOU @ CWS" → ["HOU", "CWS"], "A @ B Round of 16" keeps the suffix off. */
export function splitEvent(desc: string): [string, string] | null {
  const m = /^(.*?)\s+(?:@|at|vs\.?)\s+(.*?)(?:\s+(Round of \d+|Quarterfinal|Semifinal|Final).*)?$/i.exec(desc);
  return m ? [m[1]!.trim(), m[2]!.trim()] : null;
}
