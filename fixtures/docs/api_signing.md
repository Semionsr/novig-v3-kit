> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Sign a request

> Sign every request with NOVIG-V3, and test your signer against our vectors.

export const VECTOR_COUNT = 30;

export const EMPTY_BODY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const SIGNATURE_HEADER = "Novig-Signature";

export const TIMESTAMP_HEADER = "Novig-Timestamp";

export const KEY_ID_HEADER = "Novig-Key-Id";

export const ALGORITHMS = ["Ed25519", "P-256"];

export const SKEW = "30 s";

export const SCHEME = "NOVIG-V3";

Every request carries three headers, `GET` requests included.

One header holds a signature. You sign a canonical string: six lines of text built from the request, in a fixed format.

| Item               | Value                    |
| ------------------ | ------------------------ |
| Scheme             | <code>{SCHEME}</code>    |
| Algorithms         | {ALGORITHMS.join(" · ")} |
| Allowed clock skew | ±{SKEW}                  |
| Test route         | `POST /v3/echo`          |

Clock skew is how far your clock can differ from ours.

## Headers

| Header                          | Holds                     | In the string |
| ------------------------------- | ------------------------- | ------------- |
| <code>{KEY_ID_HEADER}</code>    | The key's UUID            | No            |
| <code>{TIMESTAMP_HEADER}</code> | Unix time in milliseconds | Line 2        |
| <code>{SIGNATURE_HEADER}</code> | The signature             | —             |

* Write the timestamp as an unpadded decimal. It must be within ±{SKEW} of our clock.
* Encode the raw signature bytes as standard base64, with padding.

We read the algorithm from the stored key, so no header carries it.

## The canonical string

```text theme={"dark"}
NOVIG-V3
{unix_millis}
{METHOD}
{path}
{canonical_query}
{lowercase_hex(sha256(raw_body))}
```

1. The literal <code>{SCHEME}</code>.
2. The same value as <code>{TIMESTAMP_HEADER}</code>. A leading zero changes the string.
3. The method, in uppercase ASCII.
4. The path, never the full URL. Start at the leading `/` and include the mount prefix, verbatim.
5. The [canonical query](#the-canonical-query), or an empty string. The line is always present.
6. The SHA-256 of the raw body bytes, in lowercase hex.

Never normalize or percent-decode the path.
`/v3/keys` and `/v3/keys/` are different paths.

With no body, line 6 is the hash of zero bytes: `e3b0c442…7852b855`.
A literal `{}` body gives a different hash.

<Note>
  Hash the exact bytes you send, and send them with `Content-Type: application/json`. Re-serialized JSON changes the hash.
</Note>

Without a content type, the server never captures the body.
It hashes zero bytes instead.

Here's the string for `GET /v3/keys` at timestamp `1755000000000`:

<div className="cstr">
  <div className="cstr-row">
    <span className="cstr-n">1</span>

    <code className="cstr-v v-scheme">
      {SCHEME}
    </code>
  </div>

  <div className="cstr-row">
    <span className="cstr-n">2</span>
    <code className="cstr-v v-ts">1755000000000</code>
  </div>

  <div className="cstr-row">
    <span className="cstr-n">3</span>
    <code className="cstr-v v-method">GET</code>
  </div>

  <div className="cstr-row">
    <span className="cstr-n">4</span>
    <code className="cstr-v v-path">/v3/keys</code>
  </div>

  <div className="cstr-row">
    <span className="cstr-n">5</span>
    <code className="cstr-v v-query"> </code>
  </div>

  <div className="cstr-row">
    <span className="cstr-n">6</span>

    <code className="cstr-v v-body">
      {EMPTY_BODY_HASH}
    </code>
  </div>

  <div className="cstr-foot">Joined by <code>LF</code>. No trailing newline.</div>
</div>

## The canonical query

Build line 5 from the raw query string in six steps:

1. Split the raw query on `&`.
2. Split each pair at the first `=`. A pair with no `=` has an empty value.
3. URI-decode both parts, reading `%XX` as UTF-8. A bare `+` stays a literal `+`.
4. Re-encode both parts. Keep `ALPHA DIGIT - . _ ~` as is, and write everything else as `%XX` in uppercase hex.
5. Sort bytewise by name, then by value, keeping repeats. `Z` (0x5A) sorts before `a` (0x61).
6. Join the pairs with `&`.

<Note>
  Our edge strips `Expires`, `Key-Pair-Id`, `Policy`, and `Signature` from the query. A request that signs one of them fails, and nothing shows why.
</Note>

## Algorithms

| `algorithm` | Signs with                   | Signature        |
| ----------- | ---------------------------- | ---------------- |
| `Ed25519`   | Ed25519, no digest           | 64 bytes         |
| `P-256`     | ECDSA `prime256v1` + SHA-256 | 70–72 bytes, DER |

Both algorithms sign the canonical string itself.
A P-256 signature is DER-encoded as `SEQUENCE { r, s }`.

<Note>
  WebCrypto's ECDSA returns raw `r‖s`, not DER, and a raw signature never verifies. Convert it to DER, or sign with Ed25519.
</Note>

## Sign in Rust

`request.sign(&key)` signs a built `reqwest` request, using the method, path, query, and body it will send.
It signs with Ed25519, and its canonical string matches all {VECTOR_COUNT} test vectors.

```rust sign.rs theme={"dark"}
use base64::prelude::*;
use ed25519_dalek::pkcs8::DecodePrivateKey;
use ed25519_dalek::{Signer, SigningKey};
use reqwest::blocking::{Client, Request};
use reqwest::{Method, Url};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

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
```

## Test vectors

A test vector is a sample request with its expected canonical string.
Use them to check your signer.

<Card title="signing-vectors.json" icon="file-code" href="/api-reference/spec-files/signing-vectors.json">
  {VECTOR_COUNT} vectors and two test keypairs, for Ed25519 and P-256. They cover every case in the table below.
</Card>

<Warning>
  Anyone can read the private half of each published keypair. Never register a published keypair.
</Warning>

The vectors catch these common mistakes:

| Case             | Wrong                 | Right                                      |
| ---------------- | --------------------- | ------------------------------------------ |
| Absent query     | Five lines            | Six, line 5 empty                          |
| Empty body       | Hash of `{}`          | Hash of zero bytes                         |
| Space            | `+`                   | `%20`                                      |
| Literal `+`      | Space                 | `%2B`                                      |
| Hex in query     | `%2f`                 | `%2F`                                      |
| Hex in body hash | `E3B0…`               | `e3b0…`                                    |
| Sort             | By name               | By name, then value                        |
| Repeated name    | Merged                | Kept and sorted                            |
| Trailing slash   | Dropped               | Kept                                       |
| `%` in path      | Decoded               | Never decoded                              |
| `=` in value     | Split                 | `token=abc=` → `token=abc%3D`              |
| Bare param       | Dropped               | `?flag` → `flag=`                          |
| Non-ASCII        | —                     | UTF-8 bytes, uppercase hex: `ü` → `%C3%BC` |
| Base64           | base64url or unpadded | Standard, padded                           |

## Test your signature

`POST /v3/echo` returns your request body byte for byte.
Like every route, echo requires a valid signature.

A `200` proves your host, key, clock, and canonical string are all correct.

Echo doesn't return the canonical string.
When echo returns `401`, sign a [test vector](#test-vectors) and diff your canonical string against its `string_to_sign`.
The first byte that differs is the bug.

For a full walkthrough, see [Quickstart](/api/quickstart).
