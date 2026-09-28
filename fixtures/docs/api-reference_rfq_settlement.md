> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Settlement

> How an RFQ parlay grades, and what it pays.

An executed parlay settles as one position.
There's no partial settlement, and we never reprice an RFQ parlay when a leg settles.

## When a parlay settles

<Steps>
  <Step title="Any leg loses">
    The parlay settles as a loss right away, even if other legs haven't graded. You get the whole pot.
  </Step>

  <Step title="Otherwise, a leg is still open">
    The parlay stays open until every leg grades.
  </Step>

  <Step title="Otherwise, every leg has graded">
    The parlay pays out by the scalar described below.
  </Step>
</Steps>

## How each leg counts

Each graded leg has a value from `0` to `1`:

| Leg result | Value                                         |
| ---------- | --------------------------------------------- |
| Win        | `1`                                           |
| Loss       | `0`                                           |
| Void       | The leg's fair market value (FMV), like `0.5` |

A leg's FMV is the price we settle a voided leg at.
A leg never pushes. A voided leg always settles at its FMV.

The scalar is the product of every leg's value.
We round it to three decimals, and it's never below `0.001`.

## What the parlay pays

The pot is the user's stake plus your collateral. It equals the stake divided by your quoted price.

The user gets the pot times the scalar.
You get the rest of the pot.

For example, a \$42 stake at a price of `0.42` makes a \$100 pot.
If one leg voids at `0.5` and the others win, the user gets \$50 and you get \$50.

| Legs                 | Values            | Scalar | Result                        |
| -------------------- | ----------------- | ------ | ----------------------------- |
| Loss, two still open | `0`, —, —         | `0`    | Loss now. You get the pot.    |
| Loss, void, win      | `0`, `0.5`, `1`   | `0`    | Loss. You get the pot.        |
| Win, void, win       | `1`, `0.5`, `1`   | `0.5`  | The user gets half the pot.   |
| Void, void, win      | `0.5`, `0.6`, `1` | `0.3`  | The user gets 30% of the pot. |
| Win, win, win        | `1`, `1`, `1`     | `1`    | The user gets the whole pot.  |
| Win, still open, win | `1`, —, `1`       | —      | Stays open.                   |

A loss always wins out over a void, because its `0` makes the product `0`.

[`GET /rfq/executions`](/api-reference/rfq/executions) reports how each of your parlays settled.

<Note>
  These rules apply from August 20, 2026. Before then, a voided leg refunded the user's whole stake, even when another leg lost.
</Note>
