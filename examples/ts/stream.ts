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
  if (e.type === "orders") console.log("your orders:", e.events.map((o) => o.kind));
  if (e.type === "gap") console.log("missed a message, fixing it:", e.subject);
});
stream.connect().subscribe({ private: ["orders"] });
