import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { NovigClient, NovigStream, PrivateKey } from "@semion/novig-v3";

const credentials = {
  keyId: process.env.NOVIG_TRADING_KEY_ID!,
  key: PrivateKey.fromPkcs8Pem(readFileSync("trading.pem", "utf8")),
};
const client = new NovigClient({ env: "qa", credentials });

const stream = new NovigStream({
  url: client.wsUrl,
  credentials,
  socketFactory: (url, headers) => new WebSocket(url, { headers }) as never,
});

stream.on((e) => {
  if (e.type === "subscribed") console.log("connected, watching your orders...");
  if (e.type === "orders") {
    for (const o of e.events) {
      if (o.kind === "open") console.log(`order open: ${o.qty} at ${o.price}  (${o.orderId})`);
      if (o.kind === "fill") console.log(`order filled: ${o.qty} at ${o.price}, ${o.remaining} left  (${o.orderId})`);
      if (o.kind === "cancel") console.log(`order canceled  (${o.orderId})`);
      if (o.kind === "reject") console.log(`order rejected  (${o.orderId})`);
    }
  }
  if (e.type === "gap") console.log(`missed a message on ${e.subject}, fixing it`);
});
stream.connect().subscribe({ private: ["orders"] });
