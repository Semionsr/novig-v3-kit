/**
 * The websocket, observed. Connects the Rust client (through the console server) to the built-in
 * mock exchange or to Novig QA, and shows what it does with a lossy feed: gaps detected, the
 * per-subject snapshot request, buffered deltas replayed, reconnects after a silent drop.
 */
import { useState } from "react";
import { OrderBook } from "../components/OrderBook.tsx";
import { Card, ErrorLine, Notice, Stat } from "../components/ui.tsx";
import { IS_DEMO, api, type ServerStatus, type WsEventWire } from "../lib/api.ts";
import { sidesFromView } from "../lib/book.ts";
import { ago, clock, int } from "../lib/format.ts";
import { resetStreamState, usePoll, useStore } from "../lib/store.ts";

const LOSS = [
  { label: "No loss", v: 0 },
  { label: "1 in 120", v: 120 },
  { label: "1 in 60", v: 60 },
  { label: "1 in 20", v: 20 },
  { label: "1 in 8", v: 8 },
];

export function Connection({ status, refresh }: { status?: ServerStatus; refresh: () => void }) {
  const s = useStore();
  const [target, setTarget] = useState<"mock" | "qa">("mock");
  const [market, setMarket] = useState("");
  const [err, setErr] = useState<unknown>();
  const ws = s.stats?.ws;
  const connectedTo = status?.stream?.target;
  const act = async (f: () => Promise<unknown>) => {
    setErr(undefined);
    try { await f(); refresh(); } catch (e) { setErr(e); }
  };

  const connect = () => act(async () => {
    resetStreamState();
    await api.post("/api/stream/connect", { target, market: target === "qa" && market ? market : undefined });
  });

  const names: [string, string] = connectedTo === "mock" ? ["Home", "Away"] : ["Outcome A", "Outcome B"];
  const subjects = Object.entries(ws?.subjects ?? {});
  const interesting = s.events.filter((e) => !["trades", "subscribed", "ack"].includes(e.ev.type)).slice(0, 80);

  return (
    <div className="stack fade-in">
      <Card title="Websocket" eyebrow="GET /v3/ws · one socket, every channel" right={
        <div className="row">
          <div className="seg">
            <button className={target === "mock" ? "on" : ""} onClick={() => setTarget("mock")}>Local mock exchange</button>
            {!IS_DEMO && <button className={target === "qa" ? "on" : ""} onClick={() => setTarget("qa")} disabled={!status?.trading} title={status?.trading ? "" : "Needs a trading key (Quickstart)"}>Novig QA</button>}
          </div>
          {target === "qa" && <input className="input mono" style={{ width: 320 }} placeholder="market id to watch" value={market} onChange={(e) => setMarket(e.target.value)} />}
          <button className="btn primary" onClick={connect}>{ws?.connected ? "Reconnect" : "Connect"}</button>
          <button className="btn" onClick={() => act(() => api.post("/api/stream/disconnect"))} disabled={!connectedTo}>Disconnect</button>
        </div>
      }>
        {!connectedTo && (
          <Notice>
            Click <b>Connect</b>, then under <b>Break it on purpose</b> pick a frame loss like <b>1 in 8</b>. The practice exchange starts dropping messages, and the <b>Gaps</b> and <b>Resyncs</b> counts go up while the order book stays correct. It speaks the same v3 protocol as Novig's real feed.{IS_DEMO ? "" : <> <b>Novig QA</b> unlocks once a trading key exists.</>}
          </Notice>
        )}
        {connectedTo && (
          <div className="grid g4" style={{ gap: 10 }}>
            <Stat k="State" v={ws?.connected ? "Connected" : "Reconnecting"} s={`${connectedTo === "mock" ? "mock exchange" : "Novig QA"} · connection #${ws?.connection ?? 0}`} tone={ws?.connected ? "pos" : "caution"} />
            <Stat k="Frames" v={int(ws?.messages ?? 0)} s={`${((ws?.bytes ?? 0) / 1024).toFixed(0)} KiB · last ${ago(ws?.last_message_ts)}`} />
            <Stat k="Gaps detected" v={int(ws?.gaps ?? 0)} s={`${int(ws?.resyncs ?? 0)} healed by snapshot`} tone={(ws?.gaps ?? 0) > 0 ? "caution" : undefined} />
            <Stat k="Reconnects" v={int(ws?.reconnects ?? 0)} s={`nonce ${ws?.nonce ?? 0} · ${ws?.queued_verbs ?? 0} verbs queued`} />
            <Stat k="Subscribed weight" v={`${ws?.subscribed_weight ?? 0}`} s="book 16 · bbo 8 · trades 4 · lifecycle 1" />
            <Stat k="Watched markets" v={`${ws?.watched_markets ?? 0} / 2,048`} s="per connection" />
            <Stat k="Server errors" v={int(ws?.server_errors ?? 0)} s="STALE_NONCE, EMPTY_SELECTION…" tone={(ws?.server_errors ?? 0) > 0 ? "neg" : undefined} />
            <Stat k="Market status" v={s.lifecycle ?? "–"} s="lifecycle channel" />
          </div>
        )}
        <ErrorLine error={err} />
      </Card>

      {connectedTo === "mock" && (
        <Card title="Break it on purpose" right={<span className="caption fg2">mock exchange controls</span>}>
          <div className="row">
            <span className="footnote fg2">Frame loss</span>
            <div className="seg">
              {LOSS.map((l) => (<button key={l.v} className={s.stats?.mockDropEvery === l.v ? "on" : ""} onClick={() => act(() => api.post("/api/mock/loss", { dropEvery: l.v }))}>{l.label}</button>))}
            </div>
            <div className="spacer" />
            <button className="btn" onClick={() => act(() => api.post("/api/stream/snapshot"))}>Force snapshot</button>
            <button className="btn danger" onClick={() => act(() => api.post("/api/mock/kill"))}>Drop connection (no close frame)</button>
          </div>
        </Card>
      )}

      {connectedTo && (
        <div className="grid g2" style={{ alignItems: "start" }}>
          <Card title="Live book from the stream" right={<span className="caption fg2 num">seq {s.book?.seq ?? "–"} · {s.book?.orders ?? 0} orders</span>}>
            {s.book ? <OrderBook sides={sidesFromView(s.book, names)} depth={7} /> : <div className="footnote fg2">Waiting for the snapshot…</div>}
          </Card>
          <Card title="Sequencing per subject" right={<span className="caption fg2">seq is per market, per channel</span>}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Subject</th><th className="num">Last seq</th><th className="num">Applied</th><th className="num">Gaps</th><th className="num">Resyncs</th><th className="num">Buffered</th></tr></thead>
                <tbody>
                  {subjects.map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono">{k.replace(/market:([0-9a-f]{8})[0-9a-f-]+:/, "market:$1…:")}</td>
                      <td className="num num">{v.last_seq ?? "–"}</td>
                      <td className="num num fg2">{int(v.applied)}</td>
                      <td className={`num num ${v.gaps ? "caution" : "fg2"}`}>{v.gaps}</td>
                      <td className={`num num ${v.resyncs ? "pos" : "fg2"}`}>{v.resyncs}</td>
                      <td className="num num">{v.awaiting_snapshot ? <span className="badge caution">awaiting · {v.buffered_now}</span> : v.buffered_now}</td>
                    </tr>
                  ))}
                  {subjects.length === 0 && <tr><td colSpan={6} className="fg2">No subjects yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="caption fg2" style={{ marginTop: 10 }}>On a skipped seq the client buffers what follows, sends <span className="kbd">snapshot</span> for that subject only, drops the deltas the snapshot covers and replays the rest. Snapshot requests are paced by the <span className="kbd">stream</span> bucket in a queue, so the socket is never left unread (which Novig closes as <span className="kbd">SLOW_CONSUMER</span>).</div>
          </Card>
        </div>
      )}

      {connectedTo && (
        <Card title="Event timeline">
          <div className="timeline">
            {interesting.map(({ at, ev }, i) => <TimelineRow key={i} at={at} ev={ev} />)}
            {interesting.length === 0 && <div className="footnote fg2">Nothing yet.</div>}
          </div>
        </Card>
      )}
    </div>
  );
}

function describe(ev: WsEventWire): [string, string, string] {
  switch (ev.type) {
    case "connected": return ["pos", "connected", `connection #${ev.connection} to ${ev.url}`];
    case "disconnected": return ["neg", "disconnected", `${ev.reason}${ev.code ? ` (${ev.code})` : ""} · retry in ${ev.retry_in_ms} ms`];
    case "gap": return ["caution", "gap", `${ev.subject}: missing seq ${ev.missing}, got ${ev.got} → snapshot requested`];
    case "resynced": return ["pos", "resynced", `${ev.subject} at seq ${ev.seq}, replayed ${ev.replayed} buffered deltas`];
    case "book_reset": return ["accent", "snapshot", `book snapshot at seq ${ev.seq}`];
    case "lifecycle": return ["accent", "lifecycle", ev.transitions.length ? `${ev.transitions.join(", ")}${ev.transitions.includes("GOLIVE") ? ": every resting order voided, taker fees on" : ""}` : `status ${ev.status ?? "?"}`];
    case "heartbeat": return ["fg2", "heartbeat", JSON.stringify(ev.private)];
    case "server_error": return ["neg", "error", `${ev.code}: ${ev.message}`];
    case "orders": return ["accent", "orders", (ev.events ?? []).map((e) => `${e.kind} ${String(e.orderId).slice(0, 8)}`).join(", ")];
    case "orders_snapshot": return ["accent", "orders", `snapshot: ${(ev.open ?? []).length} open`];
    case "positions": return ["accent", "positions", `${(ev.positions ?? []).length} positions`];
    default: return ["fg2", ev.type, ""];
  }
}

function TimelineRow({ at, ev }: { at: number; ev: WsEventWire }) {
  const [tone, label, text] = describe(ev);
  return (
    <div className="tl">
      <span className="t">{clock(at)}</span>
      <span className={`badge ${tone === "fg2" ? "" : tone}`} style={{ justifySelf: "start" }}>{label}</span>
      <span className="footnote" style={{ wordBreak: "break-word" }}>{text}</span>
    </div>
  );
}

export function useStatus() {
  return usePoll(() => api.get<ServerStatus>("/api/status"), 4000);
}
