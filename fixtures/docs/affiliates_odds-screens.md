> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Odds Screens

> Display Novig odds using our read-only GraphQL API

export const PROD_HOST = "https://api.novig.com";

## Overview

Our read-only GraphQL API is available for odds screening platforms to display Novig prices. This allows you to show your users real-time Novig odds alongside other sportsbooks.

<Note>
  We are migrating users to our new REST API. Please see the [GraphQL to REST Migration Guide](/api-reference/migration-guides/graphql-to-rest-events) for details. You will need to obtain API keys from your representative.
</Note>

## API Endpoint

<code>{PROD_HOST}/v1/graphql</code>

## Basic Price Query

Get all prices currently offered for a specific league:

```graphql theme={"dark"}
query GetMLBPrices {
  event(where: {
    _and: [
      { _or: [
        { status: { _eq: "OPEN_PREGAME" } },
        { status: { _eq: "OPEN_INGAME" } }
      ]},
      { game: { league: { _eq: "MLB" } } }
    ]
  }) {
    description
    id
    game {
      scheduled_start
    }
    markets {
      description
      outcomes(where: {
        _or: [
          { last: { _is_null: false } },
          { available: { _is_null: false } }
        ]
      }) {
        description
        last
        available
      }
    }
  }
}
```

### Understanding Price Fields

| Field       | Description                                                                     |
| ----------- | ------------------------------------------------------------------------------- |
| `available` | The price we are currently offering                                             |
| `last`      | The last traded price (shown when we pull the available price, e.g., overnight) |

## Querying Order Book Liquidity

To get specific liquidity for all markets in a league, query the orders on each outcome. All orders are stored as **bids** (what people are willing to buy).

```graphql theme={"dark"}
query GetMLBLiquidity {
  event(where: {
    _and: [
      { _or: [
        { status: { _eq: "OPEN_PREGAME" } },
        { status: { _eq: "OPEN_INGAME" } }
      ]},
      { game: { league: { _eq: "MLB" } } }
    ]
  }) {
    description
    id
    game {
      scheduled_start
    }
    markets {
      description
      outcomes(where: {
        _or: [
          { last: { _is_null: false } },
          { available: { _is_null: false } }
        ]
      }) {
        description
        orders(where: {
          status: { _eq: "OPEN" },
          currency: { _eq: "CASH" }
        }) {
          status
          qty
          price
        }
      }
    }
  }
}
```

### Example Response

```json theme={"dark"}
{
  "data": {
    "event": [
      {
        "description": "Chicago White Sox @ Baltimore Orioles",
        "id": "abc123-event-uuid",
        "game": {
          "scheduled_start": "2029-09-03T22:35:00+00:00"
        },
        "markets": [
          {
            "description": "CWS @ BAL t7.5",
            "outcomes": [
              {
                "description": "Under 7.5",
                "orders": [
                  {
                    "status": "OPEN",
                    "qty": 45000,
                    "price": 0.36
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### Interpreting Order Data

<Info>
  Orders are stored as **bids** (what people want to buy), which translates to available liquidity on the opposite side.
</Info>

Using the example above:

| Field   | Value | Meaning                                  |
| ------- | ----- | ---------------------------------------- |
| `price` | 0.36  | Probability price — stake per \$1 payout |
| `qty`   | 45000 | Total ticket value in cents (\$450)      |

**Calculation:**

* Someone is willing to pay 0.36 for a \$450 total ticket
* They risk \$162 to win \$288
* This shows as available liquidity on **Over 7.5 at 0.64** for \$288 to win \$162

<Warning>
  The BID is what they want to BUY, so it appears as available liquidity on the **opposite** outcome.
</Warning>

## Optimized Query Pattern

For large queries that run slowly, fetch event IDs first, then query each event individually:

### Step 1: Get Active Event IDs

```graphql theme={"dark"}
query GetActiveEvents {
  event(where: {
    status: { _in: ["OPEN_PREGAME", "OPEN_INGAME"] },
    game: { league: { _eq: "NBA" } }
  }) {
    id
    description
  }
}
```

### Step 2: Query Orders by Event ID

```graphql theme={"dark"}
query GetEventOrders {
  event(where: { id: { _eq: "abc123-event-uuid" } }) {
    markets {
      outcomes(where: {
        _or: [
          { last: { _is_null: false } },
          { available: { _is_null: false } }
        ]
      }) {
        description
        orders(where: {
          status: { _eq: "OPEN" },
          currency: { _eq: "CASH" }
        }) {
          status
          qty
          price
        }
      }
    }
  }
}
```

<Tip>
  This two-step approach results in more queries but each individual query runs faster, which can improve overall performance for your integration.
</Tip>

## Supported Leagues

The API supports all leagues available on Novig, including:

* NFL, NBA, MLB, NHL
* NCAAF, NCAAB
* Soccer (various leagues)
* Tennis
* Golf
* And more
