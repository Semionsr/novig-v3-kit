> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Get a market

> | | |
| --- | --- |
| **Key** | `none` |
| **Throttle** | `public` |
| **Cost** | `1 /request` |
| **Answers** | <span class="st st-ok">200</span> <span class="st st-warn">401</span> <span class="st st-warn">404</span> <span class="st st-hold">429</span> |
| **Idempotent** | `true` |

Unauthenticated. No signature. Throttled per IP at the edge.



## OpenAPI

````yaml /api-reference/spec-files/openapi-v3-target.json get /v3/public/catalog/markets/{id}
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
  /v3/public/catalog/markets/{id}:
    get:
      tags:
        - Public
      summary: Get a market
      description: >-
        | | |

        | --- | --- |

        | **Key** | `none` |

        | **Throttle** | `public` |

        | **Cost** | `1 /request` |

        | **Answers** | <span class="st st-ok">200</span> <span class="st
        st-warn">401</span> <span class="st st-warn">404</span> <span class="st
        st-hold">429</span> |

        | **Idempotent** | `true` |


        Unauthenticated. No signature. Throttled per IP at the edge.
      operationId: publicGetMarket
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
          description: Market ID.
      responses:
        '200':
          description: The market.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Market'
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
            "https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff"
        - lang: rust
          source: |
            fn main() -> anyhow::Result<()> {
                let body = reqwest::blocking::get("https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff")?.text()?;
                println!("{body}");
                Ok(())
            }
        - lang: python
          source: >
            import urllib.request

            print(urllib.request.urlopen("https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff").read().decode())
        - lang: typescript
          source: >
            const r = await
            fetch("https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff");

            console.log(await r.text());
components:
  schemas:
    Market:
      type: object
      properties:
        marketId:
          type: string
          format: uuid
        eventId:
          type: string
          format: uuid
        marketType:
          type: string
          description: A canonical name from `GET /v3/types/markets`.
          examples:
            - MONEY
        strike:
          type: string
          description: >-
            The line the market settles against, a decimal string. A spread's
            line is the home side's handicap. Absent on a market without a line.
          examples:
            - '-3.5'
        status:
          $ref: '#/components/schemas/MarketStatus'
        voids:
          $ref: '#/components/schemas/Voidability'
        description:
          type: string
          description: Human-readable. Use it for discovery, never as a contract.
        startsTs:
          type: integer
          format: int64
          description: Unix milliseconds.
        fee:
          $ref: '#/components/schemas/MarketFee'
        outcomes:
          type: array
          items:
            $ref: '#/components/schemas/Outcome'
      required:
        - marketId
        - eventId
        - marketType
        - status
        - voids
        - description
        - startsTs
        - fee
        - outcomes
      description: 'A market in the open set: enough to pick an outcome and place an order.'
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
    MarketStatus:
      type: string
      enum:
        - OPEN
        - CLOSED
        - SETTLED
      description: Lifecycle status of a market.
    Voidability:
      type: string
      enum:
        - PUSH
        - FMV
      description: >-
        How a market settles if it voids. `PUSH` refunds every fill at its cost.
        `FMV` settles every outcome at its fair market value. The exchange never
        pushes an `FMV` market. Do not assume a refund.
    MarketFee:
      type: object
      properties:
        coefficient:
          type: string
          description: '`c` in the fee formula, a decimal string.'
          examples:
            - '0.03'
        makerCredit:
          type: string
          description: >-
            The maker's share of the taker's fee on the same fill, a decimal
            string.
          examples:
            - '0.5'
        charged:
          $ref: '#/components/schemas/Chargeability'
      required:
        - coefficient
        - makerCredit
        - charged
      description: >-
        What a taker pays on this market. Read it per market. Never derive it
        from a league list.
    Outcome:
      type: object
      properties:
        outcomeId:
          type: string
          format: uuid
        name:
          type: string
          description: Display name. Not a contract.
        status:
          $ref: '#/components/schemas/OutcomeStatus'
      required:
        - outcomeId
        - name
        - status
      description: 'One outcome of a market: what an order names.'
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
    Chargeability:
      type: string
      enum:
        - ALWAYS
        - WHEN_LIVE
      description: >-
        When a market charges its taker. `WHEN_LIVE` charges only while the
        event is `OPEN_INGAME`. An eligible futures market charges `ALWAYS`,
        because its event never goes live. A PGA, ATP, WTA or UFC future carries
        no futures trading fee. It reads `WHEN_LIVE` and never charges.
    OutcomeStatus:
      type: string
      description: >-
        `TBD`, `WIN`, `LOSS`, `PUSH`, **or a decimal price string** between
        `"0.000"` and `"1.000"` when the market settles at fair market value.
        Not an enum. Branch on the four keywords. Treat anything else as a
        price.
      examples:
        - TBD
        - WIN
        - '0.731'
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