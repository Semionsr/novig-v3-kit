> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Get the order book

> | | |
| --- | --- |
| **Key** | `none` |
| **Throttle** | `public` |
| **Cost** | `1 /request` |
| **Answers** | <span class="st st-ok">200</span> <span class="st st-info">304</span> <span class="st st-warn">401</span> <span class="st st-warn">404</span> <span class="st st-hold">429</span> |
| **Idempotent** | `true` |

Unauthenticated. No signature. Throttled per IP at the edge.



## OpenAPI

````yaml /api-reference/spec-files/openapi-v3-target.json get /v3/public/catalog/markets/{id}/book
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
  /v3/public/catalog/markets/{id}/book:
    get:
      tags:
        - Public
      summary: Get the order book
      description: >-
        | | |

        | --- | --- |

        | **Key** | `none` |

        | **Throttle** | `public` |

        | **Cost** | `1 /request` |

        | **Answers** | <span class="st st-ok">200</span> <span class="st
        st-info">304</span> <span class="st st-warn">401</span> <span class="st
        st-warn">404</span> <span class="st st-hold">429</span> |

        | **Idempotent** | `true` |


        Unauthenticated. No signature. Throttled per IP at the edge.
      operationId: publicGetBook
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
          description: Market ID.
        - name: If-None-Match
          in: header
          schema:
            type: string
          description: A prior response's `ETag`. A match answers `304`.
      responses:
        '200':
          description: Resting orders by outcome.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Book'
        '304':
          description: The book seq matches the `If-None-Match` ETag.
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
            "https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff/book"
        - lang: rust
          source: |
            fn main() -> anyhow::Result<()> {
                let body = reqwest::blocking::get("https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff/book")?.text()?;
                println!("{body}");
                Ok(())
            }
        - lang: python
          source: >
            import urllib.request

            print(urllib.request.urlopen("https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff/book").read().decode())
        - lang: typescript
          source: >
            const r = await
            fetch("https://api.qa.novig.com/v3/public/catalog/markets/6f9619ff-8b86-d011-b42d-00c04fc964ff/book");

            console.log(await r.text());
components:
  schemas:
    Book:
      type: object
      properties:
        marketId:
          type: string
          format: uuid
        seq:
          type: integer
          format: int64
          description: >-
            The book's sequence number at this snapshot. The next `book` delta
            on the websocket follows it.
        orders:
          type: object
          additionalProperties:
            type: array
            items:
              $ref: '#/components/schemas/RestingOrder'
          description: >-
            Resting orders by outcome ID, best price first, earlier order first
            within a price.
      required:
        - marketId
        - seq
        - orders
      description: The order book of one market.
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
    RestingOrder:
      type: object
      properties:
        orderId:
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
      required:
        - orderId
        - price
        - qty
      description: One order resting on the book.
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