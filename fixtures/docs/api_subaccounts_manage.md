> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Open and manage

> Open a subaccount and its trading key. List subaccounts, read a balance, and change a label.

export const LABEL_CHARS = 64;

A subaccount is a separate wallet with its own balance, positions, orders, and trading key.
[Account model](/api/concepts/account-model) explains how subaccounts and keys fit together.

| Route                                         | Reply                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /v3/account/subaccounts`                | <span className="st st-ok">201</span>                                         |
| `GET /v3/account/subaccounts`                 | <span className="st st-ok">200</span>                                         |
| `GET /v3/account/subaccounts/{keyId}/balance` | <span className="st st-ok">200</span>                                         |
| `PATCH /v3/account/subaccounts/{keyId}`       | <span className="st st-ok">200</span> <span className="st st-warn">404</span> |

All four routes count against the `account` [throttle](/api/throttling).

## Open a subaccount

One call to `POST /v3/account/subaccounts` opens the subaccount, its wallet, and its one `trading` key.
Sign the call with your `management` key.

First, generate the trading keypair:

```bash theme={"dark"}
openssl genpkey -algorithm ed25519 -out desk-1.pem
openssl pkey -in desk-1.pem -pubout -out desk-1.pub.pem
```

macOS ships LibreSSL, which can't generate an Ed25519 key. Run these commands with OpenSSL 3 (`brew install openssl`).

Then send the public key in the body:

| Field       | Type                 | Required |
| ----------- | -------------------- | -------- |
| `label`     | `string`             | Yes      |
| `publicKey` | `string`             | Yes      |
| `algorithm` | `Ed25519` or `P-256` | Yes      |
| `expiresAt` | `date-time`          | No       |

* `label` holds up to {LABEL_CHARS} characters. It's for display only and doesn't have to be unique.
* `publicKey` is the SPKI PEM of a fresh keypair, newlines included.
* `algorithm` must match the key material.
* `expiresAt` must be strictly in the future.

<Tabs>
  <Tab title="Request">
    ```json theme={"dark"}
    {
      "label": "desk-1",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n",
      "algorithm": "Ed25519"
    }
    ```
  </Tab>

  <Tab title="201">
    ```json theme={"dark"}
    {
      "keyId": "8f14e45f-…",
      "label": "desk-1",
      "balance": "0.00000"
    }
    ```
  </Tab>
</Tabs>

The `keyId` identifies the trading key.
It's also the subaccount's address. Store it beside `desk-1.pem`.

<Warning>
  If you lose `desk-1.pem`, nothing can sign as this subaccount again. Your `management` key can still defund the subaccount and change its label.
</Warning>

Opening a subaccount has two requirements:

* You've passed KYC, our identity check, and aren't self-excluded. We check this here, when you fund, and on every order you place.
* You have a free slot. The sixth open fails.

## List subaccounts

`GET /v3/account/subaccounts` returns one row per live subaccount.
Sign it with a `management` or `management::read` key.

The route has no paging and no filter.

```json 200 theme={"dark"}
[
  {
    "keyId": "8f14e45f-…",
    "label": "desk-1",
    "balance": "1234.50000"
  },
  {
    "keyId": "b7c3a1e9-…",
    "label": "desk-2",
    "balance": "0.00000"
  }
]
```

## Read a balance

`GET /v3/account/subaccounts/{keyId}/balance` returns one subaccount's balance.

The `keyId` is the subaccount's trading key, not the key you sign with.
Put it in the path before you sign.

| Signed with        | Reads              |
| ------------------ | ------------------ |
| `management`       | Any subaccount     |
| `management::read` | Any subaccount     |
| `trading`          | Its own subaccount |
| `trading::read`    | Its own subaccount |

A `trading` or `trading::read` key that reads another subaccount gets a <span className="st st-warn">403</span>.

## Change a label

`PATCH /v3/account/subaccounts/{keyId}` changes a subaccount's label.
The label is the only part of a subaccount you can change. Sign the call with your `management` key.

The call moves no money and opens no position, so self-exclusion doesn't block it.

The call is idempotent: sending the same label twice makes one change.

```json theme={"dark"}
{
  "label": "desk-1-nba"
}
```

```json 200 theme={"dark"}
{
  "keyId": "8f14e45f-…",
  "label": "desk-1-nba",
  "balance": "1234.50000"
}
```
