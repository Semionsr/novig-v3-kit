# novig-v3-kit

An unofficial client toolkit for **Novig's v3 exchange API**, in the two languages Novig builds in:

- **`novig-v3` (Rust)**: NOVIG-V3 signing, typed REST for all 46 v3 routes, a client-side model of the throttle buckets, an L3 order book, and a websocket client that recovers from gaps
- **`@semion/novig-v3` (TypeScript)**: the same, with zero Node APIs, so it runs in Expo / React Native, browsers and Node
- **`novig-mm`**: a reference two-sided maker with paper (queue-aware) and live (post-only) modes
- **v3 Console**: a local web app built on both SDKs, styled with Novig's own design tokens

v3 replaced OAuth with request signing and added subaccounts, an order-level book and a new websocket. As of 2026-09-28 there is no client library for it in any language (the `novig` crate on crates.io is reserved and empty). Every trading partner currently re-implements the signer, the reconnect logic and the rate limiting from the docs. This kit is that shared layer, tested against Novig's own published vectors.

## Run it

```bash
make setup     # fetch fonts (local only), install JS deps, build the Rust binaries
make dev       # console at http://localhost:5173 (Rust server on :8787)
```

Works with **no key**:

- **Markets**: live production books and trades from `/v3/public`, read in the browser with the TS SDK
- **Signature Lab**: build and sign requests, run the 30 vectors, diagnose a rejected signature
- **Connection**: the Rust websocket client against a built-in mock exchange that drops frames on purpose
- **Throttle**: bucket meters and a pacing simulator
- **Trading**: the maker, paper-trading the mock

With a **QA key**, the same screens run against `api.qa.novig.com` (live orders, the private stream, your real buckets). To get a key: sign into the [QA app](https://novig-mobile-app--qa.expo.app) with Novig's test identity, create a management key, then copy `.env.example` to `.env`. The console's Quickstart screen walks through it.

Other entry points:

```bash
make test         # Rust + TS suites
make bot          # paper-trade the mock from the terminal
make quickstart   # Novig's 5-call quickstart on QA (needs .env)
make start        # build the UI and serve everything from :8787
make sync-spec    # re-pull the OpenAPI spec + vectors, fail if they changed
```

## What the SDKs take care of

| Where partners trip | What the SDK does |
|---|---|
| Canonical query rules (`+` vs `%20`, hex case, sort by name then value, repeats, bare params) | Implemented byte for byte. All 30 official vectors pass in Rust, TS and the browser |
| Signing different bytes than it sends | Builds the query, then signs the exact path, query and body bytes on the wire. Always sends `Content-Type` on bodies |
| P-256 from WebCrypto (raw `r‖s`) | Always emits DER. The Signature Lab detects raw `r‖s` in a partner's signature |
| 429s | Models the buckets from `GET /v3/limits` and queues instead of sending. On a 429 it honors `Retry-After` |
| Batches over the edge's 8 KiB body cap (~90 orders) | Splits `placeOrders` / `cancelOrders` by serialized size |
| Websocket gaps | Tracks `seq` per subject, buffers after a gap, and requests a snapshot for that subject only. It drops the covered deltas and replays the rest. Verbs are paced in a queue, so the socket is never left unread (`SLOW_CONSUMER`) |
| Heartbeats on quiet private channels | A heartbeat `seq` above ours triggers a private snapshot |
| "201 means it rests" | Order state comes from the private stream: `open`, `fill`, `cancel` (with engine reason), `reject` |
| Floats for money | Prices are integer thousandths on the 279-price grid. Balances and fees are exact decimals, rounded half up to $0.00001 like the exchange |
| `GOLIVE` | Surfaced as a lifecycle event. The maker drops its voided quotes, flips fees on, and cools down |

## Layout

```
rust/crates/novig-v3      sign.rs · query.rs · client.rs · throttle.rs · seq.rs · book.rs · ws.rs · mock.rs
rust/crates/novig-mm      reference maker (lib + `mm-bot` binary)
rust/bins/console-server  actix-web: holds keys, signs, relays the websocket + bot state over SSE
ts/packages/novig-v3      TypeScript SDK (signer, diagnose, client, throttle, book, stream)
ts/apps/console           Vite + React console
fixtures/                 Novig's OpenAPI spec, signing vectors and docs, as fetched
```

The browser never holds a private key. Signed calls and the websocket go through the local Rust server, since browsers also can't set headers on a websocket upgrade. React Native can, so the TS stream client takes a socket factory.

## Verified

- `cargo test --workspace` and `vitest` pass, including all 30 official signing vectors in both languages. Ed25519 signatures match byte for byte; P-256 signatures cross-verify.
- A lossy-feed test drives the websocket client against the mock (dropped frames, `GOLIVE`, a silent disconnect). It asserts the client's L3 book ends up identical to the exchange's, same `seq`, same queue order.
- Production public routes were exercised live. On 2026-09-28 the QA flows ran live against `api.qa.novig.com`: the 5-call quickstart (echo, subaccount, transfer, markets, a post-only order confirmed `open` and then `cancel` on the private stream), the console's signed routes, the websocket on a QA market, and the reference maker in live mode resting two-sided post-only quotes and pulling them on stop.

## Things I noticed in v3 (2026-09-28)

1. **The public book's ETag changes on every request.** Four GETs of an unchanged book (same `seq`) returned four different ETags, so `If-None-Match` almost never returns 304 behind the load balancer. The prefix looks per-instance.
   ```bash
   for i in 1 2 3 4; do curl -s -D - -o /dev/null https://api.novig.com/v3/public/catalog/markets/<id>/book | grep -i etag; done
   ```
2. **Browsers can't read `Retry-After`, `X-Request-Id` or `ETag`.** Responses carry `Access-Control-Allow-Origin: *` but no `Access-Control-Expose-Headers`, so web clients can't honor backoff or quote a request id to support.
   ```bash
   curl -s -D - -o /dev/null -H 'Origin: http://localhost' https://api.novig.com/v3/public/types/sports | grep -i access-control
   ```
3. **The `public` throttle is named but not defined.** Every `/v3/public` route lists it, but the throttling page describes only the six keyed buckets. Measured: about a 10-request burst refilling about 2/s per IP, shared across public routes, `429` with `Retry-After: 1`.
4. **The API changelog page is empty**, even though v3 moved the NBX v1 API to `/deprecated`.

## Notes

- Not affiliated with Novig. The console uses Novig's color tokens and type scale so it feels native to the product, and never uses the Novig logo.
- `scripts/fetch-fonts.sh` downloads the typefaces Novig's own web app ships (ABC Monument Grotesk, OO Theran) into `fonts/` for local use. They are licensed, so `fonts/` is gitignored and they are never committed or redistributed. Without them the console falls back to system fonts.
- Keys: `.env`, `*.pem`, `keys/` and `.novig/` are gitignored.
