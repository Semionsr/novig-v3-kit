/**
 * The browser talks to Novig's production public API directly, with the TypeScript SDK:
 * the same code that would run inside Novig's Expo app.
 */
import { NovigClient, type RequestRecord } from "@semion/novig-v3";
import { useSyncExternalStore } from "react";

let log: RequestRecord[] = [];
const subs = new Set<() => void>();

export const publicClient = new NovigClient({
  env: "production",
  onRequest: (r) => {
    log = [r, ...log].slice(0, 200);
    for (const s of subs) s();
  },
});

export function useBrowserRequests() {
  return useSyncExternalStore((l) => { subs.add(l); return () => subs.delete(l); }, () => log);
}
