import { describe, expect, it } from "vitest";
import vectors from "../../../../fixtures/signing-vectors.json";
import { diagnose, explainError, type MistakeId } from "../src/diagnose.ts";
import { PrivateKey, sign, stringToSign } from "../src/sign.ts";
import { base64Encode } from "../src/pem.ts";

const ed = vectors.keypairs["ed25519-test-1"];
const vec = (id: string) => vectors.vectors.find((v) => v.id === id)!;

/** Replace one line of the correct string, as a buggy client would. */
function broken(id: string, line: number, value: string) {
  const v = vec(id);
  const lines = v.string_to_sign.split("\n");
  lines[line - 1] = value;
  return { request: { ...v.input }, theirString: lines.join("\n") };
}

const cases: Array<[MistakeId, ReturnType<typeof broken>]> = [
  ["space_as_plus", broken("ed25519_get_space_as_percent20", 5, "q=New+York")],
  ["plus_as_space", broken("ed25519_get_bare_plus_not_decoded_as_space", 5, "q=foo%20bar")],
  ["hex_case_query", broken("ed25519_get_lowercase_hex_normalised", 5, "path=%2ftmp%2ffile")],
  ["sort_name_only", broken("ed25519_get_duplicate_query_params", 5, "status=open&status=closed")],
  ["repeated_merged", broken("ed25519_get_triple_duplicate_param", 5, "league=nfl")],
  ["bare_param_dropped", broken("ed25519_get_bare_query_param", 5, "flag")],
  ["equals_in_value", broken("ed25519_get_equals_in_query_value", 5, "token=abc=")],
  ["non_ascii_raw", broken("ed25519_get_non_ascii_query_value", 5, "lang=ü")],
  ["trailing_slash", broken("ed25519_get_trailing_slash", 4, "/api/orders")],
  ["path_decoded", broken("ed25519_get_path_not_decoded", 4, "/api/v1/items/foo/bar")],
  ["hex_case_body", broken("ed25519_post_json_body", 6, vec("ed25519_post_json_body").body_hash.toUpperCase())],
  ["empty_body", broken("ed25519_post_empty_body", 6, "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a")],
  ["unsorted_query", broken("ed25519_get_query_sort_by_name", 5, "apple=1&Zebra=2")],
  ["method_case", broken("ed25519_get_simple_query", 3, "get")],
  ["timestamp_seconds", broken("ed25519_get_simple_query", 2, "1755000000")],
];

describe("names the mistake", () => {
  it.each(cases)("%s", (id, input) => {
    const d = diagnose({ ...input, now: input.request.timestamp });
    expect(d.ok).toBe(false);
    expect(d.findings.map((f) => f.id)).toContain(id);
  });

  it("five lines instead of six", () => {
    const v = vec("ed25519_get_absent_query_empty_body");
    const five = v.string_to_sign.split("\n").filter((_, i) => i !== 4).join("\n");
    const d = diagnose({ request: v.input, theirString: five, now: v.input.timestamp });
    expect(d.findings.map((f) => f.id)).toEqual(["absent_query"]);
  });

  it("re-serialized JSON body", () => {
    const body = '{"side":"BUY","price":"0.55"}';
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    const theirs = stringToSign({ timestamp: 1, method: "POST", path: "/v3/orders", body: pretty });
    const d = diagnose({ request: { timestamp: 1, method: "POST", path: "/v3/orders", body }, theirString: theirs, now: 1 });
    expect(d.findings.map((f) => f.id)).toContain("reserialized_body");
  });

  it("a correct request is clean", () => {
    const v = vec("ed25519_get_simple_query");
    const d = diagnose({ request: v.input, theirString: v.string_to_sign, signature: v.signature, publicKeyPem: ed.public_key_spki_pem, now: v.input.timestamp });
    expect(d.ok).toBe(true);
    expect(d.findings).toEqual([]);
    expect(d.signature?.validForCorrectString).toBe(true);
  });
});

describe("signature format", () => {
  const v = vec("ed25519_get_simple_query");
  it("base64url", () => {
    const url = v.signature.replace(/\+/g, "-").replace(/\//g, "_");
    const d = diagnose({ request: v.input, signature: url.includes("-") || url.includes("_") ? url : `${url.slice(0, -2)}-_`, publicKeyPem: ed.public_key_spki_pem });
    expect(d.findings.map((f) => f.id)).toContain("base64url");
  });
  it("unpadded", () => {
    const d = diagnose({ request: v.input, signature: v.signature.replace(/=+$/, ""), publicKeyPem: ed.public_key_spki_pem });
    expect(d.findings.map((f) => f.id)).toContain("base64_unpadded");
    expect(d.signature?.validForCorrectString).toBe(true);
  });
  it("P-256 raw r||s", () => {
    const p = vectors.keypairs["ecdsa-p256-test-1"];
    const key = PrivateKey.fromPkcs8Pem(p.private_key_pkcs8_pem);
    const good = sign({ keyId: "k", key }, { timestamp: 1, method: "GET", path: "/v3/keys" });
    // Fake a WebCrypto-style signature: 64 raw bytes
    const raw = base64Encode(new Uint8Array(64).fill(7));
    const d = diagnose({ request: { timestamp: 1, method: "GET", path: "/v3/keys" }, signature: raw, publicKeyPem: p.public_key_spki_pem });
    expect(d.findings.map((f) => f.id)).toContain("p256_raw_rs");
    expect(diagnose({ request: { timestamp: 1, method: "GET", path: "/v3/keys" }, signature: good.headers["Novig-Signature"], publicKeyPem: p.public_key_spki_pem }).ok).toBe(true);
  });
  it("wrong key", () => {
    const other = PrivateKey.generate("Ed25519");
    const s = sign({ keyId: "k", key: other }, { timestamp: v.input.timestamp, method: "GET", path: v.input.path, query: v.input.query });
    const d = diagnose({ request: v.input, signature: s.headers["Novig-Signature"], publicKeyPem: ed.public_key_spki_pem });
    expect(d.findings.map((f) => f.id)).toContain("signed_other_key");
  });
});

describe("explainError", () => {
  it("wrong environment", () => expect(explainError(401, { code: "SIGNATURE_REJECTED", message: "api key not found" }).fix).toMatch(/QA keys/));
  it("edge 403", () => expect(explainError(403, "<html>").title).toMatch(/edge/));
});
