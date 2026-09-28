> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Lifecycle

> Market status transitions, and the two that void your orders.

export const WEIGHT_LIFECYCLE = 1;

The `lifecycle` channel reports each change to a market's status.
It costs {WEIGHT_LIFECYCLE} token per market, and `trades`, `bbo`, and `book` include it.

On an `event:` subject, it also covers markets that open later.

```json snapshot theme={"dark"}
"lifecycle": {
  "seq": 12,
  "status": "OPEN"
}
```

```json delta theme={"dark"}
"lifecycle": {
  "seq": 13,
  "deltas": ["GOLIVE"]
}
```

| Transition | Means                      | Status after |
| ---------- | -------------------------- | ------------ |
| `OPEN`     | Accepting orders           | `OPEN`       |
| `CLOSE`    | Stopped accepting orders   | `CLOSED`     |
| `GRADE`    | Graded, payouts determined | `SETTLED`    |
| `START`    | The event started          | —            |
| `END`      | The event ended            | —            |
| `GOLIVE`   | Live                       | —            |
| `UNLIVE`   | Left live play             | —            |

## Live play and your orders

* `GOLIVE` voids every resting order and turns taker fees on.
* `UNLIVE` drains the book again and turns taker fees off.

Taker fees switch on at `GOLIVE` only for a market whose `fee.charged` is `WHEN_LIVE`.
An `ALWAYS` market charges fees in every phase.
See [Trading fees](/api/concepts/fees).

This is one market that goes live twice:

| Phase    | What happens                 |
| -------- | ---------------------------- |
| Pregame  | Orders rest                  |
| `GOLIVE` | Orders voided, taker fees on |
| In play  | Orders rest                  |
| `UNLIVE` | Book drained, taker fees off |
| `GOLIVE` | Orders voided, taker fees on |

<Warning>
  `GOLIVE` and `UNLIVE` repeat on a delay, a review, or a stoppage. Act on each transition as it arrives, and don't assume a fixed number of them.
</Warning>
