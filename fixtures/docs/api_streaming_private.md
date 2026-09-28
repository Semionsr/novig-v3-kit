> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Private

> Your own orders and positions: open, fill, cancel, reject.

export const HEARTBEAT = "15 s";

export const WEIGHT_ORDERS = 1;

The private stream carries your own orders and positions on two channels.
The `orders` channel costs {WEIGHT_ORDERS} token. The `positions` channel carries your positions.

Name each channel in the `private` field of a subscribe.
To drop both, unsubscribe the subject `PRIVATE`.

Each channel covers only the subaccount of the key that signed the handshake.

```json theme={"dark"}
{
  "nonce": 3,
  "subscribe": {
    "private": ["orders"]
  }
}
```

To follow an order from start to finish, see [Track order state](/api/concepts/order-lifecycle#track-order-state).

## Snapshot

```json theme={"dark"}
{
  "ts": 1757894400123,
  "nonce": 3,
  "subscribed": {
    "markets": {},
    "events": {},
    "private": ["orders"]
  },
  "snapshot": {},
  "orders": {
    "seq": 907,
    "open": [
      {
        "orderId": "7c9e6679-…",
        "clientId": "0b3f5f20-…",
        "marketId": "6f9619ff-…",
        "outcomeId": "3f2504e0-…",
        "price": "0.665",
        "qty": 110,
        "tif": "GTC"
      }
    ]
  }
}
```

`orders.seq` counts the order events of your subaccount, not of one connection.
It's independent of every market's `seq`.

A `seq` of `0` means no event has occurred.

A server restart resets the `seq`. Never compare a `seq` across connections.

A subscribe that names only `private` gets an empty `snapshot`.

## Events

Events arrive in the `orders` field of a delta, as one batch with one `seq`.
Within a batch, an order's `fill` events come before its `open`, `cancel`, or `reject`.

```json theme={"dark"}
{
  "ts": 1757894400456,
  "delta": {},
  "orders": {
    "seq": 908,
    "deltas": [
      {
        "kind": "cancel",
        "orderId": "7c9e6679-…"
      }
    ]
  }
}
```

<Tabs>
  <Tab title="open">
    ```json theme={"dark"}
    {
      "kind": "open",
      "orderId": "7c9e6679-…",
      "clientId": "0b3f5f20-…",
      "marketId": "6f9619ff-…",
      "outcomeId": "3f2504e0-…",
      "price": "0.665",
      "qty": 110,
      "tif": "GTC"
    }
    ```

    The order rests. **This event, not the `201`, confirms that the order rests.**

    `qty` is the resting quantity.

    `clientId` appears only when the placement sent one.
    An order with an expiry also carries `expiresAt`, in Unix milliseconds.
  </Tab>

  <Tab title="fill">
    ```json theme={"dark"}
    {
      "kind": "fill",
      "orderId": "7c9e6679-…",
      "clientId": "0b3f5f20-…",
      "outcomeId": "3f2504e0-…",
      "price": "0.670",
      "qty": 40,
      "remaining": 70
    }
    ```

    `price` is the traded price. It can be better than your limit.

    `remaining: 0` means the order is `FILLED`.

    This event carries no fee.

    A self-match, where your order trades with your own order, also sends a `fill` here. The `trades` channel omits it.
  </Tab>

  <Tab title="cancel">
    ```json theme={"dark"}
    {
      "kind": "cancel",
      "orderId": "7c9e6679-…",
      "reason": "GO_LIVE"
    }
    ```

    The event carries `reason` only when the engine states one: `GO_LIVE`, `MARKET_CLOSED`, `SETTLED`, or `NEUTRALIZED`.

    A cancel by you, by expiry, or by an admin carries no `reason`.
  </Tab>

  <Tab title="reject">
    ```json theme={"dark"}
    {
      "kind": "reject",
      "orderId": "7c9e6679-…"
    }
    ```

    We accepted the order, then refused it. **No HTTP status reports this refusal.**

    An unfilled `IOC`, `FOK`, or `PO` order also arrives as `reject`.
  </Tab>
</Tabs>

## Positions

The snapshot lists your nonzero positions under `positions`.
In a delta, `positions` holds a `seq` and a `deltas` list of the positions that changed.

Positions already account for washes and neutralizations.

* A wash is a self-match: your order traded against another of yours, possibly in another subaccount. You get a `fill`, but your position doesn't change and nothing appears on `trades`.
* A neutralization is a cash-out. We cancel your resting orders in the market with `reason: "NEUTRALIZED"`, and may place a hedge order that closes your position.

```json theme={"dark"}
"positions": {
  "seq": 12,
  "positions": [
    {
      "marketId": "6f9619ff-…",
      "outcomeId": "3f2504e0-…",
      "qty": 110,
      "cost": "0.73150"
    }
  ]
}
```

| Field  | Meaning                               |
| ------ | ------------------------------------- |
| `qty`  | Contracts held                        |
| `cost` | Net dollars paid, as a decimal string |
| `seq`  | Per subaccount                        |

* A `qty` of `0` in a delta means the position closed.
* `100 × cost / qty` is the average price.
* The positions `seq` is independent of `orders.seq`.

## Slow consumer

A slow consumer is a client that reads too slowly, so its queue fills up.

| Frame                 | Sent                 | On a full queue |
| --------------------- | -------------------- | --------------- |
| Replies, heartbeats   | Before market frames | Waits for room  |
| `orders`, `positions` | Before market frames | Dropped         |
| Market channels       | After private frames | Dropped         |

A seq gap or a heartbeat shows a dropped `orders` or `positions` frame.
A seq gap shows a dropped market frame.

A write that stalls for {HEARTBEAT} closes the connection with code `1008` and reason `SLOW_CONSUMER`.

<Warning>
  After `SLOW_CONSUMER`, reconnect, subscribe again, and take the snapshot. Don't resume from the old `seq`.
</Warning>

## Recovery

Every {HEARTBEAT}, we send a `heartbeat` with your last `seq` on each private channel you subscribe to.
A quiet channel still reports its `seq`.

A heartbeat `seq` above your last `seq` means you lost a message.

```json theme={"dark"}
{
  "heartbeat": {
    "orders": 911,
    "ts": 1757894415123
  }
}
```

<svg className="sd" viewBox="0 0 640 380" role="img" aria-label="Recovery sequence. The client subscribes to private orders. The exchange replies with a snapshot at seq 907 with open orders. The client places an order with POST /v3/orders over REST and gets 201 with the orderId. The exchange sends a delta at seq 908 with open, then a delta at seq 909 with a fill, remaining 70. The connection drops. The client reconnects and subscribes to private orders again. The exchange replies with a snapshot at seq 911 with open orders. The client diffs open against its state on orderId.">
  <path className="sd-edge" d="M80,42 V370" />

  <path className="sd-edge" d="M560,42 V370" />

  <path className="sd-edge" d="M80,76 H556" />

  <path className="sd-head" d="M556,76 L549,79.5 L549,72.5 z" />

  <g><text className="sd-label" x="320" y="70" textAnchor="middle">subscribe \{ private: \[orders] }</text></g>

  <path className="sd-edge" d="M560,108 H84" />

  <path className="sd-head" d="M84,108 L91,104.5 L91,111.5 z" />

  <g><text className="sd-label" x="320" y="102" textAnchor="middle">snapshot \{ orders: \{ seq: 907, open } }</text></g>

  <path className="sd-edge" d="M80,140 H556" />

  <path className="sd-head" d="M556,140 L549,143.5 L549,136.5 z" />

  <g><text className="sd-label" x="320" y="134" textAnchor="middle">POST /v3/orders (REST)</text></g>

  <path className="sd-edge" d="M560,172 H84" />

  <path className="sd-head" d="M84,172 L91,168.5 L91,175.5 z" />

  <g><text className="sd-label" x="320" y="166" textAnchor="middle">201 \{ orderId }</text></g>

  <path className="sd-edge" d="M560,204 H84" />

  <path className="sd-head" d="M84,204 L91,200.5 L91,207.5 z" />

  <g><text className="sd-label" x="320" y="198" textAnchor="middle">delta \{ orders: \{ seq: 908, \[open] } }</text></g>

  <path className="sd-edge" d="M560,236 H84" />

  <path className="sd-head" d="M84,236 L91,232.5 L91,239.5 z" />

  <g><text className="sd-label" x="320" y="230" textAnchor="middle">delta \{ orders: \{ seq: 909, \[fill remaining 70] } }</text></g>
  <g><text className="sd-lane" x="320" y="270" textAnchor="middle">CONNECTION DROPS</text></g>

  <path className="sd-edge" d="M80,302 H556" />

  <path className="sd-head" d="M556,302 L549,305.5 L549,298.5 z" />

  <g><text className="sd-label" x="320" y="296" textAnchor="middle">reconnect, subscribe \{ private: \[orders] }</text></g>

  <path className="sd-edge" d="M560,334 H84" />

  <path className="sd-head" d="M84,334 L91,330.5 L91,337.5 z" />

  <g><text className="sd-label" x="320" y="328" textAnchor="middle">snapshot \{ orders: \{ seq: 911, open } }</text></g>
  <g><text className="sd-label" x="90" y="362" textAnchor="start">diff open against your state on orderId</text></g>
  <g className="sd-box sd-cream"><rect x="20" y="10" width="120" height="32" rx="2" /><circle cx="131" cy="19" r="2.5" /><text x="30" y="30">CLIENT</text></g>
  <g className="sd-box sd-fill"><rect x="500" y="10" width="120" height="32" rx="2" /><circle cx="611" cy="19" r="2.5" /><text x="510" y="30">EXCHANGE</text></g>
</svg>

<p className="tree-foot">Arrows are messages, top to bottom in time.</p>

On a seq gap, or a heartbeat `seq` above your last `seq`, send `snapshot` with the channel in `private`.

```json theme={"dark"}
{
  "nonce": 12,
  "snapshot": {
    "private": ["orders"]
  }
}
```

* After a reconnect, subscribe and take the snapshot. Then diff `open` against your state on `orderId`.
* If you get no `201` for an order, match `clientId` against `open` and `fill` before you resend.

Without a connection, `GET /v3/account/orders` and `GET /v3/account/positions` return the same snapshots.
Each comes with its `seq` and an `ETag`. A matching `If-None-Match` gets `304`.

## Data on other routes

| Data               | Route                                              |
| ------------------ | -------------------------------------------------- |
| Fees, settlements  | `GET /v3/account/subaccounts/{keyId}/transactions` |
| Filtered positions | `GET /v3/portfolio/positions`                      |
| Balance            | `GET /v3/account/subaccounts/{keyId}/balance`      |
