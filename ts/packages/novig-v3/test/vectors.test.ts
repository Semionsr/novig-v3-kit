import { describe, expect, it } from "vitest";
import vectors from "../../../../fixtures/signing-vectors.json";
import { canonicalQuery } from "../src/query.ts";
import { PrivateKey, PublicKey, bodyHash, sign, stringToSign } from "../src/sign.ts";
import { base64Decode } from "../src/pem.ts";

type V = (typeof vectors.vectors)[number];
const keypairs = vectors.keypairs as Record<string, { private_key_pkcs8_pem: string; public_key_spki_pem: string }>;

describe("Novig's 30 official NOVIG-V3 vectors", () => {
  it("has all 30", () => expect(vectors.vectors).toHaveLength(30));

  it.each(vectors.vectors.map((v: V) => [v.id, v] as const))("%s", (_id, v) => {
    const kp = keypairs[v.keypair_id]!;
    const key = PrivateKey.fromPkcs8Pem(kp.private_key_pkcs8_pem);
    const pub = PublicKey.fromSpkiPem(kp.public_key_spki_pem);
    const i = v.input;
    expect(stringToSign({ timestamp: i.timestamp, method: i.method, path: i.path, query: i.query, body: i.body })).toBe(v.string_to_sign);
    expect(bodyHash(i.body)).toBe(v.body_hash);
    const ours = sign({ keyId: "k", key }, { timestamp: i.timestamp, method: i.method, path: i.path, query: i.query, body: i.body });
    if (v.algorithm === "ed25519") {
      expect(ours.headers["Novig-Signature"]).toBe(v.signature);
    } else {
      expect(pub.verify(v.string_to_sign, v.signature)).toBe(true);
      expect(pub.verify(ours.stringToSign, ours.headers["Novig-Signature"])).toBe(true);
      const der = base64Decode(ours.headers["Novig-Signature"]);
      expect(der[0]).toBe(0x30);
      expect(der.length).toBeGreaterThanOrEqual(68);
    }
    expect(pub.verify(v.string_to_sign.replace("NOVIG-V3", "NOVIG-V2"), v.signature)).toBe(false);
  });
});

describe("canonical query extras", () => {
  it("handles unencoded input and broken escapes like Rust does", () => {
    expect(canonicalQuery("lang=ü")).toBe("lang=%C3%BC");
    expect(canonicalQuery("a=100%")).toBe("a=100%25");
    expect(canonicalQuery("a=%zz")).toBe("a=%25zz");
  });
});

describe("keys", () => {
  it("round-trips a generated Ed25519 key through PEM", () => {
    const k = PrivateKey.generate("Ed25519");
    const back = PrivateKey.fromPkcs8Pem(k.toPkcs8Pem());
    const s = sign({ keyId: "k", key: back }, { method: "GET", path: "/v3/keys" });
    expect(PublicKey.fromSpkiPem(k.publicKey().toSpkiPem()).verify(s.stringToSign, s.headers["Novig-Signature"])).toBe(true);
  });
  it("signs and verifies P-256 with a generated key", () => {
    const k = PrivateKey.generate("P-256");
    const s = sign({ keyId: "k", key: k }, { method: "POST", path: "/v3/echo", body: "{}" });
    expect(k.publicKey().verify(s.stringToSign, s.headers["Novig-Signature"])).toBe(true);
  });
});
