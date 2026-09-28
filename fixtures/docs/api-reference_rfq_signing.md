> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Webhook signing

> Check the X-Novig-Signature header on each RFQ webhook.

Every `/quote`, `/confirm`, and `/ping` request we send carries an `X-Novig-Signature` header.
Check it on every request.
A valid signature proves the request came from us and that nobody changed the body on the way.

## How we sign

The signature is a BLAKE3 keyed hash of the raw request body.

```text theme={"dark"}
X-Novig-Signature = hex(BLAKE3_keyed_hash(shared_secret_bytes, raw_body_bytes))
```

| Part      | Value                                            |
| --------- | ------------------------------------------------ |
| Algorithm | BLAKE3 keyed hash                                |
| Key       | Your shared secret, decoded from hex to 32 bytes |
| Message   | The raw bytes of the request body                |
| Output    | 32 bytes, as 64 lowercase hex characters         |

Your shared secret comes from the `POST /rfq/pricer` response. [Registration](/api-reference/rfq/registration#your-shared-secret) explains it.

<Warning>
  Hash the body bytes exactly as you received them, before you parse the JSON. Parsing and re-serializing changes whitespace or key order, and the signature won't match.
</Warning>

## Check a signature

Use a BLAKE3 library and a constant-time comparison.

<CodeGroup>
  ```python Python theme={"dark"}
  import hmac
  import os

  from blake3 import blake3  # pip install blake3

  SECRET = bytes.fromhex(os.environ["NOVIG_RFQ_SECRET"])

  def verify(raw_body: bytes, signature: str) -> bool:
      expected = blake3(raw_body, key=SECRET).hexdigest()
      return hmac.compare_digest(expected, signature)
  ```

  ```javascript Node.js theme={"dark"}
  // npm install @noble/hashes
  import { timingSafeEqual } from "node:crypto";
  import { blake3 } from "@noble/hashes/blake3.js";
  import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

  const SECRET = hexToBytes(process.env.NOVIG_RFQ_SECRET);

  export function verify(rawBody, signature) {
    const expected = Buffer.from(bytesToHex(blake3(rawBody, { key: SECRET })));
    const received = Buffer.from(signature ?? "");
    return expected.length === received.length && timingSafeEqual(expected, received);
  }
  ```

  ```rust Rust theme={"dark"}
  // blake3::Hash compares in constant time.
  fn verify(secret: &[u8; 32], raw_body: &[u8], signature: &str) -> bool {
      blake3::Hash::from_hex(signature)
          .is_ok_and(|received| received == blake3::keyed_hash(secret, raw_body))
  }
  ```
</CodeGroup>

Pass `verify` the raw body as bytes and the value of the `X-Novig-Signature` header.

## Reject a bad signature

Return `401` when the signature doesn't match.
Don't process the body, echo it back, or log the signature.

Never answer a bad signature with a 2xx status.
A 2xx tells the sender you accepted the request.

## Test your check

Call [`POST /rfq/pricer/ping`](/api-reference/rfq/registration#test-your-webhook).
We send a real signed request to your `/ping` handler and report how you answered.
Run it before any live RFQ depends on your check.
