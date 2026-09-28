import { describe, expect, it } from "vitest";
import { Book } from "../src/book.ts";
import { Sequencer } from "../src/seq.ts";
import { chunkByBytes } from "../src/client.ts";
import { NovigStream, type SocketLike, type StreamEvent } from "../src/ws.ts";
import { cost, formatPrice, grid, makerCredit, parsePrice, snapDown, snapUp, takerFee } from "../src/types.ts";
import { Throttler } from "../src/throttle.ts";

describe("price grid and fees (docs worked examples)", () => {
  it("279 prices, closed under complement", () => {
    const g = grid();
    expect(g).toHaveLength(279);
    for (const p of g) expect(g).toContain(1000 - p);
    expect(snapDown(667)).toBe(665);
    expect(snapUp(947)).toBe(950);
    expect(formatPrice(parsePrice("0.5"))).toBe("0.500");
  });
  it("fees", () => {
    const game = { coefficient: "0.03", makerCredit: "0.5" };
    const fut = { coefficient: "0.06", makerCredit: "0.7" };
    expect(takerFee(game, 500, 10_000)).toBe("0.75000");
    expect(takerFee(fut, 500, 10_000)).toBe("1.50000");
    expect(takerFee(game, 300, 10_000)).toBe("0.63000");
    expect(takerFee(fut, 100, 10_000)).toBe("0.54000");
    expect(takerFee(game, 500, 100)).toBe("0.00750");
    expect(makerCredit(game, 500, 10_000)).toBe("0.37500");
    expect(makerCredit(fut, 500, 10_000)).toBe("1.05000");
    expect(cost(665, 110)).toBe("0.73150");
  });
});

describe("book", () => {
  it("partial fill keeps queue position; complement quote", () => {
    const b = new Book(["A", "B"]);
    b.apply(1, [
      { kind: "add", order: "1", outcome: "A", price: "0.500", qty: 100 },
      { kind: "add", order: "2", outcome: "A", price: "0.500", qty: 100 },
      { kind: "add", order: "3", outcome: "B", price: "0.480", qty: 50 },
    ]);
    b.apply(2, [
      { kind: "remove", order: "1", reason: "fill" },
      { kind: "add", order: "1", outcome: "A", price: "0.500", qty: 40 },
    ]);
    expect(b.queue("A").map((o) => [o.id, o.qty])).toEqual([["1", 40], ["2", 100]]);
    expect(b.quote("A")).toEqual({ bid: { price: 500, qty: 140, orders: 2 }, offer: { price: 520, qty: 50, orders: 1 } });
  });
});

describe("sequencer", () => {
  it("docs example", () => {
    const s = new Sequencer<string>();
    s.snapshot(48121);
    expect(s.delta(48122, "a")).toEqual({ kind: "apply", batch: "a" });
    expect(s.delta(48124, "c")).toEqual({ kind: "gap", missing: 48123, got: 48124 });
    expect(s.delta(48126, "e")).toEqual({ kind: "buffered" });
    expect(s.snapshot(48125)).toEqual([[48126, "e"]]);
    expect(s.stats().resyncs).toBe(1);
  });
});

describe("edge-safe batching", () => {
  it("splits 1024 orders into bodies under 8 KiB", () => {
    const orders = Array.from({ length: 1024 }, () => ({ outcomeId: "01a0e8eb-2375-7db0-92f2-84ed53c2c39c", price: "0.665", qty: 1000, tif: "GTC" as const, clientId: "01a0e8eb-2375-7db0-92f2-84ed53c2c39c" }));
    const chunks = chunkByBytes(orders, (os) => JSON.stringify({ orders: os }));
    expect(chunks.flat()).toHaveLength(1024);
    for (const c of chunks) expect(new TextEncoder().encode(JSON.stringify({ orders: c })).length).toBeLessThanOrEqual(8192);
    expect(chunks.length).toBeGreaterThan(10);
  });
});

/** A scripted fake socket: the test plays the exchange. */
class FakeSocket implements SocketLike {
  sent: any[] = [];
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.onclose?.({ code: 1000 }); }
  push(v: unknown) { this.onmessage?.({ data: JSON.stringify(v) }); }
}

describe("stream gap recovery", () => {
  it("detects a skipped seq, asks for a snapshot, replays, and converges", () => {
    const sock = new FakeSocket();
    const s = new NovigStream({ url: "wss://example.test/v3/ws", socketFactory: () => sock, throttler: new Throttler() });
    const events: StreamEvent[] = [];
    s.on((e) => events.push(e));
    s.connect();
    sock.onopen?.({});
    s.subscribe({ markets: { M: "book" } });
    expect(sock.sent[0]).toEqual({ nonce: 1, subscribe: { markets: { M: "book" } } });
    sock.push({ nonce: 1, subscribed: {}, snapshot: { M: { book: { seq: 10, orders: { A: [{ order: "o1", price: "0.500", qty: 5 }] } }, lifecycle: { seq: 1, status: "OPEN" } } } });
    sock.push({ delta: { M: { book: { seq: 11, deltas: [{ kind: "add", order: "o2", outcome: "A", price: "0.495", qty: 7 }] } } } });
    // seq 12 lost
    sock.push({ delta: { M: { book: { seq: 13, deltas: [{ kind: "add", order: "o4", outcome: "A", price: "0.490", qty: 1 }] } } } });
    expect(events.some((e) => e.type === "gap")).toBe(true);
    expect(sock.sent[1]).toEqual({ nonce: 2, snapshot: { markets: { M: "book" } } });
    sock.push({ delta: { M: { book: { seq: 14, deltas: [{ kind: "remove", order: "o1", reason: "cancel" }] } } } });
    // snapshot at 12 (the exchange's truth), then buffered 13 and 14 replay
    sock.push({ nonce: 2, snapshot: { M: { book: { seq: 12, orders: { A: [{ order: "o1", price: "0.500", qty: 5 }, { order: "o2", price: "0.495", qty: 7 }, { order: "o3", price: "0.495", qty: 2 }] } } } } });
    const b = s.book("M")!;
    expect(b.seq).toBe(14);
    expect(b.queue("A").map((o) => o.id)).toEqual(["o2", "o3", "o4"]);
    expect(events.find((e) => e.type === "resynced")).toMatchObject({ replayed: 2 });
    expect(s.stats.gaps).toBe(1);
  });
});
