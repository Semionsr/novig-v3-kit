> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Trading fees

> Takers pay a fee on each fill. Game markets and futures markets have separate schedules.

export const FUTURES_MAKER_CREDIT = "0.7";

export const FUTURES_COEFFICIENT = "0.06";

export const GAME_MAKER_CREDIT = "0.5";

export const GAME_COEFFICIENT = "0.03";

The taker pays a fee on each fill.
The taker is the side whose order matched a resting order, and the maker is the side whose order was resting.
A maker never pays.

$$
\text{Fee} = c \cdot P\,(1 - P) \cdot N \cdot 1\text{¢}
$$

| Term | Meaning               | Field                    |
| ---- | --------------------- | ------------------------ |
| $P$  | Price of the fill     | `fill.price`             |
| $c$  | Fee coefficient       | `market.fee.coefficient` |
| $N$  | Contracts in the fill | `fill.qty`               |

$P$ is the price the fill executed at, not your limit price.

A winning contract pays full value, 1¢.

The coefficient depends on the market's schedule, below.

## The two fee schedules

| Schedule       | `coefficient`                      | `makerCredit`                       | `charged`   |
| -------------- | ---------------------------------- | ----------------------------------- | ----------- |
| Game market    | <code>{GAME_COEFFICIENT}</code>    | <code>{GAME_MAKER_CREDIT}</code>    | `WHEN_LIVE` |
| Futures market | <code>{FUTURES_COEFFICIENT}</code> | <code>{FUTURES_MAKER_CREDIT}</code> | `ALWAYS`    |

Each market carries its schedule in `fee`:

```json GET /v3/catalog/markets/{id} theme={"dark"}
"fee": {
  "coefficient": "0.06",
  "makerCredit": "0.7",
  "charged": "ALWAYS"
}
```

`WHEN_LIVE` charges the taker only while the event is `OPEN_INGAME`.

`ALWAYS` charges in every phase, because a futures event never goes live.

`makerCredit` is the maker's share of the taker's fee on the same fill.

<Frame caption="Both curves peak at P = 0.50 and fall to zero at the ends. A price of 0.30 costs the same as 0.70.">
  <img src="https://mintcdn.com/novig/JMxNtNU2MGB2KubU/images/fee-curve.svg?fit=max&auto=format&n=JMxNtNU2MGB2KubU&q=85&s=544bc573a77a1104b254eb02db611b85" alt="Taker fee against execution price for 10,000 contracts: a symmetric arc peaking at $0.75 on the game schedule and $1.50 on the futures schedule" width="720" height="268" data-path="images/fee-curve.svg" />
</Frame>

## Which schedule a market is on

| Market type | League                  | Schedule | Charges   |
| ----------- | ----------------------- | -------- | --------- |
| Game line   | any                     | Game     | When live |
| Futures     | `NFL` `MLB` `NCAAF`     | Futures  | Always    |
| Futures     | `PGA` `ATP` `WTA` `UFC` | Game     | Never     |

A futures market settles on a season, not a game.

In `PGA`, `ATP`, `WTA` and `UFC`, a futures market carries no futures fee.
Its event never goes live, so it charges nothing.

Read `fee` from the market. Never work it out from this table.

## Worked examples

Each fill below is a number of contracts at a price.

| Fill                  | Game     | Futures  |
| --------------------- | -------- | -------- |
| 10 000 @ 0.50         | \$0.7500 | \$1.5000 |
| 10 000 @ 0.30 or 0.70 | \$0.6300 | \$1.2600 |
| 10 000 @ 0.10         | \$0.2700 | \$0.5400 |
| 100 @ 0.50            | \$0.0075 | \$0.0150 |

The maker on the other side of the first fill earns a \$0.3750 credit on the game schedule.
On the futures schedule, it earns \$1.0500.

<Warning>
  We decide whether an event is live at match time. A `WHEN_LIVE` market charges fills on the live side of a `GOLIVE`, not the pregame side.
</Warning>

Every `GOLIVE` voids every resting order, and the live window can open more than once.
See [Event lifecycle](/api/concepts/event-lifecycle#event-states).

## Where to read fees

* `GET /v3/catalog/markets/{id}` returns `fee`: the coefficient, the credit, and when it charges.
* `GET /v3/portfolio/fills` returns `fee` on every charged fill, and leaves it out otherwise.
* `GET /v3/account/subaccounts/{keyId}/transactions` returns the ledger rows behind a fee.
* The private stream's `fill` event carries no fee.

A fee rounds half up to the millicent, the same way as a balance.
See [Monetary representations](/api/concepts/money).
