//! NOVIG-V3 request signing (docs.novig.com/api/signing).
//!
//! Six lines joined by `\n`, no trailing newline:
//! `NOVIG-V3`, unix millis, METHOD, path (verbatim), canonical query, lowercase hex sha256(body).
//! Ed25519 signs the string directly; P-256 signs it with ECDSA/SHA-256 and sends DER.

use base64::prelude::*;
use ed25519_dalek::pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey};
use p256::ecdsa::signature::{Signer, Verifier};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::query::canonical_query;

pub const SCHEME: &str = "NOVIG-V3";
pub const KEY_ID_HEADER: &str = "Novig-Key-Id";
pub const TIMESTAMP_HEADER: &str = "Novig-Timestamp";
pub const SIGNATURE_HEADER: &str = "Novig-Signature";
/// SHA-256 of zero bytes: line 6 for every request without a body, GETs included.
pub const EMPTY_BODY_HASH: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
/// The server accepts a timestamp within this many milliseconds of its own clock.
pub const MAX_SKEW_MS: i64 = 30_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Algorithm {
    #[serde(rename = "Ed25519")]
    Ed25519,
    #[serde(rename = "P-256")]
    P256,
}

impl Algorithm {
    pub fn as_str(self) -> &'static str {
        match self {
            Algorithm::Ed25519 => "Ed25519",
            Algorithm::P256 => "P-256",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    #[error("not a PKCS#8 Ed25519 or P-256 private key: {0}")]
    UnsupportedKey(String),
    #[error("signature is not valid base64: {0}")]
    BadBase64(#[from] base64::DecodeError),
    #[error("signature does not verify")]
    BadSignature,
}

/// The private half of an API key.
#[derive(Clone)]
pub enum PrivateKey {
    Ed25519(ed25519_dalek::SigningKey),
    P256(p256::ecdsa::SigningKey),
}

impl std::fmt::Debug for PrivateKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PrivateKey({})", self.algorithm().as_str())
    }
}

impl PrivateKey {
    /// Reads the `.pem` the Novig app downloads when you create a key (PKCS#8, either algorithm).
    pub fn from_pkcs8_pem(pem: &str) -> Result<Self, KeyError> {
        if let Ok(k) = ed25519_dalek::SigningKey::from_pkcs8_pem(pem) {
            return Ok(Self::Ed25519(k));
        }
        p256::ecdsa::SigningKey::from_pkcs8_pem(pem)
            .map(Self::P256)
            .map_err(|e| KeyError::UnsupportedKey(e.to_string()))
    }

    /// A fresh keypair, e.g. for `POST /v3/account/subaccounts`, which takes the public half.
    pub fn generate(algorithm: Algorithm) -> Self {
        let mut rng = rand_core::OsRng;
        match algorithm {
            Algorithm::Ed25519 => Self::Ed25519(ed25519_dalek::SigningKey::generate(&mut rng)),
            Algorithm::P256 => Self::P256(p256::ecdsa::SigningKey::random(&mut rng)),
        }
    }

    pub fn algorithm(&self) -> Algorithm {
        match self {
            Self::Ed25519(_) => Algorithm::Ed25519,
            Self::P256(_) => Algorithm::P256,
        }
    }

    pub fn public_key(&self) -> PublicKey {
        match self {
            Self::Ed25519(k) => PublicKey::Ed25519(k.verifying_key()),
            Self::P256(k) => PublicKey::P256(*k.verifying_key()),
        }
    }

    pub fn to_pkcs8_pem(&self) -> String {
        let pem = match self {
            Self::Ed25519(k) => k.to_pkcs8_pem(Default::default()),
            Self::P256(k) => k.to_pkcs8_pem(Default::default()),
        };
        pem.expect("encoding an in-memory key cannot fail").to_string()
    }

    /// Raw signature bytes over `message`: 64 bytes for Ed25519, DER (70-72 bytes) for P-256.
    pub fn sign_bytes(&self, message: &[u8]) -> Vec<u8> {
        match self {
            Self::Ed25519(k) => ed25519_dalek::Signer::sign(k, message).to_bytes().to_vec(),
            Self::P256(k) => {
                let sig: p256::ecdsa::Signature = k.sign(message);
                sig.to_der().as_bytes().to_vec()
            }
        }
    }
}

/// The public half, as registered with Novig. Used here to verify, which the P-256 test
/// vectors need (ECDSA signatures are randomized, so they can't be compared byte for byte).
#[derive(Clone, Debug)]
pub enum PublicKey {
    Ed25519(ed25519_dalek::VerifyingKey),
    P256(p256::ecdsa::VerifyingKey),
}

impl PublicKey {
    pub fn from_spki_pem(pem: &str) -> Result<Self, KeyError> {
        if let Ok(k) = ed25519_dalek::VerifyingKey::from_public_key_pem(pem) {
            return Ok(Self::Ed25519(k));
        }
        p256::ecdsa::VerifyingKey::from_public_key_pem(pem)
            .map(Self::P256)
            .map_err(|e| KeyError::UnsupportedKey(e.to_string()))
    }

    pub fn to_spki_pem(&self) -> String {
        match self {
            Self::Ed25519(k) => k.to_public_key_pem(Default::default()),
            Self::P256(k) => k.to_public_key_pem(Default::default()),
        }
        .expect("encoding an in-memory key cannot fail")
    }

    /// Checks a `Novig-Signature` header value against a string to sign.
    pub fn verify(&self, string_to_sign: &str, signature_b64: &str) -> Result<(), KeyError> {
        let raw = BASE64_STANDARD.decode(signature_b64)?;
        let ok = match self {
            Self::Ed25519(k) => ed25519_dalek::Signature::from_slice(&raw)
                .map(|s| k.verify_strict(string_to_sign.as_bytes(), &s).is_ok())
                .unwrap_or(false),
            Self::P256(k) => p256::ecdsa::Signature::from_der(&raw)
                .map(|s| k.verify(string_to_sign.as_bytes(), &s).is_ok())
                .unwrap_or(false),
        };
        if ok { Ok(()) } else { Err(KeyError::BadSignature) }
    }
}

/// A key id plus its private half: everything needed to sign a request.
#[derive(Clone, Debug)]
pub struct Credentials {
    pub key_id: String,
    pub key: PrivateKey,
}

impl Credentials {
    pub fn new(key_id: impl Into<String>, key: PrivateKey) -> Self {
        Self { key_id: key_id.into(), key }
    }

    pub fn from_pem(key_id: impl Into<String>, pem: &str) -> Result<Self, KeyError> {
        Ok(Self::new(key_id, PrivateKey::from_pkcs8_pem(pem)?))
    }

    /// Signs one request. `raw_query` is the query exactly as it will be sent, without `?`.
    /// `body` must be the exact bytes on the wire: re-serializing JSON changes the hash.
    pub fn sign(&self, method: &str, path: &str, raw_query: &str, body: &[u8]) -> SignedHeaders {
        self.sign_at(now_millis(), method, path, raw_query, body)
    }

    pub fn sign_at(&self, ts: i64, method: &str, path: &str, raw_query: &str, body: &[u8]) -> SignedHeaders {
        let string_to_sign = string_to_sign(ts, method, path, raw_query, body);
        let signature = BASE64_STANDARD.encode(self.key.sign_bytes(string_to_sign.as_bytes()));
        SignedHeaders { key_id: self.key_id.clone(), timestamp: ts.to_string(), signature, string_to_sign }
    }
}

/// The three headers every signed request carries, plus the string they cover (for debugging).
#[derive(Clone, Debug, serde::Serialize)]
pub struct SignedHeaders {
    pub key_id: String,
    pub timestamp: String,
    pub signature: String,
    pub string_to_sign: String,
}

impl SignedHeaders {
    pub fn pairs(&self) -> [(&'static str, &str); 3] {
        [
            (KEY_ID_HEADER, self.key_id.as_str()),
            (TIMESTAMP_HEADER, self.timestamp.as_str()),
            (SIGNATURE_HEADER, self.signature.as_str()),
        ]
    }
}

/// Builds the six-line string. The path is never normalized or decoded, and line 5 is always
/// present even when empty.
pub fn string_to_sign(ts: i64, method: &str, path: &str, raw_query: &str, body: &[u8]) -> String {
    [
        SCHEME,
        &ts.to_string(),
        &method.to_ascii_uppercase(),
        path,
        &canonical_query(raw_query),
        &body_hash(body),
    ]
    .join("\n")
}

pub fn body_hash(body: &[u8]) -> String {
    hex::encode(Sha256::digest(body))
}

pub fn now_millis() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).expect("clock before 1970").as_millis() as i64
}
