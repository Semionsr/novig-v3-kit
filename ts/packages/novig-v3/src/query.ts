/**
 * Line 5 of the NOVIG-V3 string to sign: the canonical query (docs.novig.com/api/signing).
 *
 * 1. split on `&`  2. split each pair at the FIRST `=` (none means empty value)
 * 3. percent-decode `%XX` only (a bare `+` stays `+`)  4. re-encode everything except
 * `ALPHA DIGIT - . _ ~` as uppercase `%XX`  5. sort bytewise by name, then value  6. join with `&`
 *
 * Works on bytes throughout, so a non-UTF-8 escape still round-trips.
 */

const utf8 = new TextEncoder();
const HEX = "0123456789ABCDEF";

export function canonicalQuery(raw: string): string {
  if (raw === "") return "";
  const pairs = raw.split("&").map((token) => {
    const i = token.indexOf("=");
    const name = i < 0 ? token : token.slice(0, i);
    const value = i < 0 ? "" : token.slice(i + 1);
    return [encode(decode(name)), encode(decode(value))] as const;
  });
  // Encoded strings are pure ASCII, so UTF-16 code-unit order is byte order.
  pairs.sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]));
  return pairs.map(([n, v]) => `${n}=${v}`).join("&");
}

/** `%XX` (either case) → byte. A `%` not followed by two hex digits stays a literal `%`. */
export function decode(part: string): Uint8Array {
  const src = utf8.encode(part);
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const b = src[i]!;
    if (b === 0x25 && i + 2 < src.length) {
      const h = hexVal(src[i + 1]!);
      const l = hexVal(src[i + 2]!);
      if (h >= 0 && l >= 0) {
        out.push((h << 4) | l);
        i += 2;
        continue;
      }
    }
    out.push(b);
  }
  return Uint8Array.from(out);
}

export function encode(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    const unreserved =
      (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x2d || b === 0x2e || b === 0x5f || b === 0x7e;
    out += unreserved ? String.fromCharCode(b) : `%${HEX[b >> 4]}${HEX[b & 15]}`;
  }
  return out;
}

/** Encodes a whole query from key/value pairs, already in canonical encoding. */
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encode(utf8.encode(k))}=${encode(utf8.encode(String(v)))}`)
    .join("&");
}

function hexVal(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  return -1;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
