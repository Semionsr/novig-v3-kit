> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Connection

> The connection that carries every channel: verbs, nonces, seq, and gaps.

export const HEARTBEAT = "15 s";

export const WS_UPGRADE_COST = 32;

export const STREAM_CAPACITY = 512;

export const WEIGHT_BBO = 8;

export const WEIGHT_POSITIONS = 1;

export const WEIGHT_ORDERS = 1;

export const WEIGHT_BOOK = 16;

export const WEIGHT_TRADES = 4;

export const WEIGHT_LIFECYCLE = 1;

Every channel runs over one websocket connection.

| Detail   | Value                                                        |
| -------- | ------------------------------------------------------------ |
| Route    | `GET /v3/ws`                                                 |
| Key      | `trading` or `trading::read`                                 |
| Throttle | [`stream`](/api/throttling)                                  |
| Cost     | <code>{WS_UPGRADE_COST} /request</code>, then `weight /pair` |
| Reply    | <span className="st st-info">101</span>                      |

## Verbs

You send a verb to tell us what to do on the connection.

| Verb            | Does                       | Reply    |
| --------------- | -------------------------- | -------- |
| `subscribe`     | Sets a channel per subject | Snapshot |
| `unsubscribe`   | Drops subjects             | Ack      |
| `snapshot`      | Returns state and `seq`    | Snapshot |
| `status`        | Lists your subscriptions   | Ack      |
| `query_markets` | Pages open markets         | Ack      |
| `query_events`  | Pages open events          | Ack      |

`subscribe` also adds channels to `private`.

`snapshot` returns the current state and its `seq`, and leaves your subscriptions unchanged.

`query_markets` returns one page of open markets, filtered the same way as `GET /v3/catalog/markets`.
`query_events` returns one page of open events, filtered the same way as `GET /v3/catalog/events`.
Both debit the `read` throttle.

## Choose what to subscribe to

`subscribe` and `snapshot` name a selection in three optional fields.
An empty selection gets `EMPTY_SELECTION`.

```json theme={"dark"}
{
  "nonce": 1,
  "subscribe": {
    "markets": {
      "6f9619ff-…": "book"
    },
    "events": {
      "110e8400-…": "lifecycle"
    },
    "private": ["orders", "positions"]
  }
}
```

| Field     | Takes              | Covers                        |
| --------- | ------------------ | ----------------------------- |
| `markets` | ID → channel       | One market                    |
| `events`  | ID → channel       | Every market of the event     |
| `private` | A list of channels | Your own orders and positions |

An `events` selection also covers markets that open later.

`unsubscribe` takes a list of subject strings instead.

```json theme={"dark"}
{
  "nonce": 9,
  "unsubscribe": [
    "market:6f9619ff-…",
    "event:110e8400-…",
    "PRIVATE"
  ]
}
```

`PRIVATE` drops every private channel.
To drop just one, unsubscribe `PRIVATE`, then subscribe to the channel you keep.

## Channels and cost

| Channel     | Cost                                  | Includes    | Named in           |
| ----------- | ------------------------------------- | ----------- | ------------------ |
| `lifecycle` | <code>{WEIGHT_LIFECYCLE} /pair</code> | —           | `markets` `events` |
| `trades`    | <code>{WEIGHT_TRADES} /pair</code>    | `lifecycle` | `markets` `events` |
| `bbo`       | <code>{WEIGHT_BBO} /pair</code>       | `lifecycle` | `markets` `events` |
| `book`      | <code>{WEIGHT_BOOK} /pair</code>      | `lifecycle` | `markets` `events` |
| `orders`    | <code>{WEIGHT_ORDERS} /pair</code>    | —           | `private`          |
| `positions` | <code>{WEIGHT_POSITIONS} /pair</code> | —           | `private`          |

A pair is one subject on one channel.
A subscribe to 100 markets on `book` weighs <code>{100 * WEIGHT_BOOK} /request</code>.

We charge at most the `stream` capacity of {STREAM_CAPACITY} tokens.
A request above that cap passes only when the throttle is full, and it empties the throttle.

* `snapshot` costs the same as `subscribe`.
* `unsubscribe` costs 1 token per subject.
* `status` costs 1 token.
* A subject we can't resolve still costs tokens.

## Nonces

A nonce is the number you put on each request.

* Start nonces at 1.
* Send them in increasing order within a connection. Gaps are allowed.
* The largest nonce is $2^{53}-1$.

We answer a repeated or lower nonce with `STALE_NONCE`.

A frame that fails to parse or hits the throttle gets a reply with no nonce.
That frame leaves your newest nonce unchanged.

## Each subscription starts with a snapshot

A snapshot is the current state of what you subscribed to.
Deltas, the changes after it, follow.

We number the messages on each market channel **per market**, and on `orders` and `positions` **per subaccount**.
That number is `seq`.

The snapshot carries the `seq` at which we took it.
The first delta carries the next `seq`, with no gap.

Changes that happen together arrive in one message.
Apply each batch atomically.

```json snapshot theme={"dark"}
{
  "ts": 1757894400123,
  "nonce": 1,
  "subscribed": {
    "markets": {
      "6f9619ff-…": "book"
    },
    "events": {},
    "private": []
  },
  "snapshot": {
    "6f9619ff-…": {
      "eventId": "110e8400-…",
      "book": {
        "seq": 48120,
        "orders": {}
      },
      "lifecycle": {
        "seq": 3,
        "status": "OPEN"
      }
    }
  }
}
```

```json delta theme={"dark"}
{
  "ts": 1757894400456,
  "delta": {
    "6f9619ff-…": {
      "eventId": "110e8400-…",
      "book": {
        "seq": 48121,
        "deltas": []
      }
    }
  }
}
```

## Gaps

A gap is a skipped `seq`. It means you missed a message.

<svg className="sd" viewBox="0 0 640 240" role="img" aria-label="Gap recovery. The exchange sends delta seq 48122. The next delta to arrive is 48124, so 48123 is missing, and the client buffers 48124. The client sends snapshot for the market on book. The exchange replies with a snapshot at seq 48125. The client drops buffered deltas at or below 48125 and replays the rest.">
  <path className="sd-edge" d="M80,42 V230" />

  <path className="sd-edge" d="M560,42 V230" />

  <path className="sd-edge" d="M560,76 H84" />

  <path className="sd-head" d="M84,76 L91,72.5 L91,79.5 z" />

  <g><text className="sd-label" x="320" y="70" textAnchor="middle">delta seq 48122</text></g>
  <g><text className="sd-label" x="90" y="108" textAnchor="start">next delta 48124: 48123 is missing, buffer 48124</text></g>

  <path className="sd-edge" d="M80,140 H556" />

  <path className="sd-head" d="M556,140 L549,143.5 L549,136.5 z" />

  <g><text className="sd-label" x="320" y="134" textAnchor="middle">snapshot \{ markets: \{ "6f9619ff-…": "book" } }</text></g>

  <path className="sd-edge" d="M560,176 H84" />

  <path className="sd-head" d="M84,176 L91,172.5 L91,179.5 z" />

  <g><text className="sd-label" x="320" y="170" textAnchor="middle">snapshot @ seq 48125</text></g>
  <g><text className="sd-label" x="90" y="210" textAnchor="start">drop buffered deltas ≤ 48125, replay the rest</text></g>
  <g className="sd-box sd-cream"><rect x="20" y="10" width="120" height="32" rx="2" /><circle cx="131" cy="19" r="2.5" /><text x="30" y="30">CLIENT</text></g>
  <g className="sd-box sd-fill"><rect x="500" y="10" width="120" height="32" rx="2" /><circle cx="611" cy="19" r="2.5" /><text x="510" y="30">EXCHANGE</text></g>
</svg>

<p className="tree-foot">Arrows are messages, top to bottom in time. After the new snapshot, drop the buffered deltas it already covers.</p>

* A market `seq` is per market, per channel. There's no global sequence.
* A private `seq` is per subaccount, per channel. It's independent of every market `seq`.
* To recover from a gap, send `snapshot`. It leaves your subscriptions unchanged.
* After a reconnect, subscribe again. The reply carries the snapshot.
* Never compare a `seq` across connections.

A market that opens under an `events` subscription arrives with no snapshot. That's not a gap.
Its first delta is `OPEN`, and its `book`, `bbo`, and `trades` channels start at seq 0, so each one's first delta carries seq 1.

## Why a connection closes

| Code   | Reason                     | Do                            |
| ------ | -------------------------- | ----------------------------- |
| `1008` | `SLOW_CONSUMER`            | Reconnect and subscribe again |
| `1008` | A `451` geolocation `code` | Open the app, then reconnect  |
| none   | —                          | Answer every Ping             |

* `SLOW_CONSUMER` means a write to you stalled for {HEARTBEAT}.
* A geolocation close means the companion check refused you while you were connected: your last device geolocation is missing, failed, named no region, or came from a restricted state. The reason is the [`451` code](/api/errors#451-geolocation-unavailable). A stale geolocation never closes a socket.
* If you send no Pong between two of our Pings, we drop the connection without a close frame. Your client usually reports `1006`. We ping every {HEARTBEAT}.
