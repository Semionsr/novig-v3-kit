> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Get a balance

> | | |
| --- | --- |
| **Key** | `management` `management::read` `trading` |
| **Throttle** | `account` |
| **Cost** | `1 /request` |
| **Answers** | <span class="st st-ok">200</span> <span class="st st-warn">400</span> <span class="st st-warn">401</span> <span class="st st-warn">403</span> <span class="st st-warn">404</span> <span class="st st-hold">423</span> <span class="st st-hold">429</span> <span class="st st-warn">451</span> |
| **Idempotent** | `true` |



## OpenAPI

````yaml /api-reference/spec-files/openapi-v3-target.json get /v3/account/subaccounts/{keyId}/balance
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
  /v3/account/subaccounts/{keyId}/balance:
    get:
      tags:
        - Accounts
      summary: Get a balance
      description: >-
        | | |

        | --- | --- |

        | **Key** | `management` `management::read` `trading` |

        | **Throttle** | `account` |

        | **Cost** | `1 /request` |

        | **Answers** | <span class="st st-ok">200</span> <span class="st
        st-warn">400</span> <span class="st st-warn">401</span> <span class="st
        st-warn">403</span> <span class="st st-warn">404</span> <span class="st
        st-hold">423</span> <span class="st st-hold">429</span> <span class="st
        st-warn">451</span> |

        | **Idempotent** | `true` |
      operationId: getBalance
      parameters:
        - name: keyId
          in: path
          required: true
          schema:
            type: string
            format: uuid
          description: A trading key bound to the subaccount. The address.
      responses:
        '200':
          description: The balance, as a five-place decimal string.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Balance'
        '400':
          description: That key does not reach a subaccount.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorBody'
              example:
                code: NOT_A_SUBACCOUNT_KEY
                message: That key does not reach a subaccount.
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
        '404':
          description: No subaccount carries that ID.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorBody'
              example:
                code: SUBACCOUNT_NOT_FOUND
                message: subaccount not found
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
      x-codeSamples:
        - lang: bash
          source: |
            HOST=https://api.qa.novig.com
            KEY_ID=2c9a7e1d-5b3f-4e8a-a6d0-9f1b3c5e7a24
            PEM=novig-api-key-mgmt-1.pem
            SUB=b7c3a1e9-4d52-4a1f-9c8e-6f0a2b3d5e71

            REQ_PATH="/v3/account/subaccounts/$SUB/balance"
            QUERY=""
            BODY=''
            TS=$(date +%s000)
            HASH=$(printf %s "$BODY" \
              | openssl dgst -sha256 -r | cut -d" " -f1)

            # openssl signs a file, not a pipe. base64 -A never wraps.
            printf 'NOVIG-V3\n%s\nGET\n%s\n%s\n%s' \
              "$TS" "$REQ_PATH" "$QUERY" "$HASH" > canon.bin
            SIG=$(openssl pkeyutl -sign -rawin -inkey "$PEM" \
              -in canon.bin | openssl base64 -A)

            curl -s -X GET "$HOST$REQ_PATH${QUERY:+?$QUERY}" \
              -H "Novig-Key-Id: $KEY_ID" \
              -H "Novig-Timestamp: $TS" \
              -H "Novig-Signature: $SIG"
        - lang: rust
          source: |
            use base64::prelude::*;
            use ed25519_dalek::pkcs8::DecodePrivateKey;
            use ed25519_dalek::{Signer, SigningKey};
            use reqwest::blocking::{Client, Request};
            use reqwest::{Method, Url};
            use sha2::{Digest, Sha256};
            use std::time::{SystemTime, UNIX_EPOCH};

            const HOST: &str = "https://api.qa.novig.com";
            const KEY_ID: &str =
                "2c9a7e1d-5b3f-4e8a-a6d0-9f1b3c5e7a24";
            const PEM: &str = "novig-api-key-mgmt-1.pem";
            const SUB: &str = "b7c3a1e9-4d52-4a1f-9c8e-6f0a2b3d5e71";

            fn main() -> anyhow::Result<()> {
                let key = Key::load(KEY_ID, PEM)?;
                let client = Client::new();
                let path = format!(
                    "/v3/account/subaccounts/{SUB}/balance");
                let url = format!("{HOST}{path}");
                let req = client
                    .get(url)
                    .build()?
                    .sign(&key)?;
                println!("{}", client.execute(req)?.text()?);
                Ok(())
            }

            /// An API key: the id the server looks up, and the
            /// private half that signs.
            struct Key {
                id: &'static str,
                signer: SigningKey,
            }

            impl Key {
                fn load(id: &'static str, pem: &str) -> anyhow::Result<Self> {
                    let signer =
                        SigningKey::read_pkcs8_pem_file(pem)?;
                    Ok(Self { id, signer })
                }
            }

            /// Signs a built request over the method, path, query and
            /// body it will send, so the two can never disagree.
            trait Sign: Sized {
                fn sign(self, key: &Key) -> anyhow::Result<Self>;
            }

            impl Sign for Request {
                fn sign(mut self, key: &Key) -> anyhow::Result<Self> {
                    let ts = SystemTime::now()
                        .duration_since(UNIX_EPOCH)?
                        .as_millis()
                        .to_string();
                    let body = self.body().and_then(|b| b.as_bytes());
                    let body = body.unwrap_or_default();
                    let canon = Canonical::new(
                        &ts,
                        self.method(),
                        self.url(),
                        body,
                    );
                    let sig = key.signer.sign(canon.0.as_bytes());
                    let sig = BASE64_STANDARD.encode(sig.to_bytes());
                    let headers = self.headers_mut();
                    headers.insert("Novig-Key-Id", key.id.parse()?);
                    headers.insert("Novig-Timestamp", ts.parse()?);
                    headers.insert("Novig-Signature", sig.parse()?);
                    Ok(self)
                }
            }

            /// The six NOVIG-V3 lines, joined by LF.
            struct Canonical(String);

            impl Canonical {
                fn new(
                    ts: &str,
                    method: &Method,
                    url: &Url,
                    body: &[u8],
                ) -> Self {
                    let query =
                        Query::from(url.query().unwrap_or(""));
                    let hash = format!("{:x}", Sha256::digest(body));
                    let method = method.as_str();
                    let path = url.path();
                    let lines = [
                        "NOVIG-V3", ts, method, path, &query.0, &hash,
                    ];
                    Self(lines.join("\n"))
                }
            }

            /// Each part decoded and re-encoded, then sorted by
            /// name and value.
            struct Query(String);

            impl From<&str> for Query {
                fn from(raw: &str) -> Self {
                    let mut pairs = raw
                        .split('&')
                        .filter(|pair| !pair.is_empty())
                        .map(|pair| {
                            pair.split_once('=').unwrap_or((pair, ""))
                        })
                        .map(|(k, v)| {
                            (Self::encode(k), Self::encode(v))
                        })
                        .collect::<Vec<_>>();
                    pairs.sort();
                    let pairs =
                        pairs.iter().map(|(k, v)| format!("{k}={v}"));
                    Self(pairs.collect::<Vec<_>>().join("&"))
                }
            }

            impl Query {
                fn encode(part: &str) -> String {
                    Self::decode(part)
                        .iter()
                        .map(|&b| match b {
                            b'-' | b'.' | b'_' | b'~' => {
                                (b as char).to_string()
                            }
                            _ if b.is_ascii_alphanumeric() => {
                                (b as char).to_string()
                            }
                            _ => format!("%{b:02X}"),
                        })
                        .collect()
                }

                /// Only `%XX` decodes. A bare `+` stays a `+`.
                fn decode(part: &str) -> Vec<u8> {
                    let raw = part.as_bytes();
                    let mut out = Vec::with_capacity(raw.len());
                    let mut i = 0;
                    while i < raw.len() {
                        let escape =
                            raw.get(i + 1..i + 3).and_then(Self::hex);
                        match (raw[i], escape) {
                            (b'%', Some(byte)) => {
                                out.push(byte);
                                i += 3;
                            }
                            (byte, _) => {
                                out.push(byte);
                                i += 1;
                            }
                        }
                    }
                    out
                }

                fn hex(pair: &[u8]) -> Option<u8> {
                    let hi = (pair[0] as char).to_digit(16)?;
                    let lo = (pair[1] as char).to_digit(16)?;
                    Some((hi * 16 + lo) as u8)
                }
            }
        - lang: python
          source: |
            import base64, hashlib, time, urllib.request
            from cryptography.hazmat.primitives.serialization import (
                load_pem_private_key)

            HOST = "https://api.qa.novig.com"
            KEY_ID = "2c9a7e1d-5b3f-4e8a-a6d0-9f1b3c5e7a24"
            PEM = "novig-api-key-mgmt-1.pem"
            SUB = "b7c3a1e9-4d52-4a1f-9c8e-6f0a2b3d5e71"

            path = f"/v3/account/subaccounts/{SUB}/balance"
            query = ""
            body = b""

            ts = str(int(time.time() * 1000))
            canon = "\n".join(["NOVIG-V3", ts, "GET", path, query,
                               hashlib.sha256(body).hexdigest()])
            key = load_pem_private_key(open(PEM, "rb").read(), None)
            headers = {
                "Novig-Key-Id": KEY_ID,
                "Novig-Timestamp": ts,
                "Novig-Signature": base64.b64encode(
                    key.sign(canon.encode())).decode(),
            }
            url = f"{HOST}{path}"
            req = urllib.request.Request(
                url, data=body or None,
                method="GET", headers=headers)
            print(urllib.request.urlopen(req).read().decode())
        - lang: typescript
          source: |
            import {
              createHash, createPrivateKey, sign,
            } from "node:crypto";
            import { readFileSync } from "node:fs";

            const HOST = "https://api.qa.novig.com";
            const KEY_ID = "2c9a7e1d-5b3f-4e8a-a6d0-9f1b3c5e7a24";
            const PEM = "novig-api-key-mgmt-1.pem";
            const SUB = "b7c3a1e9-4d52-4a1f-9c8e-6f0a2b3d5e71";

            const path = `/v3/account/subaccounts/${SUB}/balance`;
            const query = "";
            const body = "";

            const ts = Date.now().toString();
            const hash =
              createHash("sha256").update(body).digest("hex");
            const canon = [
              "NOVIG-V3", ts, "GET", path, query, hash,
            ].join("\n");
            const key = createPrivateKey(readFileSync(PEM));
            const headers: Record<string, string> = {
              "Novig-Key-Id": KEY_ID,
              "Novig-Timestamp": ts,
              "Novig-Signature": sign(null, Buffer.from(canon), key)
                .toString("base64"),
            };
            const url = `${HOST}${path}`;
            const r = await fetch(url, {
              method: "GET",
              headers,
            });
            console.log(await r.text());
components:
  schemas:
    Balance:
      type: object
      properties:
        keyId:
          type: string
          format: uuid
        balance:
          type: string
          description: A decimal string with exactly five decimal places.
          examples:
            - '1234.50000'
      required:
        - keyId
        - balance
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