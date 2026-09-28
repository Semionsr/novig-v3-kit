> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# List leagues

> | | |
| --- | --- |
| **Key** | `none` |
| **Throttle** | `public` |
| **Cost** | `1 /request` |
| **Answers** | <span class="st st-ok">200</span> <span class="st st-warn">401</span> <span class="st st-hold">429</span> |
| **Idempotent** | `true` |

Unauthenticated. No signature. Throttled per IP at the edge.



## OpenAPI

````yaml /api-reference/spec-files/openapi-v3-target.json get /v3/public/types/leagues
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
  /v3/public/types/leagues:
    get:
      tags:
        - Public
      summary: List leagues
      description: >-
        | | |

        | --- | --- |

        | **Key** | `none` |

        | **Throttle** | `public` |

        | **Cost** | `1 /request` |

        | **Answers** | <span class="st st-ok">200</span> <span class="st
        st-warn">401</span> <span class="st st-hold">429</span> |

        | **Idempotent** | `true` |


        Unauthenticated. No signature. Throttled per IP at the edge.
      operationId: publicListLeagues
      responses:
        '200':
          description: Every canonical league name.
          content:
            application/json:
              schema:
                type: array
                items:
                  type: string
              example:
                - NFL
                - NBA
                - MLB
        '401':
          description: The request is missing the viewer address the edge network adds.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorBody'
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
          source: |
            curl -s "https://api.qa.novig.com/v3/public/types/leagues"
        - lang: rust
          source: |
            fn main() -> anyhow::Result<()> {
                let body = reqwest::blocking::get("https://api.qa.novig.com/v3/public/types/leagues")?.text()?;
                println!("{body}");
                Ok(())
            }
        - lang: python
          source: >
            import urllib.request

            print(urllib.request.urlopen("https://api.qa.novig.com/v3/public/types/leagues").read().decode())
        - lang: typescript
          source: >
            const r = await
            fetch("https://api.qa.novig.com/v3/public/types/leagues");

            console.log(await r.text());
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