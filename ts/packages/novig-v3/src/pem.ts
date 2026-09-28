/**
 * Just enough DER to read the keys Novig hands out: PKCS#8 private keys and SPKI public keys for
 * Ed25519 and P-256. No Node `crypto`, so this runs in Hermes / React Native too.
 */

export type Algorithm = "Ed25519" | "P-256";

const OID_ED25519 = "1.3.101.112";
const OID_EC_PUBLIC_KEY = "1.2.840.10045.2.1";
const OID_P256 = "1.2.840.10045.3.1.7";

interface Node {
  tag: number;
  start: number; // content start
  end: number; // content end
}

function readNode(buf: Uint8Array, pos: number): Node {
  const tag = buf[pos]!;
  let len = buf[pos + 1]!;
  let start = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[start + i]!;
    start += n;
  }
  return { tag, start, end: start + len };
}

function children(buf: Uint8Array, node: Node): Node[] {
  const out: Node[] = [];
  let p = node.start;
  while (p < node.end) {
    const c = readNode(buf, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

function oid(buf: Uint8Array, n: Node): string {
  const b = buf.subarray(n.start, n.end);
  const parts = [Math.floor(b[0]! / 40), b[0]! % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = (v << 7) | (b[i]! & 0x7f);
    if (!(b[i]! & 0x80)) {
      parts.push(v);
      v = 0;
    }
  }
  return parts.join(".");
}

export function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return base64Decode(b64);
}

/** PKCS#8 → raw private scalar/seed (32 bytes) and its algorithm. */
export function parsePkcs8(pem: string): { algorithm: Algorithm; raw: Uint8Array } {
  const der = pemToDer(pem);
  const top = readNode(der, 0);
  const [, algId, keyOctets] = children(der, top);
  if (!algId || !keyOctets) throw new Error("not a PKCS#8 private key");
  const [algOid, param] = children(der, algId);
  const alg = oid(der, algOid!);
  if (alg === OID_ED25519) {
    // privateKey OCTET STRING wraps another OCTET STRING holding the 32-byte seed.
    const inner = readNode(der, keyOctets.start);
    return { algorithm: "Ed25519", raw: der.slice(inner.start, inner.end) };
  }
  if (alg === OID_EC_PUBLIC_KEY && param && oid(der, param) === OID_P256) {
    // ECPrivateKey ::= SEQUENCE { version, privateKey OCTET STRING, ... }
    const ec = readNode(der, keyOctets.start);
    const [, priv] = children(der, ec);
    return { algorithm: "P-256", raw: der.slice(priv!.start, priv!.end) };
  }
  throw new Error(`unsupported key algorithm ${alg}`);
}

/** SPKI → raw public key bytes (32 for Ed25519, 65 uncompressed for P-256). */
export function parseSpki(pem: string): { algorithm: Algorithm; raw: Uint8Array } {
  const der = pemToDer(pem);
  const top = readNode(der, 0);
  const [algId, bits] = children(der, top);
  const [algOid] = children(der, algId!);
  const alg = oid(der, algOid!);
  const raw = der.slice(bits!.start + 1, bits!.end); // skip the unused-bits byte
  if (alg === OID_ED25519) return { algorithm: "Ed25519", raw };
  if (alg === OID_EC_PUBLIC_KEY) return { algorithm: "P-256", raw };
  throw new Error(`unsupported key algorithm ${alg}`);
}

const PKCS8_ED25519_PREFIX = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
const SPKI_ED25519_PREFIX = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
const SPKI_P256_PREFIX = [0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00];

export function ed25519Pkcs8Pem(seed: Uint8Array): string {
  return toPem("PRIVATE KEY", Uint8Array.from([...PKCS8_ED25519_PREFIX, ...seed]));
}

export function spkiPem(algorithm: Algorithm, raw: Uint8Array): string {
  const prefix = algorithm === "Ed25519" ? SPKI_ED25519_PREFIX : SPKI_P256_PREFIX;
  return toPem("PUBLIC KEY", Uint8Array.from([...prefix, ...raw]));
}

function toPem(label: string, der: Uint8Array): string {
  const b64 = base64Encode(der).replace(/(.{64})/g, "$1\n").trim();
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard, padded base64 (what `Novig-Signature` must be). */
export function base64Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? "=" : B64[c & 63]!;
  }
  return out;
}

/** Accepts standard or url-safe, padded or not (so the Signature Lab can diagnose either). */
export function base64Decode(s: string): Uint8Array {
  const clean = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error(`invalid base64 character ${JSON.stringify(ch)}`);
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
