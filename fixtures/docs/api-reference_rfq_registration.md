> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Register a pricer

> Register your pricer, get your shared secret, and test your webhook.

export const LEGACY_QA_HOST = "https://api-qa.novig.us";

export const HOST_VAR = "NOVIG_HOST";

export const PROD_HOST = "https://api.novig.com";

You register your pricer yourself, with one call to `POST /rfq/pricer`.
A pricer is the service that quotes RFQs for your LP account.

Register before you price over either transport.
The [WebSocket](/api-reference/rfq/websocket) refuses a connection from an account with no pricer, and the [webhook](/api-reference/rfq/webhooks) needs a registered URL.

| Call                    | What it does                                     |
| ----------------------- | ------------------------------------------------ |
| `POST /rfq/pricer`      | Registers your pricer or changes its webhook URL |
| `GET /rfq/pricer`       | Returns your current registration                |
| `POST /rfq/pricer/ping` | Sends a signed test request to your webhook      |

## Before you start

<Steps>
  <Step title="Become an LP">
    Registration works only for an LP account. If you aren't one yet, follow [LP Onboarding](/lp-onboarding).
  </Step>

  <Step title="Expose your webhook">
    A webhook URL must be reachable from the public internet. For local work, register the `https` URL of a tunnel like ngrok.
  </Step>
</Steps>

A pricer that uses only the WebSocket skips the second step. It needs no public endpoint.

## Authenticate with your access token

All three calls take the OAuth 2.0 client-credentials token you use for the rest of the API.
[Authentication](/api-reference/authentication) shows how to get one.

```bash theme={"dark"}
Authorization: Bearer YOUR_ACCESS_TOKEN
```

The token tells us which LP account you are.
Don't put a trader ID in the body.

| Environment | Base URL                      |
| ----------- | ----------------------------- |
| Production  | <code>{PROD_HOST}</code>      |
| QA          | <code>{LEGACY_QA_HOST}</code> |

The examples read the host from <code>{HOST_VAR}</code>.
Set it once:

```bash theme={"dark"}
export NOVIG_HOST=https://api.novig.com
export NOVIG_QA_HOST=https://api-qa.novig.us
```

QA and Production registrations are separate.
Register on QA first and test the full flow, then register on Production.

## Register or change your webhook

`POST /rfq/pricer` creates your pricer on the first call.
A later call changes the webhook URL.

```bash theme={"dark"}
curl "$NOVIG_HOST/rfq/pricer" \
  --header "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"webhookUrl": "https://pricer.example.com/novig"}'
```

### Request body

```json theme={"dark"}
{
  "webhookUrl": "https://pricer.example.com/novig"
}
```

| Field        | Type   | Required |
| ------------ | ------ | -------- |
| `webhookUrl` | string | No       |

`webhookUrl` is the absolute `http` or `https` base URL your pricer listens on.
It can include a path, like `/novig`.
We add `/quote`, `/confirm`, and `/ping` to it.

The body takes no other field.
We refuse a body with an unknown field.

### Register for the WebSocket only

Send an empty body on your first call to register without a webhook.
You get no shared secret, because nothing is signed.

```bash theme={"dark"}
curl "$NOVIG_HOST/rfq/pricer" \
  --header "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{}'
```

The response then has `null` for `webhookUrl` and `sharedSecret`.

On a later call, a missing `webhookUrl` leaves your registration as it is.
You can't remove a webhook once you register it.

If you keep a webhook and also connect the WebSocket, both receive every RFQ.
We keep the first quote you send for each RFQ.

<Note>
  If the WebSocket is off in an environment, a first call with no `webhookUrl` returns `400`. We'd have no way to reach you.
</Note>

### Response

`200 OK`:

```json theme={"dark"}
{
  "pricerId": "0193abcd-0000-7000-8000-000000000001",
  "webhookUrl": "https://pricer.example.com/novig",
  "sharedSecret": "3b1f...<64 hex chars>...9e0a"
}
```

| Field          | Type             | Holds                                               |
| -------------- | ---------------- | --------------------------------------------------- |
| `pricerId`     | UUID string      | The ID of your pricer                               |
| `webhookUrl`   | string or `null` | The base URL we send webhooks to                    |
| `sharedSecret` | string or `null` | The key we sign webhooks with, as 64 hex characters |

Both `webhookUrl` and `sharedSecret` are `null` for a WebSocket-only pricer.

### Errors

| Status | Cause                                                     |
| ------ | --------------------------------------------------------- |
| `400`  | `webhookUrl` isn't an absolute `http` or `https` URL      |
| `400`  | The account isn't an LP account                           |
| `400`  | A first call has no `webhookUrl` and the WebSocket is off |

## Your shared secret

The shared secret is the key we use to sign each webhook request.
You use the same key to check the signature. [Webhook signing](/api-reference/rfq/signing) shows how.

We create the secret on the first call that sends a `webhookUrl`.
It is 32 random bytes, sent as 64 lowercase hex characters.
You can't choose it or upload your own.

A later call that changes the URL keeps the same secret.

<Warning>
  Only `POST /rfq/pricer` returns the secret. `GET /rfq/pricer` never shows it, so store it when you receive it.
</Warning>

A WebSocket-only pricer has no shared secret.
The WebSocket checks your access token when you connect.

## Check your registration

`GET /rfq/pricer` returns your current registration, without the secret.

```bash theme={"dark"}
curl "$NOVIG_HOST/rfq/pricer" \
  --header "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

`200 OK`:

```json theme={"dark"}
{
  "pricerId": "0193abcd-0000-7000-8000-000000000001",
  "webhookUrl": "https://pricer.example.com/novig"
}
```

It returns `404` if you have no pricer yet.

## Test your webhook

`POST /rfq/pricer/ping` sends a signed test request to `<webhookUrl>/ping` and tells you how your webhook answered.
Use it to check that we can reach you and that your signature check works.

```bash theme={"dark"}
curl --request POST "$NOVIG_HOST/rfq/pricer/ping" \
  --header "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

A ping reaches a new registration right away.
Live RFQs can take up to a minute to reach a new pricer or a changed URL.

Your side of the ping is the [`/ping` handler](/api-reference/rfq/webhooks).

### Response

`200 OK`:

```json theme={"dark"}
{
  "url": "https://pricer.example.com/novig/ping",
  "ok": true,
  "status": 200,
  "error": null
}
```

| Field    | Type              | Holds                                             |
| -------- | ----------------- | ------------------------------------------------- |
| `url`    | string            | The URL we sent the ping to                       |
| `ok`     | boolean           | `true` if your webhook answered with a 2xx status |
| `status` | integer or `null` | The HTTP status your webhook returned             |
| `error`  | string or `null`  | Why the request didn't complete                   |

`status` is `null` when the request never completed, because of a connection failure or a timeout.
`error` is then set.

### Errors

| Status | Cause                              |
| ------ | ---------------------------------- |
| `404`  | You have no pricer yet             |
| `400`  | Your pricer has no webhook to ping |

A WebSocket-only pricer has nothing to ping.
To test the WebSocket, connect and read the reply to your `subscribe` frame.
