/**
 * "Why is my signature rejected?", answered mechanically.
 *
 * Give it the request a partner meant to send and what they actually signed (their string to
 * sign, and/or their signature plus public key), and it names the exact mistake, using the 14
 * divergence points Novig's vectors cover plus the symptoms listed under 401 on
 * docs.novig.com/api/errors. This is the tool a DevRel engineer would otherwise run by hand.
 */
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { canonicalQuery, decode, encode } from "./query.ts";
import { base64Decode } from "./pem.ts";
import { EMPTY_BODY_HASH, MAX_SKEW_MS, PublicKey, type SignInput, bodyHash, stringToSign, toBytes } from "./sign.ts";

export type MistakeId =
  | "absent_query"
  | "empty_body"
  | "space_as_plus"
  | "plus_as_space"
  | "hex_case_query"
  | "hex_case_body"
  | "sort_name_only"
  | "unsorted_query"
  | "repeated_merged"
  | "trailing_slash"
  | "path_decoded"
  | "equals_in_value"
  | "bare_param_dropped"
  | "non_ascii_raw"
  | "base64url"
  | "base64_unpadded"
  | "p256_raw_rs"
  | "method_case"
  | "timestamp_seconds"
  | "timestamp_padded"
  | "timestamp_mismatch"
  | "clock_skew"
  | "signed_full_url"
  | "missing_mount_prefix"
  | "query_in_path"
  | "reserialized_body"
  | "wrong_body"
  | "trailing_newline"
  | "crlf"
  | "wrong_scheme"
  | "signed_other_key"
  | "unknown";

export interface Finding {
  id: MistakeId;
  line?: number;
  title: string;
  wrong: string;
  right: string;
  fix: string;
  /** True for the 14 cases Novig's published vectors are designed to catch. */
  documented: boolean;
}

export interface LineDiff {
  n: number;
  label: string;
  expected: string;
  got?: string;
  ok: boolean;
}

export interface SignatureCheck {
  format: "ok" | "base64url" | "unpadded" | "raw_rs" | "wrong_length" | "invalid";
  validForCorrectString?: boolean;
  validForTheirString?: boolean;
}

export interface Diagnosis {
  ok: boolean;
  expected: string;
  lines: LineDiff[];
  findings: Finding[];
  signature?: SignatureCheck;
}

export const LINE_LABELS = ["Scheme", "Timestamp (ms)", "Method", "Path", "Canonical query", "SHA-256 of body"] as const;

const M: Record<MistakeId, Omit<Finding, "id" | "wrong" | "right" | "line">> = {
  absent_query: { title: "Line 5 was dropped", fix: "Always emit six lines. With no query, line 5 is an empty string.", documented: true },
  empty_body: { title: "Empty body hashed as `{}`", fix: "An empty body hashes zero bytes: e3b0c442…7852b855. `{}` is a different hash.", documented: true },
  space_as_plus: { title: "Space encoded as `+`", fix: "Encode a space as %20. Only `%XX` is special in NOVIG-V3.", documented: true },
  plus_as_space: { title: "Literal `+` read as a space", fix: "A bare `+` is a literal plus. Re-encode it as %2B.", documented: true },
  hex_case_query: { title: "Lowercase hex in the query", fix: "Percent-encode with uppercase hex: %2F, not %2f.", documented: true },
  hex_case_body: { title: "Uppercase hex in the body hash", fix: "Line 6 is lowercase hex.", documented: true },
  sort_name_only: { title: "Sorted by name only", fix: "Sort by encoded name, then by encoded value, keeping every repeat.", documented: true },
  unsorted_query: { title: "Query not sorted", fix: "Sort pairs bytewise by encoded name, then value. `Z` (0x5A) sorts before `a` (0x61).", documented: false },
  repeated_merged: { title: "Repeated parameter merged or dropped", fix: "Keep every occurrence of a repeated name, each as its own pair.", documented: true },
  trailing_slash: { title: "Trailing slash changed", fix: "Sign the path exactly as sent. /v3/keys and /v3/keys/ are different paths.", documented: true },
  path_decoded: { title: "Path was percent-decoded", fix: "Never decode or normalize the path. foo%2Fbar stays foo%2Fbar.", documented: true },
  equals_in_value: { title: "Split at the wrong `=`", fix: "Split each pair at the FIRST `=`. Later `=` belong to the value: token=abc= → token=abc%3D.", documented: true },
  bare_param_dropped: { title: "Bare parameter dropped", fix: "A token without `=` is a name with an empty value: ?flag → flag=.", documented: true },
  non_ascii_raw: { title: "Non-ASCII not percent-encoded as UTF-8", fix: "Encode each UTF-8 byte: ü → %C3%BC.", documented: true },
  base64url: { title: "Signature in base64url", fix: "Send standard base64 (+ and /), not url-safe (- and _).", documented: true },
  base64_unpadded: { title: "Signature base64 unpadded", fix: "Send padded base64 (with trailing =).", documented: true },
  p256_raw_rs: { title: "P-256 signature is raw r‖s", fix: "WebCrypto returns raw r‖s. Convert to DER (SEQUENCE {r, s}) or use Ed25519.", documented: false },
  method_case: { title: "Method not uppercase", fix: "Line 3 is the method in uppercase ASCII.", documented: false },
  timestamp_seconds: { title: "Timestamp in seconds", fix: "Novig-Timestamp and line 2 are Unix milliseconds.", documented: false },
  timestamp_padded: { title: "Timestamp padded", fix: "Write the timestamp as an unpadded decimal. A leading zero changes the string.", documented: false },
  timestamp_mismatch: { title: "Line 2 differs from the Novig-Timestamp header", fix: "Use one timestamp value for the header and line 2.", documented: false },
  clock_skew: { title: "Clock is off by more than 30 s", fix: "Sync the clock (NTP). The server accepts ±30 s.", documented: false },
  signed_full_url: { title: "Signed the full URL", fix: "Line 4 is the path only, starting at the leading `/`.", documented: false },
  missing_mount_prefix: { title: "Mount prefix dropped", fix: "Include the prefix verbatim: /v3/orders, not /orders.", documented: false },
  query_in_path: { title: "Query left on line 4", fix: "Line 4 stops before `?`. The query goes on line 5, canonicalized.", documented: false },
  reserialized_body: { title: "Body re-serialized after hashing", fix: "Hash the exact bytes you send. Serialize once, hash those bytes, send those bytes.", documented: false },
  wrong_body: { title: "Body hash doesn't match the body sent", fix: "Hash the raw bytes on the wire. Also send Content-Type: application/json, or the server hashes zero bytes.", documented: false },
  trailing_newline: { title: "Trailing newline", fix: "Join the six lines with \\n and add nothing after line 6.", documented: false },
  crlf: { title: "CRLF line endings", fix: "Join lines with LF (0x0A) only.", documented: false },
  wrong_scheme: { title: "Line 1 isn't NOVIG-V3", fix: "Line 1 is the literal NOVIG-V3.", documented: false },
  signed_other_key: { title: "Signature doesn't match this public key", fix: "The key id header and the private key disagree, or it's the other environment's key (QA and production keys are separate).", documented: false },
  unknown: { title: "Line differs", fix: "Diff against the expected line above.", documented: false },
};

function finding(id: MistakeId, wrong: string, right: string, line?: number): Finding {
  return { id, wrong, right, line, ...M[id] };
}

const hex = (s: string) => bytesToHex(sha256(new TextEncoder().encode(s)));

/** Wrong-but-common ways to build line 5, each labelled with the mistake it represents. */
function queryVariants(raw: string): Array<[MistakeId, string]> {
  const correct = canonicalQuery(raw);
  const tokens = raw === "" ? [] : raw.split("&");
  const pairs = tokens.map((t) => {
    const i = t.indexOf("=");
    return i < 0 ? ([t, ""] as const) : ([t.slice(0, i), t.slice(i + 1)] as const);
  });
  const enc = (s: string) => encode(decode(s));
  const out: Array<[MistakeId, string]> = [];
  out.push(["space_as_plus", correct.replace(/%20/g, "+")]);
  out.push(["plus_as_space", canonicalQuery(raw.replace(/\+/g, "%20"))]);
  out.push(["hex_case_query", correct.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())]);
  const named = pairs.map(([n, v]) => [enc(n), enc(v)] as const);
  out.push(["sort_name_only", [...named].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([n, v]) => `${n}=${v}`).join("&")]);
  out.push(["unsorted_query", named.map(([n, v]) => `${n}=${v}`).join("&")]);
  out.push(["unsorted_query", [...named].sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()) || (a[1] < b[1] ? -1 : 1)).map(([n, v]) => `${n}=${v}`).join("&")]);
  const firstOnly = new Map<string, string>();
  const lastOnly = new Map<string, string>();
  const joined = new Map<string, string[]>();
  for (const [n, v] of named) {
    if (!firstOnly.has(n)) firstOnly.set(n, v);
    lastOnly.set(n, v);
    joined.set(n, [...(joined.get(n) ?? []), v]);
  }
  const fromMap = (m: Map<string, string>) => [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([n, v]) => `${n}=${v}`).join("&");
  out.push(["repeated_merged", fromMap(firstOnly)], ["repeated_merged", fromMap(lastOnly)]);
  out.push(["repeated_merged", fromMap(new Map([...joined].map(([n, vs]) => [n, vs.sort().join("%2C")])))]);
  out.push(["bare_param_dropped", canonicalQuery(tokens.filter((t) => t.includes("=")).join("&"))]);
  out.push(["bare_param_dropped", correct.split("&").map((p) => (p.endsWith("=") ? p.slice(0, -1) : p)).join("&")]);
  out.push(["equals_in_value", canonicalQuery(tokens.map((t) => { const i = t.lastIndexOf("="); return i < 0 ? t : `${t.slice(0, i)}=${t.slice(i + 1)}`; }).join("&")).replace(/%3D=/g, "=%3D")]);
  out.push(["equals_in_value", correct.replace(/%3D/g, "=")]);
  out.push(["equals_in_value", correct.split("&").map((p) => p.replace(/%3D.*$/, "")).join("&")]);
  out.push(["non_ascii_raw", correct.replace(/(%[89A-F][0-9A-F])+/g, (m) => { try { return decodeURIComponent(m); } catch { return m; } })]);
  out.push(["non_ascii_raw", correct.replace(/%[89A-F][0-9A-F]/g, (m) => m.toLowerCase())]);
  return out.filter(([, v]) => v !== correct);
}

function pathVariants(path: string): Array<[MistakeId, string]> {
  const out: Array<[MistakeId, string]> = [];
  out.push(["trailing_slash", path.endsWith("/") ? path.slice(0, -1) : `${path}/`]);
  try {
    out.push(["path_decoded", decodeURIComponent(path)]);
  } catch {
    /* not decodable */
  }
  out.push(["missing_mount_prefix", path.replace(/^\/v\d+/, "")]);
  return out.filter(([, v]) => v !== path);
}

export interface DiagnoseInput {
  request: SignInput;
  /** What the partner's client produced as the string to sign. */
  theirString?: string;
  /** The Novig-Signature header they sent, and the public key registered for their key id. */
  signature?: string;
  publicKeyPem?: string;
  /** The Novig-Timestamp header they sent, if different from `request.timestamp`. */
  timestampHeader?: string;
  now?: number;
}

export function diagnose(input: DiagnoseInput): Diagnosis {
  const req = input.request;
  const expected = stringToSign(req);
  const exp = expected.split("\n");
  const findings: Finding[] = [];
  const add = (f: Finding) => {
    if (!findings.some((x) => x.id === f.id && x.line === f.line)) findings.push(f);
  };

  let lines: LineDiff[] = exp.map((e, i) => ({ n: i + 1, label: LINE_LABELS[i]!, expected: e, ok: true }));

  if (input.theirString !== undefined) {
    let theirs = input.theirString;
    if (theirs.includes("\r\n")) {
      add(finding("crlf", "\\r\\n", "\\n"));
      theirs = theirs.replace(/\r\n/g, "\n");
    }
    if (theirs.endsWith("\n")) {
      add(finding("trailing_newline", "ends with \\n", "no trailing newline"));
      theirs = theirs.replace(/\n+$/, "");
    }
    let got = theirs.split("\n");
    if (got.length === 5 && exp[4] === "") {
      add(finding("absent_query", `${got.length} lines`, "6 lines, line 5 empty", 5));
      got = [...got.slice(0, 4), "", got[4]!];
    }
    lines = exp.map((e, i) => ({ n: i + 1, label: LINE_LABELS[i]!, expected: e, got: got[i], ok: got[i] === e }));

    const [g1, g2, g3, g4, g5, g6] = got;
    if (g1 !== undefined && g1 !== exp[0]) add(finding("wrong_scheme", g1, exp[0]!, 1));
    if (g2 !== undefined && g2 !== exp[1]) {
      if (g2 === String(Math.floor(req.timestamp / 1000))) add(finding("timestamp_seconds", g2, exp[1]!, 2));
      else if (/^0+/.test(g2) && g2.replace(/^0+/, "") === exp[1]) add(finding("timestamp_padded", g2, exp[1]!, 2));
      else add(finding("timestamp_mismatch", g2, exp[1]!, 2));
    }
    if (g3 !== undefined && g3 !== exp[2]) add(finding(g3.toUpperCase() === exp[2] ? "method_case" : "unknown", g3, exp[2]!, 3));
    if (g4 !== undefined && g4 !== exp[3]) {
      const hit = pathVariants(req.path).find(([, v]) => v === g4);
      if (hit) add(finding(hit[0], g4, exp[3]!, 4));
      else if (/^https?:\/\//.test(g4)) add(finding("signed_full_url", g4, exp[3]!, 4));
      else if (g4.includes("?")) add(finding("query_in_path", g4, exp[3]!, 4));
      else add(finding("unknown", g4, exp[3]!, 4));
    }
    if (g5 !== undefined && g5 !== exp[4]) {
      const hits = queryVariants(req.query ?? "").filter(([, v]) => v === g5);
      if (hits.length) for (const [id] of hits) add(finding(id, g5, exp[4]!, 5));
      else add(finding("unknown", g5, exp[4]!, 5));
    }
    if (g6 !== undefined && g6 !== exp[5]) {
      const body = toBytes(req.body);
      const text = new TextDecoder().decode(body);
      if (g6.toLowerCase() === exp[5]) add(finding("hex_case_body", g6, exp[5]!, 6));
      else if (body.length === 0 && g6 === hex("{}")) add(finding("empty_body", g6, EMPTY_BODY_HASH, 6));
      else if (reserializations(text).some((r) => hex(r) === g6)) add(finding("reserialized_body", g6, exp[5]!, 6));
      else add(finding("wrong_body", g6, exp[5]!, 6));
    }
  }

  if (input.timestampHeader !== undefined && input.timestampHeader !== String(req.timestamp)) {
    add(finding("timestamp_mismatch", input.timestampHeader, String(req.timestamp), 2));
  }
  const now = input.now ?? Date.now();
  if (input.now !== undefined || input.theirString !== undefined) {
    if (Math.abs(now - req.timestamp) > MAX_SKEW_MS && req.timestamp > 1e12) {
      add(finding("clock_skew", `${Math.round((req.timestamp - now) / 1000)} s from now`, "within ±30 s", 2));
    }
  }

  let signature: SignatureCheck | undefined;
  if (input.signature !== undefined) {
    const s = input.signature.trim();
    let format: SignatureCheck["format"] = "ok";
    if (/[-_]/.test(s)) {
      format = "base64url";
      add(finding("base64url", s.slice(0, 16) + "…", "standard base64 with + and /"));
    } else if (s.length % 4 !== 0) {
      format = "unpadded";
      add(finding("base64_unpadded", `length ${s.length}`, `length ${Math.ceil(s.length / 4) * 4} with = padding`));
    }
    let raw: Uint8Array | undefined;
    try {
      raw = base64Decode(s);
    } catch {
      format = "invalid";
    }
    signature = { format };
    if (input.publicKeyPem && raw) {
      const pub = PublicKey.fromSpkiPem(input.publicKeyPem);
      if (pub.algorithm === "P-256" && raw.length === 64) {
        signature.format = "raw_rs";
        add(finding("p256_raw_rs", "64 raw bytes (r‖s)", "DER, 70-72 bytes"));
      }
      if (pub.algorithm === "Ed25519" && raw.length !== 64) signature.format = "wrong_length";
      const std = standardBase64(s);
      signature.validForCorrectString = pub.verify(expected, std);
      if (input.theirString !== undefined) signature.validForTheirString = pub.verify(input.theirString, std);
      if (!signature.validForCorrectString && !signature.validForTheirString && signature.format === "ok") {
        add(finding("signed_other_key", "verifies under neither string", "verifies under the expected string"));
      }
    }
  }

  const ok = findings.length === 0 && lines.every((l) => l.ok) && (signature?.validForCorrectString ?? true);
  return { ok, expected, lines, findings, signature };
}

function standardBase64(s: string): string {
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  return std + "=".repeat((4 - (std.length % 4)) % 4);
}

function reserializations(text: string): string[] {
  try {
    const v = JSON.parse(text);
    const sorted = (x: unknown): unknown =>
      Array.isArray(x) ? x.map(sorted) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted((x as Record<string, unknown>)[k])])) : x;
    return [JSON.stringify(v), JSON.stringify(v, null, 2), JSON.stringify(v, null, 4), JSON.stringify(sorted(v)), JSON.stringify(v).replace(/,/g, ", ").replace(/:/g, ": ")].filter((r) => r !== text);
  } catch {
    return [text.trim(), `${text}\n`].filter((r) => r !== text);
  }
}

/** Plain-English help for an error body Novig returned. */
export function explainError(status: number, body: { code?: string; message?: string } | string): { title: string; fix: string } {
  const code = typeof body === "string" ? "" : body.code ?? "";
  const msg = typeof body === "string" ? body : body.message ?? "";
  if (status === 403 && (typeof body === "string" || !code)) {
    return { title: "The edge refused it (HTML 403, no code)", fix: "It never reached Novig's servers. Usually a body over 8 KiB (a batch of about 90+ orders) or the per-IP rate. Split the batch or slow down." };
  }
  const table: Array<[RegExp, string, string]> = [
    [/header is required/, "A signing header is missing", "Send Novig-Key-Id, Novig-Timestamp and Novig-Signature on every request, GETs included."],
    [/not a valid UUID/, "Key id isn't a UUID", "Send the key's keyId (a UUID), not its label."],
    [/timestamp is not a valid integer/, "Timestamp isn't an integer", "Send unpadded decimal Unix milliseconds."],
    [/too old/, "Timestamp too old", "Send milliseconds, not seconds, and check the clock (±30 s)."],
    [/too far in the future/, "Timestamp in the future", "Your clock is ahead. Sync it (±30 s)."],
    [/api key not found/, "Key not found", "Wrong key id, or the wrong environment: QA keys only work on api.qa.novig.com and production keys on api.novig.com."],
    [/revoked/, "Key revoked", "Create a new key."],
    [/expired/, "Key expired", "Create a new key."],
    [/signature is malformed/, "Signature isn't valid base64", "Send standard, padded base64 of the raw signature bytes."],
    [/verification failed/, "Signature doesn't verify", "Paste the string you signed into the Signature Lab and diff it against the expected one."],
    [/scope is insufficient/, "Key scope too narrow", "Trading routes need a `trading` key; account routes need `management`."],
    [/KYC/, "KYC required", "Finish identity verification in the app. Cancels still work without it."],
    [/VPN or proxy/, "VPN or proxy detected", "Create keys without a VPN or proxy."],
  ];
  for (const [re, title, fix] of table) if (re.test(msg)) return { title, fix };
  const codes: Record<string, [string, string]> = {
    SIGNATURE_REJECTED: ["Signature rejected", "Read the message field, then run the request through the Signature Lab."],
    RATE_LIMIT_EXCEEDED: ["Rate limited", "Wait Retry-After seconds. Model the buckets client-side (GET /v3/limits) and queue instead of sending."],
    INVALID_PRICE: ["Price off the grid", "Snap to the 279-price grid: 0.001 steps below 0.050 and above 0.950, 0.005 steps between."],
    PRICE_BAND_VIOLATION: ["Price outside the allowed band", "Quote closer to the market."],
    TTL_REQUIRED: ["GTT needs a ttl", "Send ttl with tif GTT."],
    TTL_NOT_ALLOWED: ["ttl only goes with GTT", "Drop ttl or use tif GTT."],
    BATCH_TOO_LARGE: ["Batch too large", "Split it. The edge also caps bodies at 8 KiB (~90 orders)."],
    STALE_NONCE: ["Nonce not increasing", "Start at 1 on each connection and always increase."],
    SUBSCRIPTION_LIMIT_EXCEEDED: ["Too many watched markets", "A connection may watch up to 2,048 markets."],
    EMPTY_SELECTION: ["Empty selection", "Name at least one market, event or private channel."],
    KYC_REQUIRED: ["KYC required", "Finish identity verification in the app."],
    MARKET_CLOSED: ["Market closed", "It no longer accepts orders."],
    NOT_LIVE_TRADABLE: ["Not tradable in-game", "This market doesn't trade live."],
    GEOLOCATION_EXPIRED: ["Location check expired", "Open the Novig app on the key holder's phone to refresh geolocation."],
    GEOLOCATION_NOT_FOUND: ["Never geolocated", "The key holder must open the Novig app and pass the location check."],
    ANONYMIZED_NETWORK: ["VPN, proxy or Tor detected", "Send from a normal network. Data-center addresses are fine."],
    SYSTEM_LOCKED: ["Exchange halted", "Trading is halted; reads of keys and subaccounts still work."],
  };
  const hit = codes[code];
  if (hit) return { title: hit[0], fix: hit[1] };
  return { title: code || `HTTP ${status}`, fix: msg || "See docs.novig.com/api/errors." };
}

export { bodyHash };
