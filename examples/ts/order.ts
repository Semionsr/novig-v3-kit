import { readFileSync } from "node:fs";
import { NovigClient, PrivateKey } from "@semion/novig-v3";

const client = new NovigClient({
  env: "qa",
  credentials: {
    keyId: process.env.NOVIG_TRADING_KEY_ID!,
    key: PrivateKey.fromPkcs8Pem(readFileSync("trading.pem", "utf8")),
  },
});

const { items } = await client.markets({ limit: 20 });
const market = items.find((m) => m.status === "OPEN")!;
console.log("market:", market.description);

const order = await client.placeOrder({
  outcomeId: market.outcomes[0]!.outcomeId,
  price: "0.010",
  qty: 100,
  tif: "PO",
});
console.log("placed:", order.orderId);

await client.cancelOrder(order.orderId);
console.log("canceled");
