> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Parlay Pricing

> Query real-time Novig parlay prices within your UI

export const HOST_VAR = "NOVIG_HOST";

export const PROD_HOST = "https://api.novig.com";

## Overview

The Parlay Pricing API allows you to retrieve Novig's parlay price for any set of outcomes directly within your platform. This enables you to show users what price they'd get on Novig before they click through.

Every example reads the host from <code>{HOST_VAR}</code>. On Production that is <code>{PROD_HOST}</code>.

```bash theme={"dark"}
export NOVIG_HOST=https://api.novig.com
```

## Endpoint

<code>POST {PROD_HOST}/nbx/v1/parlay/request/unauthenticated</code>

## Request Format

Send a JSON body with an array of outcome IDs:

```json theme={"dark"}
{
  "outcomes": [
    { "id": "abc123-outcome-uuid" },
    { "id": "xyz789-outcome-uuid" }
  ]
}
```

## Example Request

```bash theme={"dark"}
curl -X POST "$NOVIG_HOST/nbx/v1/parlay/request/unauthenticated" \
  -H "Content-Type: application/json" \
  -d '{
    "outcomes": [
      { "id": "abc123-outcome-uuid" },
      { "id": "xyz789-outcome-uuid" },
      { "id": "def456-outcome-uuid" }
    ]
  }'
```

## Integration with Odds Platforms

Many odds platforms (like Optic Odds) can integrate Novig parlay pricing to enhance their product offering. If you're building on an odds data platform, this endpoint provides a straightforward way to add Novig parlay pricing.

## Getting Outcome IDs

To use this endpoint, you'll need valid Novig outcome IDs. You can obtain these by:

1. **GraphQL API** - Query events and markets to get outcome IDs
2. **Deeplinking** - Extract outcome IDs from Novig deeplink URLs

See the [Odds Screens](/affiliates/odds-screens) documentation for GraphQL query examples.

## Best Practices

<Steps>
  <Step title="Validate Outcomes">
    Ensure all outcome IDs are valid and from active markets before making the request.
  </Step>

  <Step title="Handle Errors">
    Implement proper error handling for invalid outcomes or unavailable markets.
  </Step>

  <Step title="Cache Appropriately">
    Parlay prices can change frequently - cache responses for a short duration only.
  </Step>

  <Step title="Display Clearly">
    When showing Novig prices alongside competitors, clearly label the source.
  </Step>
</Steps>

<Note>
  The parlay price returned is the unauthenticated price. Authenticated users with claimed boosts may receive different (boosted) pricing.
</Note>
