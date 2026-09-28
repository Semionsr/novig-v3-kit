/**
 * One SSE connection to the console server, fanned out to screens with tiny subscribe hooks.
 * Keeps short histories so a screen opened late still has context.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { IS_DEMO, type BookViewWire, type BotStateWire, type BucketView, type RequestRecordWire, type WsEventWire, type WsStats } from "./api.ts";

interface Store {
  connected: boolean;
  book: BookViewWire | null;
  events: Array<{ at: number; ev: WsEventWire }>;
  trades: Array<{ outcome: string; price: string; qty: number; ts: number }>;
  requests: RequestRecordWire[];
  stats: { ws: WsStats; stream: BucketView[]; signed: BucketView[]; mockDropEvery: number } | null;
  bot: BotStateWire | null;
  lifecycle: string | null;
  version: number;
}

const state: Store = { connected: false, book: null, events: [], trades: [], requests: [], stats: null, bot: null, lifecycle: null, version: 0 };
const listeners = new Set<() => void>();
let snapshot = { ...state };
let es: EventSource | null = null;
let raf = 0;

function publish() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    state.version++;
    snapshot = { ...state };
    for (const l of listeners) l();
  });
}

const QUIET = new Set(["book", "removals", "bbo"]);

let started = false;

function onFeed(msg: { kind: string; data: any }) {
  const now = Date.now();
  if (msg.kind === "ws") {
    const ev = msg.data as WsEventWire;
    if (ev.type === "book") state.book = ev.view;
    if (ev.type === "trades") state.trades = [...ev.trades.map((t) => ({ ...t })), ...state.trades].slice(0, 400);
    if (ev.type === "lifecycle") state.lifecycle = ev.status ?? (ev.transitions.includes("GOLIVE") ? "LIVE" : state.lifecycle);
    if (ev.type === "connected") { state.book = null; }
    if (!QUIET.has(ev.type)) state.events = [{ at: now, ev }, ...state.events].slice(0, 300);
  } else if (msg.kind === "request") {
    state.requests = [msg.data as RequestRecordWire, ...state.requests].slice(0, 300);
  } else if (msg.kind === "stats") {
    state.stats = msg.data;
  } else if (msg.kind === "bot") {
    state.bot = msg.data;
  }
  publish();
}

export function startEvents() {
  if (started) return;
  started = true;
  if (IS_DEMO) {
    // The hosted demo has no server: the in-page backend pushes the same feed directly.
    import("../demo/backend.ts").then((b) => {
      state.connected = true;
      publish();
      b.subscribe(onFeed);
    });
    return;
  }
  es = new EventSource("/api/events");
  es.onopen = () => { state.connected = true; publish(); };
  es.onerror = () => { state.connected = false; publish(); };
  es.onmessage = (m) => {
    let msg: { kind: string; data: any };
    try { msg = JSON.parse(m.data); } catch { return; }
    onFeed(msg);
  };
}

export function resetStreamState() {
  state.book = null;
  state.trades = [];
  state.bot = null;
  state.lifecycle = null;
  publish();
}

export function useStore(): Store {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snapshot);
}

/** Polls a function on an interval while mounted. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []): { data: T | undefined; error: unknown; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = () => fn().then((d) => { if (alive) { setData(d); setError(undefined); } }, (e) => alive && setError(e));
    run();
    const t = ms > 0 ? setInterval(run, ms) : undefined;
    return () => { alive = false; if (t) clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}
