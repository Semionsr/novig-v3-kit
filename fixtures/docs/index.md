> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> Trade sports contracts on the Novig exchange through our API.

<div id="hero">
  <div id="hero-body">
    <h1>Just Sports</h1>

    <p>
      Place orders with signed REST requests. Watch the order book and your fills on one websocket.
    </p>

    <div id="hero-actions">
      <a href="/api/quickstart">Quickstart</a>
      <a href="/api-reference/spec-files/openapi-v3-target.json" className="hero-secondary">OpenAPI 3.1</a>
    </div>
  </div>
</div>

## Start

<Steps>
  <Step title={<a href="/api/concepts/account-model">Account model</a>}>
    Each subaccount has its own balance and its own trading key.
  </Step>

  <Step title={<a href="/api/api-keys">Get a key</a>}>
    You create your management key in your Novig profile. It opens and funds subaccounts but can't place orders.
  </Step>

  <Step title={<a href="/api/signing">Sign a request</a>}>
    Sign every request with Ed25519 or P-256, and test your code against our 30 sample signatures.
  </Step>

  <Step title={<a href="/api/quickstart">Test your signature</a>}>
    `POST /v3/echo` returns your body with a `200` when your signature is correct.
  </Step>

  <Step title={<a href="/api/subaccounts/manage">Open a subaccount</a>}>
    Your management key opens a subaccount, registers its trading key, and funds it.
  </Step>

  <Step title={<a href="/api/execution/orders">Trade</a>}>
    Find a market in the [catalog](/api/catalog), place an [order](/api/execution/orders), and follow it on the [private stream](/api/streaming/private).
  </Step>
</Steps>

Hostnames for each environment are on [Environments](/api/environments). The full API is in the [OpenAPI document](/api-reference/spec-files/openapi-v3-target.json).
