//! Unofficial Rust client for the Novig v3 exchange API.
//!
//! - [`sign`]: NOVIG-V3 request signing (Ed25519 and P-256), checked against all 30 official vectors
//! - [`query`]: the canonical query, the part of signing that clients most often get wrong
//! - [`types`]: the v3 wire types, money kept as exact decimals and the 279-price grid
//! - [`throttle`]: a client-side model of the six token buckets, so requests queue instead of 429ing
//! - [`client`]: typed REST for every v3 route, public and signed
//! - [`book`]: an L3 order book that applies snapshots and deltas exactly as the exchange sends them
//! - [`ws`]: one websocket for every channel, with nonces, heartbeats and gap recovery

pub mod book;
pub mod mock;
pub mod client;
pub mod query;
pub mod seq;
pub mod sign;
pub mod throttle;
pub mod types;
pub mod ws;

pub use client::{Client, Environment, Error};
pub use sign::{Algorithm, Credentials, PrivateKey, PublicKey};
