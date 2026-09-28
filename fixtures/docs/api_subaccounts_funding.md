> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Funding

> Move money between your cash wallet and one subaccount, with an idempotency key.

export const TRANSFER_PER_MINUTE = 60;

export const TRANSFER_PER_SECOND = 5;

export const TRANSFER_ID_CHARS = 64;

A transfer moves money between your cash wallet and one subaccount.

| Route                                                | Reply                                 |
| ---------------------------------------------------- | ------------------------------------- |
| `POST /v3/account/subaccounts/{keyId}/transfer`      | <span className="st st-ok">202</span> |
| `GET /v3/account/subaccounts/{keyId}/transfers/{id}` | <span className="st st-ok">200</span> |

Send a transfer with your `management` key.
Read one with a `management` or `management::read` key.

The transfer route allows {TRANSFER_PER_SECOND} requests per second **and** {TRANSFER_PER_MINUTE} per 60 seconds.
The read route counts against the `account` [throttle](/api/throttling).

<Warning>
  A `202` means we accepted the request, not that the money moved. [Check the transfer's status](#check-the-transfer-status) before you treat the money as moved.
</Warning>

## Send a transfer

| Field              | Type               | Required |
| ------------------ | ------------------ | -------- |
| `direction`        | `fund` or `defund` | Yes      |
| `amount`           | `string`           | Yes      |
| `clientTransferId` | `string`           | No       |

* `direction` is named from the subaccount's side: `fund` moves money into it, and `defund` moves money out.
* `amount` is a positive decimal with at most 5 places. We never round it.
* `clientTransferId` is your idempotency key, up to {TRANSFER_ID_CHARS} characters and unique per trader. Send one.

<Tabs>
  <Tab title="Request">
    ```json theme={"dark"}
    {
      "direction": "fund",
      "amount": "250.00000",
      "clientTransferId": "desk-1-topup-2026-09-09-a"
    }
    ```
  </Tab>

  <Tab title="202">
    ```json theme={"dark"}
    {
      "transferId": "c4a71f30-…",
      "status": "Requested",
      "direction": "fund",
      "amount": "250.00000",
      "actualBalance": null,
      "clientTransferId": "desk-1-topup-2026-09-09-a",
      "createdAt": "2026-09-09T14:22:03.118Z",
      "updatedAt": "2026-09-09T14:22:03.118Z"
    }
    ```
  </Tab>
</Tabs>

## Retry a transfer

What a retry does depends on the `clientTransferId` you send.

| Retry with                        | Result                                                                |
| --------------------------------- | --------------------------------------------------------------------- |
| The same `clientTransferId`       | The first request's response, and nothing queued                      |
| The same ID on another subaccount | <span className="st st-warn">400</span>, because the ID is per trader |
| No ID                             | A second transfer                                                     |

## Check the transfer status

`GET /v3/account/subaccounts/{keyId}/transfers/{id}` returns the transfer. Pass the `transferId` from the `202` as `{id}`.
Its `status` tells you whether the money moved.

| `status`    | Means                 | Final |
| ----------- | --------------------- | ----- |
| `Requested` | Still outstanding     | No    |
| `Applied`   | The money moved       | Yes   |
| `Rejected`  | The money didn't move | Yes   |

If a transfer stays `Requested`, contact support. Don't retry it under a new ID.

On a `Rejected` transfer, `actualBalance` holds the balance we found.

## Transfers and transactions

A transfer is your request to move money, and its status.
It covers funding and defunding.

A transaction is one row in your ledger: one movement of the balance.
We write one only when money moves, for fills, fees, maker credits, settlements, and applied transfers.

| `status`    | Transfer                      | Transaction                     |
| ----------- | ----------------------------- | ------------------------------- |
| `Requested` | Present                       | Absent                          |
| `Applied`   | Present                       | `TRANSFER_IN` or `TRANSFER_OUT` |
| `Rejected`  | Present, with `actualBalance` | Absent                          |

Read a transfer with `GET /v3/account/subaccounts/{keyId}/transfers/{id}`.

List transactions with `GET /v3/account/subaccounts/{keyId}/transactions`.

No route lists transfers.
If you lose a `transferId`, send the same request again with the same `clientTransferId` to recover it.
