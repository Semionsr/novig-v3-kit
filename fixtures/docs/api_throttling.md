> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Throttling

> How we limit your request rate, and how to pace your requests.

export const MAX_WATCHED_MARKETS = 2048;

export const TRANSFER_PER_MINUTE = 60;

export const TRANSFER_PER_SECOND = 5;

export const FIXED_WINDOW = "600 /60s";

export const HISTORY_REFILL = 4;

export const HISTORY_CAPACITY = 512;

export const STREAM_REFILL = 4;

export const STREAM_CAPACITY = 512;

export const ACCOUNT_REFILL = 8;

export const ACCOUNT_CAPACITY = 64;

export const READ_REFILL = 16;

export const READ_CAPACITY = 64;

export const CANCEL_REFILL = 16;

export const CANCEL_CAPACITY = 256;

export const PLACE_REFILL = 8;

export const PLACE_CAPACITY = 256;

export const METER_MAX = Math.max(PLACE_CAPACITY, CANCEL_CAPACITY, READ_CAPACITY, ACCOUNT_CAPACITY, STREAM_CAPACITY, HISTORY_CAPACITY);

We limit how fast you can send requests, in two places.
Our servers throttle each API key, and an edge filter in front of them limits each IP address.

## Limits on our servers

Each throttle is a bucket of tokens.
A request spends tokens from its bucket.
The bucket holds up to its capacity, which is your burst, and refills at its refill rate, in tokens per second.

<div className="meters">
  <div className="meter-head">
    <span className="meter-name">Throttle</span>
    <span className="meter-span">Burst</span>
    <span className="meter-cap">Capacity</span>
    <span className="meter-rate">Refill</span>
  </div>

  <div className="meter-row">
    <span className="meter-name"><code>place</code></span>

    <span className="meter">
      <span className="meter-fill" style={{width: `${100 * PLACE_CAPACITY / METER_MAX}%`}} />
    </span>

    <span className="meter-cap">
      {PLACE_CAPACITY.toLocaleString("en-US")}
    </span>

    <span className="meter-rate">{PLACE_REFILL} Hz</span>
  </div>

  <div className="meter-row">
    <span className="meter-name"><code>cancel</code></span>

    <span className="meter">
      <span className="meter-fill" style={{width: `${100 * CANCEL_CAPACITY / METER_MAX}%`}} />
    </span>

    <span className="meter-cap">
      {CANCEL_CAPACITY.toLocaleString("en-US")}
    </span>

    <span className="meter-rate">{CANCEL_REFILL} Hz</span>
  </div>

  <div className="meter-row">
    <span className="meter-name"><code>read</code></span>

    <span className="meter">
      <span className="meter-fill" style={{width: `${100 * READ_CAPACITY / METER_MAX}%`}} />
    </span>

    <span className="meter-cap">
      {READ_CAPACITY.toLocaleString("en-US")}
    </span>

    <span className="meter-rate">{READ_REFILL} Hz</span>
  </div>

  <div className="meter-row">
    <span className="meter-name"><code>account</code></span>

    <span className="meter">
      <span className="meter-fill" style={{width: `${100 * ACCOUNT_CAPACITY / METER_MAX}%`}} />
    </span>

    <span className="meter-cap">
      {ACCOUNT_CAPACITY.toLocaleString("en-US")}
    </span>

    <span className="meter-rate">{ACCOUNT_REFILL} Hz</span>
  </div>

  <div className="meter-row">
    <span className="meter-name"><code>stream</code></span>

    <span className="meter">
      <span className="meter-fill" style={{width: `${100 * STREAM_CAPACITY / METER_MAX}%`}} />
    </span>

    <span className="meter-cap">
      {STREAM_CAPACITY.toLocaleString("en-US")}
    </span>

    <span className="meter-rate">{STREAM_REFILL} Hz</span>
  </div>

  <div className="meter-row">
    <span className="meter-name"><code>history</code></span>

    <span className="meter">
      <span className="meter-fill" style={{width: `${100 * HISTORY_CAPACITY / METER_MAX}%`}} />
    </span>

    <span className="meter-cap">
      {HISTORY_CAPACITY.toLocaleString("en-US")}
    </span>

    <span className="meter-rate">{HISTORY_REFILL} Hz</span>
  </div>
</div>

The `history` bucket meters the record reads that hit the database: fills, transactions, and settled orders. Each such read costs a base plus one token per page of rows, so a larger page spends more. `GET /v3/limits` reports every bucket's numbers.

## Websocket subscriptions

The `stream` bucket meters how fast you subscribe. A second limit caps how much you hold: a connection may watch up to <code>{MAX_WATCHED_MARKETS.toLocaleString("en-US")}</code> markets at once. An event counts as the markets it contains. A subscribe that would take you over that answers `SUBSCRIPTION_LIMIT_EXCEEDED`, and it subscribes to nothing. `GET /v3/limits` reports the cap.

A few account routes use a fixed limit per time window instead of a bucket.

| Route                                      | Limit                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `/v3/keys`                                 | <code>{FIXED_WINDOW}</code>                                                       |
| `/v3/account`                              | <code>{FIXED_WINDOW}</code>                                                       |
| `/v3/account/subaccounts/{keyId}/transfer` | <code>{TRANSFER_PER_SECOND} /s</code> and <code>{TRANSFER_PER_MINUTE} /60s</code> |

We count the `/v3/keys` and `/v3/account` limit per key, method, and route.

We count both transfer limits per key, and both apply at once.

## Limits at the edge

The edge is a filter in front of our servers.
It checks every request on every route before the request reaches them.

| Check        | Counted per |
| ------------ | ----------- |
| Request rate | IP address  |
| Body size    | Request     |

<Warning>
  The edge refuses a request with a `403` and an HTML body, with no `code` and no `message`. The request never reaches our servers.
</Warning>

## Pace your requests

A throttle refills over time, up to its capacity:

$$
\text{tokens}(t + \Delta t) = \min\bigl(C,\; \text{tokens}(t) + r\,\Delta t\bigr)
$$

Here $C$ is the capacity, $r$ is the refill rate, and $\Delta t$ is the time that has passed.

1. Model each throttle in your client.
2. When you send a request, subtract its cost from your model.
3. While your model holds too few tokens, queue the request instead of sending it.

## Error response

When you go over a limit, we answer `429` with a `Retry-After` header:

```http theme={"dark"}
HTTP/1.1 429 Too Many Requests
Retry-After: 3

{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded. Please wait before retrying."
}
```

* Wait `Retry-After` seconds before you retry. Retrying sooner hits the same empty throttle.
* Split your work across keys. The throttle counts per key, not per connection.
* Handle a `429` even if you model the throttles. Our servers share token counts with each other gradually, so your model is never exact.
