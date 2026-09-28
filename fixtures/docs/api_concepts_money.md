> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Monetary representations

> Prices and balances are strings. Quantities are whole numbers.

| Value    | Format                       | Example        |
| -------- | ---------------------------- | -------------- |
| Price    | Decimal string, three places | `"0.665"`      |
| Quantity | Whole number of contracts    | `110`          |
| Balance  | Decimal string, five places  | `"1234.50000"` |

One contract pays full value, 1¢, if its outcome wins.
A price is a probability, so one contract at `"0.665"` costs 0.665¢.

$$
\text{cost} = P \cdot N \cdot 1\text{¢} \qquad \text{payout} = N \cdot 1\text{¢}
$$

So 110 contracts at `"0.665"` cost \$0.73150 and pay \$1.10000 if they win.
Your counterparty buys the opposite outcome at $1 - P$.

## The price grid

Not every three-place price is allowed.
The grid has 279 prices in three bands, and we reject a price off the grid with `INVALID_PRICE`.

| Band            | Step    | Prices | Step per contract |
| --------------- | ------- | ------ | ----------------- |
| `0.001`–`0.050` | `0.001` | 50     | \$0.00001         |
| `0.055`–`0.945` | `0.005` | 179    | \$0.00005         |
| `0.950`–`0.999` | `0.001` | 50     | \$0.00001         |

`0.665` is on the grid, but `0.667` isn't.
Every price's complement is on the grid too: the complement of `0.665` is `0.335`.

Snap a model price down to the grid before you send it.
Every order buys, so snapping down never makes you pay more than you meant.

The function below counts a price in thousandths.
A price is on the grid when `snap_down` returns it unchanged.

```rust theme={"dark"}
fn snap_down(milli: u32) -> Option<u32> {
    match milli {
        1..=50 | 950..=999 => Some(milli),
        51..=949 => Some(milli - milli % 5),
        _ => None,
    }
}
```

## Precision

* A double can't hold `0.665` exactly. Parse money as a decimal and send it as a string, never through a `float`.
* We store money to \$0.00001, rounding half up, and round nowhere else. Fees use the same precision, with no one-cent minimum.
