> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# List trades

> | | |
| --- | --- |
| **Key** | `none` |
| **Throttle** | `public` |
| **Cost** | `1 /request` |
| **Answers** | <span class="st st-ok">200</span> <span class="st st-warn">400</span> <span class="st st-warn">401</span> <span class="st st-warn">404</span> <span class="st st-hold">429</span> |
| **Idempotent** | `true` |

Unauthenticated. No signature. Throttled per IP at the edge.



## OpenAPI

````yaml /api-reference/spec-files/openapi-v3-target.json get /v3/public/catalog/markets/{id}/trades
openapi: 3.1.0
info:
  title: Novig API
  version: 3.0.0
  description: >-
    Place orders over signed REST. Watch the book and your fills on one
    websocket.
servers:
  - url: https://api.qa.novig.com
    description: QA
security:
  - keyId: []
    timestamp: []
    signature: []
tags:
  - name: Catalog
  - name: Public
  - name: Authentication
  - name: Accounts
  - name: Execution
  - name: Streaming
  - name: Throttle
paths:
  /v3/public/catalog/markets/{id}/trades:
    get:
      tags:
        - Public
      summary: List trades
      description: >-
        | | |

        | --- | --- |

        | **Key** | `none` |

        | **Throttle** | `public` |

        | **Cost** | `1 /request` |

        | **Answers** | <span class="st st-ok">200</span> <span class="st
        st-warn">400</span> <span class="st st-warn">401</span> <span class="st
        st-warn">404</span> <span class="st st-hold">429</span> |

        | **Idempotent** | `true` |


        Unauthenticated. No signature. Throttled per IP at the edge.
      operationId: publicListTrades
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
          description: Market ID.
        - name: limit
          in: query
          schema:
            type: integer
            format: int32
            minimum: 1
            maximum: 5000
            default: 500
          description: >-
            Page size. Defaults to **500**, not the maximum. 1 to 5000. A value
            outside that range answers `400`.
        - name: after
          in: query
          schema:
            type: string
          description: The `next` cursor from the previous page. Opaque.
      responses:
        '200':
          description: One page of trades, newest first.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TradePage'
        '400':
          description: The request is malformed.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorBody'
              example:
                code: INVALID_REQUEST
                message: the request is malformed
        '401':
          description: The request is missing the viewer address the edge network adds.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorBody'
        '404':
          description: No market carries that ID.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorBody'
              example:
                code: MARKET_NOT_FOUND
                message: market not found
        '429':
          description: >-
            The throttle is empty. Wait the number of seconds in `Retry-After`.
            Then retry.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorBody'
              example:
                code: RATE_LIMIT_EXCEEDED
                message: Rate limit exceeded. Please wait before retrying.
      security: []
      x-codeSamples:
        - lang: bash
          source: >
            curl -s
            "https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff/trades?limit=100"
        - lang: rust
          source: |
            fn main() -> anyhow::Result<()> {
                let body = reqwest::blocking::get("https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff/trades?limit=100")?.text()?;
                println!("{body}");
                Ok(())
            }
        - lang: python
          source: >
            import urllib.request

            print(urllib.request.urlopen("https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff/trades?limit=100").read().decode())
        - lang: typescript
          source: >
            const r = await
            fetch("https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff/trades?limit=100");

            console.log(await r.text());
components:
  schemas:
    TradePage:
      allOf:
        - $ref: '#/components/schemas/PageCursorResponse'
        - type: object
          properties:
            items:
              type: array
              items:
                $ref: '#/components/schemas/Trade'
          required:
            - items
    ErrorBody:
      type: object
      properties:
        code:
          type: string
          description: Stable identifier. The only field to branch on.
        message:
          type: string
          description: Human-readable. Not stable. Never match on it.
        nonce:
          type:
            - integer
            - 'null'
          format: int64
          description: The websocket request that failed. Absent on REST.
        rejected:
          type: array
          items:
            $ref: '#/components/schemas/BatchRejection'
          description: >-
            One entry per refused order in a batch. Present only on an error
            that a batch caused.
      required:
        - code
        - message
      description: Every error on the surface carries this body.
    PageCursorResponse:
      type: object
      properties:
        next:
          type: string
          description: >-
            Pass it as `after` for the next page. Opaque: do not build or parse
            one. Absent on the last page.
      description: The link to the next page of a listing.
    Trade:
      type: object
      properties:
        tradeId:
          type: string
          format: uuid
        outcomeId:
          type: string
          format: uuid
        price:
          type: string
          description: >-
            Decimal probability on the submittable grid, as a string. Three
            bands: `0.001`–`0.050` in steps of `0.001`, `0.055`–`0.945` in steps
            of `0.005`, and `0.950`–`0.999` in steps of `0.001`. The exchange
            refuses a price off the grid with `INVALID_PRICE`.
          examples:
            - '0.665'
        qty:
          type: integer
          format: int32
          minimum: 1
          description: Number of contracts. A winning contract pays full value, 1¢.
          examples:
            - 110
        ts:
          type: integer
          format: int64
          description: Unix milliseconds.
      required:
        - tradeId
        - outcomeId
        - price
        - qty
        - ts
      description: One execution on the public tape.
    BatchRejection:
      type: object
      properties:
        index:
          type: integer
          description: Zero-based position in the request.
        outcomeId:
          type: string
          format: uuid
        reason:
          type: string
          description: >-
            Human-readable. Not stable. Branch on the envelope's `code` and on
            `index`.
      required:
        - index
        - outcomeId
        - reason
      description: One order a batch refused.
  securitySchemes:
    keyId:
      type: apiKey
      in: header
      name: Novig-Key-Id
      description: The key's UUID.
    timestamp:
      type: apiKey
      in: header
      name: Novig-Timestamp
      description: Unix milliseconds. ±30 s.
    signature:
      type: apiKey
      in: header
      name: Novig-Signature
      description: Standard padded base64 of the NOVIG-V3 signature.

````