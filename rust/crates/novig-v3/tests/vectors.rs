//! Every official NOVIG-V3 test vector (fixtures/signing-vectors.json, published by Novig).
//! Ed25519 is deterministic, so signatures must match byte for byte. P-256 is randomized, so
//! we check that Novig's signature verifies and that ours verifies under the same public key.

use novig_v3::sign::{self, PrivateKey, PublicKey};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
struct File {
    keypairs: HashMap<String, Keypair>,
    vectors: Vec<Vector>,
}

#[derive(Deserialize)]
struct Keypair {
    private_key_pkcs8_pem: String,
    public_key_spki_pem: String,
}

#[derive(Deserialize)]
struct Vector {
    id: String,
    algorithm: String,
    keypair_id: String,
    input: Input,
    string_to_sign: String,
    body_hash: String,
    signature: String,
}

#[derive(Deserialize)]
struct Input {
    timestamp: i64,
    method: String,
    path: String,
    query: String,
    body: String,
}

fn load() -> File {
    let raw = include_str!("../../../../fixtures/signing-vectors.json");
    serde_json::from_str(raw).expect("vectors parse")
}

#[test]
fn all_thirty_vectors() {
    let file = load();
    assert_eq!(file.vectors.len(), 30, "Novig publishes 30 vectors");
    for v in &file.vectors {
        let kp = &file.keypairs[&v.keypair_id];
        let private = PrivateKey::from_pkcs8_pem(&kp.private_key_pkcs8_pem).unwrap();
        let public = PublicKey::from_spki_pem(&kp.public_key_spki_pem).unwrap();
        let i = &v.input;

        let s = sign::string_to_sign(i.timestamp, &i.method, &i.path, &i.query, i.body.as_bytes());
        assert_eq!(s, v.string_to_sign, "{}: string to sign", v.id);
        assert_eq!(sign::body_hash(i.body.as_bytes()), v.body_hash, "{}: body hash", v.id);

        let creds = novig_v3::Credentials::new("00000000-0000-0000-0000-000000000000", private);
        let ours = creds.sign_at(i.timestamp, &i.method, &i.path, &i.query, i.body.as_bytes());
        match v.algorithm.as_str() {
            "ed25519" => assert_eq!(ours.signature, v.signature, "{}: Ed25519 signature", v.id),
            "ecdsa-p256" => {
                public.verify(&v.string_to_sign, &v.signature).unwrap_or_else(|_| panic!("{}: Novig's sig", v.id));
                public.verify(&ours.string_to_sign, &ours.signature).unwrap_or_else(|_| panic!("{}: our sig", v.id));
                let der = base64::Engine::decode(&base64::prelude::BASE64_STANDARD, &ours.signature).unwrap();
                assert!((68..=72).contains(&der.len()) && der[0] == 0x30, "{}: DER SEQUENCE", v.id);
            }
            other => panic!("unknown algorithm {other}"),
        }
    }
}

#[test]
fn a_tampered_line_fails_verification() {
    let file = load();
    let v = &file.vectors[0];
    let public = PublicKey::from_spki_pem(&file.keypairs[&v.keypair_id].public_key_spki_pem).unwrap();
    let tampered = v.string_to_sign.replacen("GET", "POST", 1);
    assert!(public.verify(&tampered, &v.signature).is_err());
}

#[test]
fn generated_keys_round_trip_through_pem() {
    for alg in [novig_v3::Algorithm::Ed25519, novig_v3::Algorithm::P256] {
        let k = PrivateKey::generate(alg);
        let back = PrivateKey::from_pkcs8_pem(&k.to_pkcs8_pem()).unwrap();
        let creds = novig_v3::Credentials::new("k", back);
        let h = creds.sign("GET", "/v3/keys", "", b"");
        let public = PublicKey::from_spki_pem(&k.public_key().to_spki_pem()).unwrap();
        public.verify(&h.string_to_sign, &h.signature).unwrap();
    }
}
