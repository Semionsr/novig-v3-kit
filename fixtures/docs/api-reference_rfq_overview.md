> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> How liquidity providers price Novig parlays through RFQs.

A request for quote (RFQ) is how we get a price for a parlay.
A parlay is one bet on two or more outcomes, called legs, that must all win.

When a user asks for a parlay, we send an RFQ to every registered liquidity provider (LP).
We pick the best quote and ask its LP to confirm before the trade executes.

This section is for LPs who want to receive RFQs and answer them with prices.
RFQs are opt-in. Registering doesn't change your order-book trading on `/nbx/v2`.

<Note>
  We send RFQs only for parlays of two or more legs. [Eligibility](/api-reference/rfq/eligibility) lists which legs can combine.
</Note>

## How a round works

Your pricer is the service that answers RFQs for your LP account.

<Steps>
  <Step title="A user asks for a parlay">
    The user sends a list of `outcomeIds`. We check the legs, create an `rfq_id`, and store the RFQ.
  </Step>

  <Step title="We send the RFQ to every pricer">
    Each registered pricer gets the RFQ over the transport it chose. The auction stays open for 3 seconds.
  </Step>

  <Step title="You answer with a price">
    Return a price and a `max_wager`, the largest stake you'll take. You can also decline.
  </Step>

  <Step title="We pick the winner">
    The lowest price wins, because it pays the user the most. A tie goes to the larger `max_wager`.
  </Step>

  <Step title="The winner confirms">
    When the user accepts, we ask you to confirm the actual wager at your price. You have 1 second to answer, called the last look.
  </Step>

  <Step title="The parlay settles">
    The parlay settles as one position when its legs grade. [Settlement](/api-reference/rfq/settlement) explains the payout.
  </Step>
</Steps>

We drop an answer in these cases:

* It's malformed.
* Its `max_wager` is zero or less.
* It arrives after the 3-second auction closes.

We also pass over a quote in these cases:

* Its `max_wager` is below the user's `min_wager`, or below \$10, whichever is higher.
* Your LP account's cash balance can't cover your collateral for the full `max_wager`.

Your collateral is the money you put up against the user's stake.

We ask for the confirm over the transport that carried your quote.
If you confirm in time, the trade executes.
If you reject or miss the last look, it doesn't.

## Choose a transport

You can price over a WebSocket, over webhooks, or over both.

| Transport                                 | You run                 | We authenticate you with           |
| ----------------------------------------- | ----------------------- | ---------------------------------- |
| [WebSocket](/api-reference/rfq/websocket) | One outbound connection | Your bearer token, once at connect |
| [Webhooks](/api-reference/rfq/webhooks)   | A public HTTPS service  | A signature on each request        |

Both use the same 3-second auction and 1-second last look.
Pick the WebSocket if you can't expose a public endpoint.
Pick webhooks if you already run a service.

If you use both, each RFQ arrives on both.
We keep your first quote in a round and ignore any later one.
We then confirm on the transport that carried that quote.

## Webhook endpoints

For webhooks, you run three `POST` endpoints under one base URL.

| Endpoint                  | What it does                          |
| ------------------------- | ------------------------------------- |
| `POST {base_url}/quote`   | Returns a price for an RFQ            |
| `POST {base_url}/confirm` | Approves or rejects the wager         |
| `POST {base_url}/ping`    | Answers our test request with any 2xx |

We add `/quote`, `/confirm`, and `/ping` to the base URL you register.
The base can include a path, like `https://pricer.example.com/novig`.

Each request carries an `X-Novig-Signature` header.
[Webhook signing](/api-reference/rfq/signing) shows how to check it.

## Get started

Every pricer registers first, with `POST /rfq/pricer`. Registration is self-serve.

* Register with a `webhookUrl` to get webhooks. The response holds your shared secret.
* Register without a `webhookUrl` to use only the WebSocket.
* Test your webhook with `POST /rfq/pricer/ping` before live traffic arrives.

[Registration](/api-reference/rfq/registration) walks through each call.
