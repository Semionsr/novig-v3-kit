/**
 * NOVIG-V3 request signing (docs.novig.com/api/signing).
 *
 * Six lines joined by `\n`, no trailing newline: `NOVIG-V3`, unix millis, METHOD, path (verbatim),
 * canonical query, lowercase hex sha256(body). Ed25519 signs the string; P-256 signs it with
 * ECDSA/SHA-256 and sends DER. (WebCrypto returns raw r‖s for ECDSA, which never verifies: this
 * module always emits DER.)
 */
import { ed25519 } from "@noble/curves/ed25519";
import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { canonicalQuery } from "./query.ts";
import { type Algorithm, base64Decode, base64Encode, ed25519Pkcs8Pem, parsePkcs8, parseSpki, spkiPem } from "./pem.ts";

export type { Algorithm } from "./pem.ts";

export const SCHEME = "NOVIG-V3";
export const KEY_ID_HEADER = "Novig-Key-Id";
export const TIMESTAMP_HEADER = "Novig-Timestamp";
export const SIGNATURE_HEADER = "Novig-Signature";
export const EMPTY_BODY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const MAX_SKEW_MS = 30_000;

const utf8 = new TextEncoder();

export type Body = string | Uint8Array | undefined | null;

export function toBytes(body: Body): Uint8Array {
  if (body === undefined || body === null) return new Uint8Array();
  return typeof body === "string" ? utf8.encode(body) : body;
}

export function bodyHash(body: Body): string {
  return bytesToHex(sha256(toBytes(body)));
}

export interface SignInput {
  timestamp: number;
  method: string;
  /** Path only, with the leading `/` and mount prefix, never decoded or normalized. */
  path: string;
  /** Raw query as sent, without `?`. */
  query?: string;
  /** The exact bytes on the wire. Re-serialized JSON changes the hash. */
  body?: Body;
}

export function stringToSign({ timestamp, method, path, query = "", body }: SignInput): string {
  return [SCHEME, String(timestamp), method.toUpperCase(), path, canonicalQuery(query), bodyHash(body)].join("\n");
}

export class PrivateKey {
  private constructor(
    readonly algorithm: Algorithm,
    private readonly raw: Uint8Array,
  ) {}

  static fromPkcs8Pem(pem: string): PrivateKey {
    const { algorithm, raw } = parsePkcs8(pem);
    return new PrivateKey(algorithm, raw);
  }

  static generate(algorithm: Algorithm = "Ed25519"): PrivateKey {
    return new PrivateKey(algorithm, algorithm === "Ed25519" ? randomBytes(32) : p256.utils.randomPrivateKey());
  }

  /** PKCS#8 PEM (Ed25519 only; P-256 keys are best generated where they'll be stored). */
  toPkcs8Pem(): string {
    if (this.algorithm !== "Ed25519") throw new Error("PEM export implemented for Ed25519");
    return ed25519Pkcs8Pem(this.raw);
  }

  publicKey(): PublicKey {
    const raw = this.algorithm === "Ed25519" ? ed25519.getPublicKey(this.raw) : p256.getPublicKey(this.raw, false);
    return new PublicKey(this.algorithm, raw);
  }

  /** Raw signature: 64 bytes (Ed25519) or DER (P-256). */
  signBytes(message: Uint8Array): Uint8Array {
    if (this.algorithm === "Ed25519") return ed25519.sign(message, this.raw);
    return p256.sign(sha256(message), this.raw).toDERRawBytes();
  }
}

export class PublicKey {
  constructor(
    readonly algorithm: Algorithm,
    readonly raw: Uint8Array,
  ) {}

  static fromSpkiPem(pem: string): PublicKey {
    const { algorithm, raw } = parseSpki(pem);
    return new PublicKey(algorithm, raw);
  }

  toSpkiPem(): string {
    return spkiPem(this.algorithm, this.raw);
  }

  /** Verifies a `Novig-Signature` value. OpenSSL/Node emit high-S ECDSA too, so lowS is off. */
  verify(stringToSign: string, signatureB64: string): boolean {
    try {
      const sig = base64Decode(signatureB64);
      const msg = utf8.encode(stringToSign);
      if (this.algorithm === "Ed25519") return ed25519.verify(sig, msg, this.raw);
      return p256.verify(sig, sha256(msg), this.raw, { lowS: false, format: "der" });
    } catch {
      return false;
    }
  }
}

export interface Credentials {
  keyId: string;
  key: PrivateKey;
}

export interface SignedHeaders {
  "Novig-Key-Id": string;
  "Novig-Timestamp": string;
  "Novig-Signature": string;
}

export function sign(creds: Credentials, input: Omit<SignInput, "timestamp"> & { timestamp?: number }): { headers: SignedHeaders; stringToSign: string } {
  const timestamp = input.timestamp ?? Date.now();
  const s = stringToSign({ ...input, timestamp });
  const signature = base64Encode(creds.key.signBytes(utf8.encode(s)));
  return {
    headers: { [KEY_ID_HEADER]: creds.keyId, [TIMESTAMP_HEADER]: String(timestamp), [SIGNATURE_HEADER]: signature } as SignedHeaders,
    stringToSign: s,
  };
}
