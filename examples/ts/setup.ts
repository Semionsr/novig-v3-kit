import { readFileSync, writeFileSync } from "node:fs";
import { NovigClient, PrivateKey } from "@semion/novig-v3";

const manager = new NovigClient({
  env: "qa",
  credentials: {
    keyId: process.env.NOVIG_KEY_ID!,
    key: PrivateKey.fromPkcs8Pem(readFileSync("management.pem", "utf8")),
  },
});

// A trading key belongs to a subaccount. Make one, fund it, save the key.
const tradingKey = PrivateKey.generate("Ed25519");
const sub = await manager.openSubaccount({
  label: "my-bot",
  publicKey: tradingKey.publicKey().toSpkiPem(),
  algorithm: "Ed25519",
});
await manager.transfer(sub.keyId, { direction: "fund", amount: "10" });

writeFileSync("trading.pem", tradingKey.toPkcs8Pem(), { mode: 0o600 });
console.log(`export NOVIG_TRADING_KEY_ID=${sub.keyId}`);
