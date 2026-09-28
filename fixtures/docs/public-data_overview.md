> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Exchange Data

> Two anonymized CSVs a day, published as static files behind a CDN

We publish two anonymized CSV files for every trading day at [data.novig.com](https://data.novig.com):

* **Trades** records every executed trade.
* **Markets** snapshots every market, with its open interest, volume, and OHLC (open, high, low, and close prices).

| Path                                       | Contents                             |
| ------------------------------------------ | ------------------------------------ |
| `/reporting/trade-data/index.json`         | The dates each file is available for |
| `/reporting/trade-data/<date>/trades.csv`  | Every executed trade that date       |
| `/reporting/trade-data/<date>/markets.csv` | Every market that date               |

Each file covers one day, from midnight to midnight Eastern.

Each day publishes early the next morning, around 5 a.m. Eastern.
If a day's trades fail validation, we withhold its trades file rather than publish it incomplete. Its markets file still publishes.

## The manifest lists dates per file

The two files publish independently, so a day whose trades are withheld still gets its market snapshot.
That's why the manifest, `index.json`, lists each file's dates separately:

```json index.json theme={"dark"}
{
  "dates": ["2026-08-06", "2026-08-07"],
  "marketDates": ["2026-08-06", "2026-08-07"]
}
```

`dates` lists the days that have **Trades**.
`marketDates` lists the days that have **Markets**.

Manifests published before the Markets file existed have no `marketDates`.
Read a missing `marketDates` as an empty list.

## Anonymity

Rows identify no trader, wallet, or order.
`COMBO` contract identifiers are unique per trade by design, so you can't link positions across trades.

## Columns and corrections

We may add columns over time, so read the header row rather than assuming column positions.

Files for past dates don't change once published.
The exception is an announced correction, which republishes the affected date in place.
