> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Open the websocket

> | | |
| --- | --- |
| **Key** | `trading` `trading::read` |
| **Throttle** | `stream` |
| **Cost** | `weight /pair` |
| **Answers** | <span class="st st-info">101</span> <span class="st st-warn">401</span> <span class="st st-warn">403</span> <span class="st st-hold">423</span> <span class="st st-hold">429</span> <span class="st st-warn">451</span> |
| **Idempotent** | `true` |

Sign the upgrade request like any route. The subjects are `market:<id>`, `event:<id>`, and `PRIVATE`. The channels are `lifecycle`, `trades`, `book`, `orders`, and `positions`. Once per interval, a `heartbeat` message states your last seq on each subscribed private channel.



## OpenAPI

````yaml /api-reference/spec-files/openapi-v3-target.json get /v3/ws
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
  /v3/ws:
    get:
      tags:
        - Streaming
      summary: Open the websocket
      description: >-
        | | |

        | --- | --- |

        | **Key** | `trading` `trading::read` |

        | **Throttle** | `stream` |

        | **Cost** | `weight /pair` |

        | **Answers** | <span class="st st-info">101</span> <span class="st
        st-warn">401</span> <span class="st st-warn">403</span> <span class="st
        st-hold">423</span> <span class="st st-hold">429</span> <span class="st
        st-warn">451</span> |

        | **Idempotent** | `true` |


        Sign the upgrade request like any route. The subjects are `market:<id>`,
        `event:<id>`, and `PRIVATE`. The channels are `lifecycle`, `trades`,
        `book`, `orders`, and `positions`. Once per interval, a `heartbeat`
        message states your last seq on each subscribed private channel.
      operationId: connectWebsocket
      responses:
        '101':
          description: The connection continues as a websocket.
        '401':
          description: >-
            The signature is absent or invalid, or the key is unknown, revoked,
            or expired.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorBody'
              example:
                code: SIGNATURE_REJECTED
                message: signature verification failed
        '403':
          description: The key's scope does not grant this route.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorBody'
              example:
                code: SIGNATURE_REJECTED
                message: api key scope is insufficient for this route
        '423':
          description: The account is locked out of trading.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorBody'
              example:
                code: ACCOUNT_LOCKED
                message: the account is locked out of trading
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
        '451':
          description: >-
            Geolocation refused the request: an anonymized network, a restricted
            region, or, for a placement, no device geolocation in the last 3
            days.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorBody'
              example:
                code: GEOLOCATION_EXPIRED
                message: no geolocation in the last 3 days
components:
  schemas:
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