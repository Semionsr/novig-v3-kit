> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Executions

> Watch RFQ executions live, reconcile the ones you won, and check your open collateral.

export const HEARTBEAT = "15 s";

export const LEGACY_QA_WS_HOST = "wss://api-qa.novig.us";

export const LEGACY_QA_HOST = "https://api-qa.novig.us";

export const HOST_VAR = "NOVIG_HOST";

export const PROD_WS_HOST = "wss://api.novig.com";

export const PROD_HOST = "https://api.novig.com";

On the webhook endpoints, we call you.
On the three endpoints here, you call us to see what executed.

| Endpoint                   | What you get                                      |
| -------------------------- | ------------------------------------------------- |
| `GET /rfq/executions`      | The RFQs you won, and how they settled            |
| `GET /rfq/executions/feed` | A live WebSocket tape of every RFQ execution      |
| `GET /rfq/collateral`      | The total collateral you have in open RFQ parlays |

Use the feed to track executions as they happen.
Use the listing to reconcile your fills and catch up on anything you missed.
Use the collateral total to see how much of your balance your open parlays hold.
None of these endpoints affects pricing, winner selection, or settlement.

<Info>
  RFQ fills aren't in the order-book fills listing, [List fills](/api-reference/positions/get-all-my-fills). Only `GET /rfq/executions` lists the RFQs you won.
</Info>

## Authenticate

All three endpoints take the OAuth 2.0 client-credentials token you use for the rest of the API.
[Authentication](/api-reference/authentication) shows how to get one.
Send it in the `Authorization` header as a bearer token.

| Environment | Base URL                      |
| ----------- | ----------------------------- |
| Production  | <code>{PROD_HOST}</code>      |
| QA          | <code>{LEGACY_QA_HOST}</code> |

The examples read the host from <code>{HOST_VAR}</code>.
Set it once:

```bash theme={"dark"}
export NOVIG_HOST=https://api.novig.com
```

## List your executions

`GET /rfq/executions` returns the RFQs you priced and won, newest first.
Your account must have a registered pricer, or the call returns `403`.
[Registration](/api-reference/rfq/registration) shows how to register one.

```bash theme={"dark"}
curl "$NOVIG_HOST/rfq/executions" \
  --header "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Query parameters

Every parameter is optional.
With none, you get your 500 newest executions.

| Parameter | Type    | Default | What it does                                                          |
| --------- | ------- | ------- | --------------------------------------------------------------------- |
| `status`  | string  | all     | Returns only `open` or only `settled` executions                      |
| `limit`   | integer | `500`   | Sets the page size, at most `500`                                     |
| `offset`  | integer | `0`     | Skips this many executions, counting from the newest, at most `50000` |

A `limit` above 500 or an `offset` above 50,000 returns `400 Bad Request`.

### Page through your history

Keep `limit` fixed and raise `offset` by `limit` each time.
Stop when a page comes back with fewer than `limit` items, or empty.

```bash theme={"dark"}
curl "$NOVIG_HOST/rfq/executions?limit=100&offset=200" \
  --header "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Executions sort by `executed_at`, then by `rfq_id`, both newest first.
Two executions with the same timestamp keep the same order on every call.

A new execution during your walk pushes every older row one place down.
You can then see a row twice, so deduplicate on `rfq_id`.

An empty array means you've paged past the end, or you haven't won an RFQ yet.

### Response

`200 OK` with a JSON array, newest first:

```json theme={"dark"}
[
  {
    "rfq_id": "0193abcd-0000-7000-8000-000000000001",
    "parlay_id": "0193abcd-0000-7000-8000-0000000000aa",
    "wager": "42.00",
    "price": "0.42",
    "liability": "58.00",
    "status": "settled",
    "result": "fmv",
    "fmv_value": "0.541",
    "outcome_ids": [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222"
    ],
    "executed_at": "2026-06-16T22:13:20Z"
  }
]
```

| Field         | Type                  | Meaning                                         |
| ------------- | --------------------- | ----------------------------------------------- |
| `rfq_id`      | UUID string           | The RFQ you won                                 |
| `parlay_id`   | UUID string           | The parlay the RFQ filled                       |
| `wager`       | decimal string        | The user's stake that filled                    |
| `price`       | decimal string        | The price you quoted and won at                 |
| `liability`   | decimal string        | Your collateral on this parlay                  |
| `status`      | string                | `open` until the parlay settles, then `settled` |
| `result`      | string                | `win`, `loss`, `push`, or `fmv`                 |
| `fmv_value`   | decimal string        | The settlement value, when `result` is `fmv`    |
| `outcome_ids` | array of UUID strings | The parlay's legs, sorted by outcome ID         |
| `executed_at` | RFC 3339 string       | When the trade executed, in UTC                 |

We send money and prices as strings to keep their precision.

`result` appears only once `status` is `settled`.
`fmv_value` appears only when `result` is `fmv`.
`push` appears only on parlays that settled before August 20, 2026.
[Settlement](/api-reference/rfq/settlement) explains each result.

`outcome_ids` is sorted by ID, while the `rfq_created` event lists the legs in request order.
Only this listing carries the legs. The feed leaves them out.

`executed_at` never changes, and it matches the feed's value for the same `rfq_id`.

## Watch the live feed

`GET /rfq/executions/feed` is a WebSocket that sends every successful RFQ execution on Novig, not just yours.

| Environment | URL                                                  |
| ----------- | ---------------------------------------------------- |
| Production  | <code>{PROD_WS_HOST}/rfq/executions/feed</code>      |
| QA          | <code>{LEGACY_QA_WS_HOST}/rfq/executions/feed</code> |

Send your bearer token in the `Authorization` header of the upgrade request.
You don't need a registered pricer to open the feed.

The feed never says which LP won.
To see only your own fills, use `GET /rfq/executions`.

### Message format

Each execution arrives as one text frame:

```json theme={"dark"}
{
  "event": "rfq_executed",
  "data": {
    "offset": 12345,
    "rfq_id": "0193abcd-0000-7000-8000-000000000001",
    "wager": "50",
    "price": "0.50",
    "executed_at": "2026-06-16T22:13:20Z"
  }
}
```

| Field              | Type            | Meaning                                          |
| ------------------ | --------------- | ------------------------------------------------ |
| `event`            | string          | The frame type, always `rfq_executed` today      |
| `data.offset`      | integer         | The frame's place in the feed, for gap detection |
| `data.rfq_id`      | UUID string     | The executed RFQ                                 |
| `data.wager`       | decimal string  | The user's stake                                 |
| `data.price`       | decimal string  | The execution price                              |
| `data.executed_at` | RFC 3339 string | When the trade executed, in UTC                  |

Branch on `event`, because we may add frame types later.
The feed has no `outcome_ids`. Get the legs from `GET /rfq/executions`.

### Stay connected

<Steps>
  <Step title="Expect no replay">
    You get only executions that happen after you connect. Catch up on earlier ones from `GET /rfq/executions`.
  </Step>

  <Step title="Answer the heartbeat">
    We send a WebSocket ping every {HEARTBEAT}. Standard clients answer with a pong on their own.
  </Step>

  <Step title="Watch for gaps">
    `offset` goes up by one per frame. A jump, like `41` to `44`, means you missed frames.
  </Step>

  <Step title="Reconnect with backoff">
    On each reconnect, compare the first `offset` with the last one you processed.
  </Step>
</Steps>

To fill a gap, page `GET /rfq/executions` from the newest execution until you reach an `rfq_id` you already hold.
Then go back to the live feed.

<Warning>
  Don't pass a feed `offset` as the listing's `offset` parameter. The listing's `offset` counts rows, so a feed value skips to an arbitrary point in your history.
</Warning>

## Check your open collateral

`GET /rfq/collateral` returns the total collateral you have in RFQ parlays that filled and haven't settled.
Your account must have a registered pricer, or the call returns `403`.

```bash theme={"dark"}
curl "$NOVIG_HOST/rfq/collateral" \
  --header "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

The endpoint takes no parameters.

### Response

`200 OK` with a JSON object:

```json theme={"dark"}
{
  "rfq_collateral": "300.00",
  "rfqs_filled": 2,
  "timestamp": "2026-09-23T21:36:32.123456Z"
}
```

| Field            | Type            | Meaning                                 |
| ---------------- | --------------- | --------------------------------------- |
| `rfq_collateral` | decimal string  | Your total collateral in open parlays   |
| `rfqs_filled`    | integer         | How many open parlays that total covers |
| `timestamp`      | RFC 3339 string | When we computed the total, in UTC      |

A parlay's collateral is the pot minus the user's stake.
The pot is the stake divided by your quoted price, rounded down to the cent.
It's the same value as `liability` on `GET /rfq/executions`.

A parlay leaves the total as soon as it settles, whatever the result.
With no open parlays, you get `"0"` and `0`.

## Which endpoint to use

| Task                                      | Endpoint                                                |
| ----------------------------------------- | ------------------------------------------------------- |
| React to executions as they happen        | `GET /rfq/executions/feed`                              |
| Reconcile or catch up on your fills       | `GET /rfq/executions`                                   |
| See how your executions settled           | `GET /rfq/executions`                                   |
| Get a parlay's legs                       | `GET /rfq/executions`                                   |
| See your total collateral in open parlays | `GET /rfq/collateral`                                   |
| Reconcile order-book fills                | [List fills](/api-reference/positions/get-all-my-fills) |

Most LPs keep the feed open for live prints.
Then they call the listing now and then, and after any gap, to confirm they have every RFQ they won.
