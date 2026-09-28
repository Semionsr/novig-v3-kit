> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Futures Markets

> Integrating Novig futures markets into your platform

## Overview

Novig offers futures markets for NBA, MLB, NHL, WNBA, Tennis, and special events like the Olympics. This guide explains how futures are structured and how to integrate them into your platform.

## Event Types

The `Event` class has a `type` field that can be:

| Type         | Description                                             |
| ------------ | ------------------------------------------------------- |
| `Game`       | Standard game/match events (what you currently support) |
| `Future`     | Futures markets (championship winners, MVPs, etc.)      |
| `Tournament` | Tournament-level events                                 |

<Warning>
  To avoid collisions between Games and Futures, modify your existing queries to explicitly filter on event type.
</Warning>

## Filtering by Event Type

Add the `type` filter to your queries:

```graphql theme={"dark"}
query GetGames {
  event(where: {
    type: { _eq: "Game" },
    league: { _eq: "NBA" }
  }) {
    description
  }
}
```

## Querying Futures

```graphql theme={"dark"}
query GetFutures {
  event(where: {
    type: { _eq: "Future" },
    league: { _eq: "NBA" }
  }) {
    description
    markets {
      description
      competitor {
        name
      }
      player {
        name
      }
      outcomes {
        competitor {
          name
        }
        description
      }
    }
  }
}
```

## Key Differences from Game Events

<Info>
  `Future` type events do **not** have a `game` field.
</Info>

The `scheduled_start` and `league` fields are now available directly inside `Event` for futures:

```graphql theme={"dark"}
query GetFutures {
  event(where: { type: { _eq: "Future" } }) {
    scheduled_start  # Available directly on Event
    league           # Available directly on Event
    description
  }
}
```

<Note>
  These fields still exist in `Event.game` for backwards compatibility with Game events.
</Note>

## Example Futures Response

```json theme={"dark"}
{
  "data": {
    "event": [
      {
        "description": "Eastern Conference Winner",
        "markets": [
          {
            "description": "Cleveland Cavaliers EASTERN_CONFERENCE_WINNER",
            "competitor": {
              "name": "Cleveland Cavaliers"
            },
            "player": null,
            "outcomes": [
              { "competitor": null, "description": "Yes" },
              { "competitor": null, "description": "No" }
            ]
          }
        ]
      },
      {
        "description": "Detroit Pistons vs New York Knicks - Series Winner",
        "markets": [
          {
            "description": "DET",
            "competitor": null,
            "player": null,
            "outcomes": [
              {
                "competitor": { "name": "Detroit Pistons" },
                "description": "DET"
              },
              {
                "competitor": { "name": "New York Knicks" },
                "description": "NYK"
              }
            ]
          }
        ]
      },
      {
        "description": "Finals MVP",
        "markets": [
          {
            "description": "Donovan Mitchell FINALS_MVP",
            "competitor": null,
            "player": {
              "name": "Donovan Mitchell"
            },
            "outcomes": [
              { "competitor": null, "description": "Yes" },
              { "competitor": null, "description": "No" }
            ]
          }
        ]
      }
    ]
  }
}
```

## Futures Market Types

<CardGroup cols={2}>
  <Card title="Team Futures" icon="users">
    Markets related to a specific team (e.g., "Cavs to win Eastern Conference") have a reference to the `competitor` directly from the market.
  </Card>

  <Card title="Player Futures" icon="user">
    Markets related to a specific player (e.g., "Nikola Jokic Finals MVP") have a reference to the `player` directly from the market.
  </Card>

  <Card title="Series Futures" icon="trophy">
    Series futures involving an outcome for each team have references to the relevant `competitor` directly from each outcome.
  </Card>

  <Card title="Placeholder Events" icon="clock">
    Some futures exist but have no markets. These are placeholders that will likely be supported in the future.
  </Card>
</CardGroup>

## Understanding Futures Order Book

When looking at orders in futures markets, the same bid logic applies:

| Scenario                     | Interpretation                           |
| ---------------------------- | ---------------------------------------- |
| BID on NO at 0.36, qty 45000 | Someone risks \$162 to win \$288         |
| Available liquidity          | Shows on YES at 0.64, \$288 to win \$162 |

<Tip>
  A BID order represents what someone wants to BUY, so it appears as available liquidity on the **opposite** outcome.
</Tip>

## Special Events

### Olympics

Novig launches special event markets like Olympics Hockey. These use dedicated leagues:

```graphql theme={"dark"}
query GetOlympicsHockey {
  event(where: {
    league: { _eq: "Olympics Hockey Men" }
  }) {
    description
    markets {
      description
      outcomes {
        description
      }
    }
  }
}
```

Olympics events include:

* **Game events** for each head-to-head matchup with MONEY, SPREAD, and TOTAL markets
* **Futures events** with CHAMPIONSHIP\_WINNER markets for each country

## Best Practices

<Steps>
  <Step title="Filter Explicitly">
    Always filter by `type` to separate Game and Future events in your queries.
  </Step>

  <Step title="Handle Empty Markets">
    Some future events may have no markets - these are placeholders for future support.
  </Step>

  <Step title="Check Competitor/Player References">
    Use the `competitor` and `player` fields on markets and outcomes to properly identify the subject of futures bets.
  </Step>

  <Step title="Monitor New Leagues">
    Watch for announcements about new leagues and special events being added.
  </Step>
</Steps>
