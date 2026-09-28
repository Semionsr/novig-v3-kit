> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Markets

> One row per market per day: open interest, volume, OHLC

`markets.csv` has one row per market per day, whether or not the market traded.

On any given day, most markets have no activity and report zeros.
The file is a census of what was listed, not of what moved.

```csv markets.csv theme={"dark"}
date,marketId,reportTicker,openInterest,dailyVolume,open,high,low,close,status
2026-08-09,019fddfe…,ATP-FIRST_SET_MONEYLINE,0.00,420.73,50.5,54.5,50.5,51.0,finalized
2026-08-09,019fe4ad…,COMBO,0.00,85.91,20.0,20.0,20.0,20.0,finalized
2026-08-09,019fcbf2…,MLB-AL_CENTRAL_DIVISION_WINNER,9.25,0.00,,,,,active
```

### Which days a market appears

An order-book market appears every day it's listed, traded or not, up to and including the day it settles.
After that it doesn't appear again, because a settled market can no longer change.

A combination appears only on the day it executes.
It trades once and never changes afterward, so republishing it each day would repeat one trade forever.

A combination's `reportTicker` is `COMBO`.
Because it has a single trade, its `open`, `high`, `low`, and `close` are all that one price, and its `openInterest` equals its `dailyVolume`, unless every leg has settled by the end of the day. Then it's `0.00`, like any settled market.

### Columns

<ResponseField name="date" type="string">
  The trading day the row describes, as `YYYY-MM-DD`, from midnight to midnight Eastern.
</ResponseField>

<ResponseField name="marketId" type="string">
  The market the row describes.
  It's the same identifier as `marketId` in `trades.csv`, so you can join the two files on it.
</ResponseField>

<ResponseField name="reportTicker" type="string">
  The product family the market belongs to: a sport and a bet type, like `MLB-SPREAD`.
  Every combination reads `COMBO`.
  Group by this column to total open interest or volume per product.
</ResponseField>

<ResponseField name="openInterest" type="string">
  The contracts outstanding at the close of the day, counted across every day the market has traded, not just this one.
  A holder with offsetting positions on both sides counts only for the difference, and each contract counts once, not once per side.
  A market that has settled by the end of the day reports `0.00`. For an order-book market, that day is its last appearance. A combination appears only on the day it executes, so it reports `0.00` only if it settles that same day.
</ResponseField>

<ResponseField name="dailyVolume" type="string">
  The contracts traded during this day alone.
  A market can have open interest with no volume, which means it traded on an earlier day and those positions are still open.
</ResponseField>

<ResponseField name="open" type="string">
  The first price traded during the day, in cents to one decimal, from `0.0` to `100.0`.
  It's empty if the market didn't trade that day, which isn't the same as trading at zero.
  It's never carried forward from an earlier session.
</ResponseField>

<ResponseField name="high" type="string">
  The highest price traded during the day, in cents.
  It's empty on a day with no trades.
</ResponseField>

<ResponseField name="low" type="string">
  The lowest price traded during the day, in cents.
  It's empty on a day with no trades.
</ResponseField>

<ResponseField name="close" type="string">
  The last price traded during the day, in cents.
  It's empty on a day with no trades.
</ResponseField>

<ResponseField name="status" type="active | closed | determined | finalized">
  `active` accepts orders.
  `closed` has stopped trading and awaits a result.
  `determined` has a known result that isn't paid out yet.
  `finalized` has settled.
</ResponseField>

<Note>
  `openInterest` and `dailyVolume` are in contracts, where one contract pays \$1, with two decimal places.
  Prices are in cents with one decimal place, because fills don't land on whole-cent ticks: a `close` of `47.5` is a probability of 0.475.
</Note>
