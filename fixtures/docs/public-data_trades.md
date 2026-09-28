> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Trades

> Every executed trade, one row per side

### Each row is one side of a trade

Every trade appears once per side.
It has one `TAKER` row, for the order or quote request that executed the trade, and one `MAKER` row for each counterparty.

```csv trades.csv theme={"dark"}
timestamp,outcomeId,marketId,contractSeries,league,marketType,tradeType,legs,cost,qty,side
2026-08-04T17:03:11Z,0b1c…,7f2e…,Basketball Moneyline,NBA,MONEY,STRAIGHT,1,45.5,100,TAKER
2026-08-04T17:03:11Z,44d9…,7f2e…,Basketball Moneyline,NBA,MONEY,STRAIGHT,1,54.5,100,MAKER
2026-08-04T18:41:52Z,9d8c…,9d8c…,Parlay,,,COMBO,3,50,200,TAKER
2026-08-04T18:41:52Z,9d8c…,9d8c…,Parlay,,,COMBO,3,150,200,MAKER
```

<Tip>
  **Working with the data:**

  * To count trades, count the `TAKER` rows.
  * The price one side paid is `cost / qty`, a probability between 0 and 1.
  * The total amount staked is the sum of `cost` over all rows.
  * Notional volume in dollars is the sum of `qty` over the `TAKER` rows.
</Tip>

### Columns

<ResponseField name="timestamp" type="timestamp">
  The execution time, in ISO-8601 (UTC).
</ResponseField>

<ResponseField name="outcomeId" type="string">
  The outcome that traded.
  For a `COMBO`, it's the contract the combination cleared against, which is unique to that trade.
  So you can't use it to group two trades of the same legs.
</ResponseField>

<ResponseField name="marketId" type="string">
  The market of the trade.
  For a `COMBO`, it's the same value as `outcomeId`.
</ResponseField>

<ResponseField name="contractSeries" type="string">
  The product group: a sport and a family, like `Basketball Moneyline`.
  Multi-leg trades read `Parlay`, and an unrecognized sport or family reads `Other`.
  Group by this column to total volume per product.
</ResponseField>

<ResponseField name="league" type="string">
  The league the contract is listed under, like `NBA`.
  It's empty for a `COMBO`.
</ResponseField>

<ResponseField name="marketType" type="string">
  The market type the contract is listed under, like `MONEY`.
  It's empty for a `COMBO`.
</ResponseField>

<ResponseField name="tradeType" type="STRAIGHT | COMBO">
  `STRAIGHT` is a single-outcome trade matched on the order book.
  `COMBO` is a trade on a combination of outcomes, filled against a requested quote.
</ResponseField>

<ResponseField name="legs" type="integer">
  The number of outcomes the contract combines.
  Every `STRAIGHT` trade has `1`.
</ResponseField>

<ResponseField name="cost" type="string">
  The dollars this side staked.
  Together, the two sides of a trade stake its notional value.
</ResponseField>

<ResponseField name="qty" type="string">
  The quantity in contracts, where one contract pays \$1.
  It can be a fraction.
</ResponseField>

<ResponseField name="side" type="TAKER | MAKER">
  The side of the trade this row reports.
</ResponseField>

<Note>
  `cost` and `qty` are strings with full numeric precision and no trailing zeros.
  **Fees are not included** in `cost` on either side.
</Note>
