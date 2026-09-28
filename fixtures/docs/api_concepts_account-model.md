> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Account model

> How your account, subaccounts, and keys fit together.

export const MAX_SUBACCOUNTS = 5;

<div className="tree">
  <div className="blk blk-cream">Trader</div>

  <div className="tree-link" />

  <div className="blk blk-blue">Management key</div>
  <p className="tree-note">Opens, funds, and labels every subaccount. Can't place orders.</p>

  <div className="tree-link" />

  <div className="tree-cards">
    <div className="tree-card">
      <span className="tree-card-title">Subaccount A</span>
      <span className="tree-meta">Balance, positions, orders</span>
      <div className="blk blk-amber">Trading key</div>
    </div>

    <div className="tree-card">
      <span className="tree-card-title">Subaccount B</span>
      <span className="tree-meta">Balance, positions, orders</span>
      <div className="blk blk-amber">Trading key</div>
    </div>
  </div>

  <p className="tree-foot">Each trading key reaches only its own subaccount, and that never changes.</p>
</div>

| Part       | What it is                                    | Limit                        |
| ---------- | --------------------------------------------- | ---------------------------- |
| Trader     | You. Your trader ID never appears in the API  | 1                            |
| Subaccount | A separate wallet: balance, positions, orders | Up to {MAX_SUBACCOUNTS} live |
| Key        | A keypair. We store only the public half      | By scope                     |

## Scopes

Each key has one scope, fixed when you create it.

| Scope              | Reaches         | Orders | Money | Limit            |
| ------------------ | --------------- | ------ | ----- | ---------------- |
| `management`       | All subaccounts | No     | Yes   | 1 per trader     |
| `management::read` | All subaccounts | No     | No    | None             |
| `trading`          | One subaccount  | Yes    | No    | 1 per subaccount |
| `trading::read`    | One subaccount  | No     | No    | None             |

* `management` opens, funds, and labels subaccounts, and creates and revokes keys.
* `management::read` lists keys and subaccounts, and reads any balance and ledger.
* `trading` places and cancels orders on its subaccount, and reads the catalog.
* `trading::read` reads its subaccount's orders, fills, positions, and balance, and the catalog.

| Scope                  | Create it with                                                             |
| ---------------------- | -------------------------------------------------------------------------- |
| `management`           | [Profile → Settings → Novig API](/api/api-keys#create-your-management-key) |
| `management::read`     | `POST /v3/keys`                                                            |
| `trading`              | `POST /v3/account/subaccounts`                                             |
| `trading`, replacement | `POST /v3/account/subaccounts/{keyId}/keys`                                |
| `trading::read`        | `POST /v3/account/subaccounts/{keyId}/keys`                                |

<Warning>
  No key can both move money and place orders. A leaked trading key can lose its balance through trades, but it can't withdraw money or reach another subaccount.
</Warning>

## Address a subaccount by its trading key

Routes that act on a subaccount take its trading key ID as `{keyId}`, as in `GET /v3/account/subaccounts/{keyId}/balance`.

* A management key ID isn't an address, because it doesn't point at one subaccount. It returns a <span className="st st-warn">400</span>.
* A revoked trading key's ID still works as an address. Your management key can still reach the subaccount through it.
* The subaccount list has one row per live subaccount. Each row's `keyId` is that subaccount's trading key.

## Recommended setup

* Use one subaccount per strategy, so a cancel-all stops only that strategy.
* Use one subaccount per process, so you can revoke a compromised host without stopping the others.
* Keep your one management key in a secret manager, never in a running process. It's the only key that moves money.
