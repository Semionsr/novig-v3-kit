> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Errors

> Every error we return, what causes it, and how to fix it.

export const COMPANION_WINDOW_DAYS = 3;

export const REVOCATION_SECONDS = 60;

export const MAX_SUBACCOUNTS = 5;

export const SKEW = "30 s";

## How we check a signed request

We run these checks on each signed request, top to bottom.
The first check that fails decides the error.

<div className="verifier">
  <div className="verifier-title">signing\_api::verify(request)</div>

  <div className="verifier-row">
    <code className="verifier-gate">body within cap</code>

    <span className="verifier-link" />

    <span className="verifier-err verifier-413"><code>BodyTooLarge</code><b>413</b></span>
  </div>

  <div className="verifier-row">
    <code className="verifier-gate">headers present?</code>

    <span className="verifier-link" />

    <span className="verifier-err verifier-401"><code>KeyIdRequired | TimestampRequired | SignatureRequired</code><b>401</b></span>
  </div>

  <div className="verifier-row">
    <code className="verifier-gate">Uuid::parse(key\_id)</code>

    <span className="verifier-link" />

    <span className="verifier-err verifier-401"><code>MalformedKeyId</code><b>401</b></span>
  </div>

  <div className="verifier-row">
    <code className="verifier-gate">i64::parse(timestamp)</code>

    <span className="verifier-link" />

    <span className="verifier-err verifier-401"><code>MalformedTimestamp</code><b>401</b></span>
  </div>

  <div className="verifier-row">
    <code className="verifier-gate">|now − ts| ≤ {SKEW}</code>

    <span className="verifier-link" />

    <span className="verifier-err verifier-401"><code>TimestampTooOld | TimestampTooFarInFuture</code><b>401</b></span>
  </div>

  <div className="verifier-row">
    <code className="verifier-gate">key row</code>

    <span className="verifier-link" />

    <span className="verifier-err verifier-401"><code>KeyNotFound</code><b>401</b></span>
  </div>

  <div className="verifier-row">
    <code className="verifier-gate">the read itself</code>

    <span className="verifier-link" />

    <span className="verifier-err verifier-500"><code>DatabaseError</code><b>500</b></span>
  </div>

  <div className="verifier-row">
    <code className="verifier-gate">live && !expired</code>

    <span className="verifier-link" />

    <span className="verifier-err verifier-401"><code>KeyRevoked | KeyExpired</code><b>401</b></span>
  </div>

  <div className="verifier-row">
    <code className="verifier-gate">base64::decode(signature)</code>

    <span className="verifier-link" />

    <span className="verifier-err verifier-401"><code>MalformedSignature</code><b>401</b></span>
  </div>

  <div className="verifier-row">
    <code className="verifier-gate">key.verify(canonical, sig)</code>

    <span className="verifier-link" />

    <span className="verifier-err verifier-401"><code>VerificationFailed</code><b>401</b></span>
  </div>

  <div className="verifier-row">
    <code className="verifier-gate">scope.grants::\<Route>()</code>

    <span className="verifier-link" />

    <span className="verifier-err verifier-403"><code>ScopeInsufficient</code><b>403</b></span>
  </div>

  <div className="verifier-row verifier-pass">
    <span className="verifier-ok"><code>Principal</code><span>the handler runs</span></span>
  </div>
</div>

Only a request that passes every check reaches the route's handler.

Each rejection is a `SignatureRejection` variant.
The `code` in the response depends only on the status, so branch on the `code`, not on the variant.

| Status                                                                          | `code`               |
| ------------------------------------------------------------------------------- | -------------------- |
| <span className="st st-warn">401</span> <span className="st st-warn">403</span> | `SIGNATURE_REJECTED` |
| <span className="st st-warn">413</span>                                         | `PAYLOAD_TOO_LARGE`  |
| <span className="st st-warn">500</span>                                         | `INTERNAL_ERROR`     |

* `VerificationFailed` is the only rejection that means your canonical string is wrong.
* A `403` means your signature verified. We check scope last.
* A `500` isn't caused by your request. Retry it unchanged.

## `400` Bad Request

| Message                                                          | Fix                                |
| ---------------------------------------------------------------- | ---------------------------------- |
| `You sent the private half of your keypair…`                     | Send the public key                |
| `The publicKey field is not a valid SPKI public key.`            | Export it as SPKI                  |
| `Only Ed25519 and P-256 public keys are accepted…`               | Use Ed25519 or P-256               |
| `The algorithm field must match the key type. Expected <a>.`     | Match your key                     |
| `That key does not reach a subaccount.`                          | Use a `trading` key ID             |
| <code>You can have at most {MAX_SUBACCOUNTS} subaccounts.</code> | Relabel one                        |
| `You already used that transfer id on another subaccount.`       | Transfer IDs are unique per trader |

To export a public key as SPKI, run `openssl pkey -pubout` and send the output with its newlines.

Generate an Ed25519 or P-256 keypair, and set `algorithm` to match the key material.

Address a subaccount by one of its `trading` key IDs.

A subaccount is permanent, so relabel an existing one instead of opening another.

A transfer id is unique per trader.

## `401` Unauthorized

| `message`                                  | Fix                             |
| ------------------------------------------ | ------------------------------- |
| `novig-key-id header is required`          | Send the missing header         |
| `novig-key-id is not a valid UUID`         | Send the `keyId`, not the label |
| `novig-timestamp is not a valid integer`   | Send unpadded decimal digits    |
| `novig-timestamp is too old`               | Send milliseconds               |
| `novig-timestamp is too far in the future` | Check your clock                |
| `api key not found`                        | Check the key ID and host       |
| `api key has been revoked`                 | Create a new key                |
| `api key has expired`                      | Create a new key                |
| `novig-signature is malformed`             | Send standard padded base64     |
| `signature verification failed`            | Sign a test vector              |

When `novig-timestamp` or `novig-signature` is missing, the first message names that header instead.

We accept a timestamp within ±{SKEW} of our clock, so check your clock too.

`api key not found` means a wrong key ID, the wrong environment, or a key revoked more than {REVOCATION_SECONDS} seconds ago.

`api key has been revoked` means you revoked the key less than {REVOCATION_SECONDS} seconds ago.

For `signature verification failed`, sign a [test vector](/api/signing#test-vectors). Diff your canonical string against its `string_to_sign`.

If you still get a `401`, find your symptom below.

* **A <span className="st st-warn">401</span> on every call.** A header, the clock, the key, or the canonical string is wrong. Read `message`, then sign a published vector and diff your string against it on [Sign a request](/api/signing).
* **`GET` works, but `POST` fails.** Without `Content-Type: application/json`, the server hashed zero bytes. Send that header on every request with a body.
* **Every `POST` fails, and the body looks right.** Your client re-serialized the JSON after you hashed it. Send the exact bytes you hashed.
* **Every path fails.** You signed the URL, or dropped the mount prefix. Sign the path only, with the mount prefix included.
* **A P-256 signature never verifies.** You sent a raw `r‖s` signature. Send DER instead, as [Algorithms](/api/signing#algorithms) describes.
* **`api key not found`, but the key exists.** You're on the wrong environment, since a key works only in its own. Check the host on [Environments](/api/environments).

## `403` Forbidden

| `message`                                                 | Fix                             |
| --------------------------------------------------------- | ------------------------------- |
| `api key scope is insufficient for this route`            | Check the key's scope           |
| `A trading key reads only the subaccount it is bound to.` | Use `management::read`          |
| `KYC verification required`                               | Finish KYC                      |
| `API keys cannot be created over a VPN or proxy.`         | Turn off the VPN or proxy       |
| `API keys cannot be created from your location.`          | Create it from an allowed state |

A scope error means the key has the wrong family or level. See [scopes](/api/concepts/account-model#scopes).

To read a sibling subaccount, use a key with `management::read`.

KYC is our identity check. You need it to open or fund a subaccount, or to place an order. Cancels still work without it.

You can create a key only from a state that allows it.

## `404` Not Found

We answer `Key not found.`, `Subaccount not found.`, or `Transfer not found.` when we can't find the ID.

An ID that belongs to another trader gets the same reply.

## `409` Conflict

* `A live key with this public key already exists.` A public key is unique across Novig.
* `This trader already has a live management key…` Revoke the live `management` key first.

A declined transfer is not an error.
The route answers `202`, and the transfer then reads `status: "Rejected"`.
See [Funding](/api/subaccounts/funding#check-the-transfer-status).

## `413` Content Too Large

The edge is a filter in front of our servers.
It refuses any body over 8 KiB (8,192 bytes) with a <span className="st st-warn">403</span> and an HTML page, with no JSON error body.
The request never reaches the exchange.
A batch hits this cap first, at about 90 orders.

The exchange buffers each request body before it parses it.
It refuses a body over 100 KiB with a <span className="st st-warn">413</span> and `PAYLOAD_TOO_LARGE`, before it reads the signature.
Through our edge you'll see the 403 first, since its cap is smaller.

To fix either error, split the batch. Both caps count the raw bytes you send.

## `423` Locked

A `423` doesn't clear on its own. Contact support.

| `code`             | Still works                                 |
| ------------------ | ------------------------------------------- |
| `SYSTEM_LOCKED`    | Key and subaccount reads                    |
| `ACCOUNT_LOCKED`   | Key and subaccount reads, label, and revoke |
| `ACCOUNT_EXCLUDED` | Key and subaccount reads                    |
| `SELF_EXCLUDED`    | Cancels and reads                           |
| `EMPLOYEE_ACCOUNT` | Reads                                       |

* `SYSTEM_LOCKED` means the exchange has halted trading. It blocks every trading and catalog route, reads included.
* `ACCOUNT_LOCKED` and `ACCOUNT_EXCLUDED` block every trading and catalog route, reads included.
* `ACCOUNT_LOCKED` also blocks creating a key, opening a subaccount, and moving funds, while the account is locked or excluded.
* `SELF_EXCLUDED` blocks placing orders while the key holder is self-excluded.
* `EMPLOYEE_ACCOUNT` blocks placing and canceling when the key belongs to a Novig employee.

## `429` Too Many Requests

`RATE_LIMIT_EXCEEDED` means you sent requests too fast.
Wait `Retry-After` seconds before you retry.
See [Throttling](/api/throttling#error-response).

## `451` Geolocation Unavailable

Geolocation is the location check the Novig app runs for the key holder.
A `451` means the request, or the key holder's location, didn't pass it.

| `code`                          | Cause                                                           |
| ------------------------------- | --------------------------------------------------------------- |
| `ANONYMIZED_NETWORK`            | VPN, proxy, or Tor exit                                         |
| `RESTRICTED_NETWORK_REGION`     | The request's address is in a restricted state                  |
| `GEOLOCATION_NOT_FOUND`         | The key holder never geolocated                                 |
| `GEOLOCATION_FAILED`            | The last geolocation failed                                     |
| `INVALID_GEOLOCATION_REGION`    | The last geolocation named no region                            |
| `RESTRICTED_GEOLOCATION_REGION` | The last geolocation is in a restricted state                   |
| `GEOLOCATION_EXPIRED`           | A placement, with none in the last {COMPANION_WINDOW_DAYS} days |

`ANONYMIZED_NETWORK` means the request came over a VPN, a proxy, or a Tor exit. A data-center address is fine.

The first two codes judge the request's network. The rest judge the key holder's device. For those, the key holder must open the app.

A cancel never returns a `451`. A read admits a stale geolocation, so only a placement returns `GEOLOCATION_EXPIRED`.

## Trading and catalog errors

Every trading and catalog error has a `code` and a `message`.
Branch on the `code`. The `message` is for a human, and it can change.

A body that doesn't parse answers `INVALID_BODY`. Its `message` names the field and the reason, like ``qty: invalid value: integer `-1`, expected u32``.

| Status                                  | `code`                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| <span className="st st-warn">400</span> | `INVALID_BODY` `INVALID_QUERY` `INVALID_REQUEST` `NOT_A_SUBACCOUNT_KEY`      |
| <span className="st st-warn">400</span> | `TTL_NOT_ALLOWED` `TTL_REQUIRED` `TTL_OUT_OF_RANGE` `QTY_OUT_OF_RANGE`       |
| <span className="st st-warn">400</span> | `INVALID_PRICE` `PRICE_BAND_VIOLATION` `ORDER_TOO_SMALL` `ORDER_TOO_LARGE`   |
| <span className="st st-warn">400</span> | `EMPTY_BATCH` `BATCH_TOO_LARGE` `BATCH_REJECTED` `CURRENCY_MISMATCH`         |
| <span className="st st-warn">400</span> | `NOT_LIVE_TRADABLE` `EVENT_NOT_TRADABLE` `PAGE_LIMIT_OUT_OF_RANGE`           |
| <span className="st st-warn">400</span> | `OFFSET_NOT_SUPPORTED`                                                       |
| <span className="st st-warn">400</span> | `STALE_NONCE` `EMPTY_SELECTION` `SUBSCRIPTION_LIMIT_EXCEEDED`                |
| <span className="st st-warn">403</span> | `SCOPE_INSUFFICIENT` `KYC_REQUIRED`                                          |
| <span className="st st-warn">404</span> | `MARKET_NOT_FOUND` `EVENT_NOT_FOUND` `OUTCOME_NOT_FOUND` `ORDER_NOT_FOUND`   |
| <span className="st st-warn">404</span> | `WALLET_NOT_FOUND` `SUBACCOUNT_NOT_FOUND`                                    |
| <span className="st st-warn">409</span> | `MARKET_CLOSED` `MARKET_INACTIVE`                                            |
| <span className="st st-warn">422</span> | `INSUFFICIENT_BALANCE` `POSITION_LIMIT_EXCEEDED` `OPEN_ORDER_LIMIT_EXCEEDED` |
| <span className="st st-warn">422</span> | `WAGER_LIMIT_EXCEEDED`                                                       |
| <span className="st st-hold">423</span> | `SYSTEM_LOCKED` `ACCOUNT_LOCKED` `LEAGUE_LOCKED` `COMPETITOR_LOCKED`         |
| <span className="st st-hold">423</span> | `ACCOUNT_EXCLUDED` `SELF_EXCLUDED` `EMPLOYEE_ACCOUNT`                        |
| <span className="st st-hold">423</span> | `EVENT_LOCKED` `MARKET_LOCKED`                                               |
| <span className="st st-warn">429</span> | `RATE_LIMIT_EXCEEDED`                                                        |
| <span className="st st-warn">451</span> | See [`451`](#451-geolocation-unavailable)                                    |
| <span className="st st-warn">503</span> | `GEOLOCATION_SCREENING_UNAVAILABLE`                                          |
| <span className="st st-warn">500</span> | `INTERNAL_ERROR`                                                             |

* <span className="st st-warn">403</span> `KYC_REQUIRED` applies to placing only. The key holder's KYC lapsed after the key was created, so finish verification in the app.
* <span className="st st-hold">423</span> means `SELF_EXCLUDED`, `EMPLOYEE_ACCOUNT`, or a lock with no `code`. See [`423`](#423-locked).
* A `reject` from the matching engine isn't an HTTP error. It arrives on the [private stream](/api/streaming/private) after the <span className="st st-ok">201</span>.
