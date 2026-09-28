> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Tape

> Every execution on a market.

export const WEIGHT_TRADES = 4;

The `trades` channel reports every execution on a market.
It costs {WEIGHT_TRADES} tokens per market.
It includes [`lifecycle`](/api/streaming/lifecycle), but not [`book`](/api/streaming/book).

```json snapshot theme={"dark"}
"trades": {
  "seq": 9042,
  "trades": [
    {
      "seq": 9041,
      "deltas": [
        {
          "outcome": "3f2504e0-…",
          "price": "0.665",
          "qty": 40,
          "ts": 1757894399870
        }
      ]
    },
    {
      "seq": 9042,
      "deltas": [
        {
          "outcome": "5a1c9e73-…",
          "price": "0.335",
          "qty": 100,
          "ts": 1757894400120
        }
      ]
    }
  ]
}
```

```json delta theme={"dark"}
"trades": {
  "seq": 9043,
  "deltas": [
    {
      "outcome": "3f2504e0-…",
      "price": "0.670",
      "qty": 60,
      "ts": 1757894400456
    }
  ]
}
```

A trade names its outcome, price, quantity, and engine timestamp.
It doesn't name the orders.

The snapshot holds the last few batches, oldest first. It isn't a history.
For older trades, call `GET /v3/catalog/markets/{id}/trades`.

## Gaps

* For a small gap, take the retained batches after your last `seq`. You don't need to resync.
* For a large gap, [resync](/api/streaming/connection#gaps) as usual.
