> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Webhook endpoints

> The /quote, /confirm, and /ping endpoints your pricer serves.

<Note>
  Webhooks are one of two ways to price RFQs. The [maker WebSocket](/api-reference/rfq/websocket) carries the same rounds over one outbound connection, with no public endpoint and no signature to check.
</Note>

Your pricer serves three endpoints under the base URL you [register](/api-reference/rfq/registration).
We call them, and you answer.

| Endpoint                     | When we call it         | Time to answer |
| ---------------------------- | ----------------------- | -------------- |
| `POST {webhook_url}/quote`   | For every RFQ           | 3 seconds      |
| `POST {webhook_url}/confirm` | When your quote wins    | 1 second       |
| `POST {webhook_url}/ping`    | When you ask for a ping | 3 seconds      |

Every request has a JSON body and an `X-Novig-Signature` header.
Check the signature before you trust the body. [Webhook signing](/api-reference/rfq/signing) shows how.

## Quote an RFQ

We call `/quote` for every RFQ, with the outcomes the taker wants to combine.
You answer with a price and the largest wager you'll take at that price.

### Request body

```json theme={"dark"}
{
  "rfq_id": "9b1d76e0-2fa9-0c1d-8e74-b3a5f6c218e0",
  "outcome_ids": [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222"
  ],
  "timestamp": "2026-04-29T18:42:11.123Z",
  "min_wager": "50.00"
}
```

| Field         | Type                  | Holds                                      |
| ------------- | --------------------- | ------------------------------------------ |
| `rfq_id`      | UUID string           | Our ID for the RFQ                         |
| `outcome_ids` | array of UUID strings | One outcome ID per leg, in request order   |
| `timestamp`   | RFC 3339 string       | When we created the RFQ                    |
| `min_wager`   | string, optional      | The smallest stake the taker wants covered |

We send the same `rfq_id` again on `/confirm`.
[Universe model](/api/concepts/universe-model#outcome) explains outcome IDs.
`GET /rfq/executions` returns the same IDs sorted by outcome ID, not in request order.

We leave out `min_wager` when the taker didn't set one.
We never pick a quote whose `max_wager` is below `min_wager` or below the platform minimum of 10.00, whichever is higher.

### Response body

```json theme={"dark"}
{
  "price": 0.45,
  "max_wager": "250.00",
  "quote_id": "pricer-quote-xyz"
}
```

| Field       | Type                    | Holds                                              |
| ----------- | ----------------------- | -------------------------------------------------- |
| `price`     | number, between 0 and 1 | Your price, as a probability                       |
| `max_wager` | string                  | The largest taker stake you'll take, in Novig Cash |
| `quote_id`  | string, optional        | Your own ID for the quote                          |

A `price` of `0.45` means the taker stakes \$0.45 for each \$1.00 of payout.
We round `price` to the nearest 0.001, from `0.001` to `0.999`.
The order book's tick sizes don't apply to RFQ quotes.

Send `max_wager` as a JSON string to keep its precision.

`quote_id` can be up to 256 bytes.
We send it back as `external_flag` on `/confirm`.

<Note>
  A quote has no expiry field. We set its lifetime when the auction closes: 30 seconds before the game and 10 seconds for a live market.
</Note>

### When we drop your quote

<Warning>
  We wait 3 seconds for quotes. We drop a response that arrives later, and the taker never sees it.
</Warning>

We also drop your quote when:

* Your response has a status other than 2xx.
* The body isn't valid JSON.
* `price` rounds to 0 or 1, or falls outside that range.
* `max_wager` is 0 or less.
* `quote_id` is longer than 256 bytes.

When we drop a quote, the taker doesn't see it.
You lose that trade, and nothing else happens.

### Decline an RFQ

Return `204 No Content` to pass on an RFQ.
We record a 204 as a deliberate pass.
An error or a timeout also drops your quote, but it looks like a broken pricer.

## Confirm a trade

If your quote wins, we call `/confirm` just before we write the trade.
It carries the taker's actual wager, which is never more than your `max_wager`.
This is your last chance to back out.

<Warning>
  You have 1 second to answer. If you haven't answered by then, we reject the trade. An early answer waits for the full second, so a fast answer gains nothing.
</Warning>

### Request body

```json theme={"dark"}
{
  "rfq_id": "9b1d76e0-2fa9-0c1d-8e74-b3a5f6c218e0",
  "wager": "100.00",
  "price": "0.45",
  "external_flag": "pricer-quote-xyz"
}
```

| Field           | Type             | Holds                                      |
| --------------- | ---------------- | ------------------------------------------ |
| `rfq_id`        | UUID string      | The `rfq_id` from the `/quote` request     |
| `wager`         | string           | The taker's stake, in Novig Cash           |
| `price`         | string           | The price we selected, which is your price |
| `external_flag` | string, optional | The `quote_id` you sent on `/quote`        |

We only call the winning pricer, so `price` is always yours.
We leave out `external_flag` when you sent no `quote_id`. Don't expect a `null`.

### Response body

```json theme={"dark"}
{
  "confirmed": true
}
```

| Field       | Type              | Holds                                            |
| ----------- | ----------------- | ------------------------------------------------ |
| `confirmed` | boolean, required | `true` to accept the trade, `false` to reject it |

When you reject, we write nothing and the parlay is rejected.

<Warning>
  Always include `confirmed`. A response without it, a non-2xx status, or an invalid body rejects the trade, just like `false`.
</Warning>

## Answer a ping

We call `/ping` only when you call [`POST /rfq/pricer/ping`](/api-reference/rfq/registration#test-your-webhook).
It checks that we can reach you and that your signature check works.
It isn't part of trading and carries no quote.

### Request body

```json theme={"dark"}
{
  "pricer_id": "0193abcd-0000-7000-8000-000000000001",
  "timestamp": "2026-04-29T18:42:11.123Z"
}
```

| Field       | Type            | Holds                             |
| ----------- | --------------- | --------------------------------- |
| `pricer_id` | UUID string     | Your pricer ID, from registration |
| `timestamp` | RFC 3339 string | When we sent the ping             |

Check the signature exactly as you do on `/quote` and `/confirm`.

### Response

Return any 2xx status. No body is required.

We report your status as `ok` and `status` in the [ping result](/api-reference/rfq/registration#test-your-webhook).
A non-2xx status, a rejected signature, or an unreachable host all show up as a failed ping.

## Types and encoding

* `max_wager`, `wager`, and the `/confirm` `price` are JSON strings, not numbers.
* The `/quote` response `price` is a JSON number between 0 and 1.
* UUIDs are lowercase strings with hyphens.
