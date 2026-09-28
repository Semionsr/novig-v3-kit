> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Universe model

> Sports, leagues, events, markets, and outcomes, and how they nest.

Everything you can trade sits in one hierarchy.
A sport and a league classify an event.
An event holds markets, and a market holds outcomes.
An order names one outcome.

<div className="tree">
  <div className="blk blk-fill blk-stack">Sport<span className="blk-sub">Football</span></div>

  <div className="tree-link tree-link-dashed" />

  <div className="blk blk-fill blk-stack">League<span className="blk-sub">NFL</span></div>

  <div className="tree-link tree-link-dashed" />

  <div className="blk blk-cream blk-stack">Event<span className="blk-sub">Chiefs at Bills, Sun 20:20</span></div>

  <div className="tree-link" />

  <div className="tree-cards">
    <div className="tree-card">
      <span className="tree-card-title">Moneyline</span>
      <span className="tree-meta">Market</span>

      <div className="tree-row">
        <div className="blk blk-blue blk-stack">Outcome<span className="blk-sub">Chiefs</span></div>
        <div className="blk blk-blue blk-stack">Outcome<span className="blk-sub">Bills</span></div>
      </div>
    </div>

    <div className="tree-card">
      <span className="tree-card-title">Total points</span>
      <span className="tree-meta">Market</span>

      <div className="tree-row">
        <div className="blk blk-blue blk-stack">Outcome<span className="blk-sub">Over 48.5</span></div>
        <div className="blk blk-blue blk-stack">Outcome<span className="blk-sub">Under 48.5</span></div>
      </div>
    </div>
  </div>

  <p className="tree-foot">A dashed line classifies an event. A solid line shows what it holds.</p>
</div>

| Part    | What it is                   | Holds                   | An order names it |
| ------- | ---------------------------- | ----------------------- | ----------------- |
| Sport   | A category, like football    | Leagues                 | No                |
| League  | A group within one sport     | Events                  | No                |
| Event   | One game                     | A start time and status | No                |
| Market  | One question about the event | Outcomes and a status   | No                |
| Outcome | One answer                   | Its own order book      | Yes               |

Sports and leagues are fixed lists.
They say what an event is, never when or whether it happens.
Read them from `GET /v3/types/sports` and `GET /v3/types/leagues`.

## Event

An event is one game, and its markets settle on it.

| Field            | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `sport` `league` | Names from the two fixed lists                                       |
| `status`         | Where the event is in its [lifecycle](/api/concepts/event-lifecycle) |
| `startsTs`       | Scheduled start, in Unix milliseconds                                |
| `description`    | Display text. Don't parse it                                         |

## Market

A market is one question about its event, and its outcomes are the answers.
`marketType` names the question. Read the full list from `GET /v3/types/markets`.

| `marketType`           | Outcomes    |
| ---------------------- | ----------- |
| `MONEY`                | Home, Away  |
| `SPREAD`               | Home, Away  |
| `TOTAL`                | Over, Under |
| `TEAM_TOTAL`           | Over, Under |
| `MONEYLINE_3_WAY_WIN`  | Yes, No     |
| `MONEYLINE_3_WAY_DRAW` | Yes, No     |

A player prop has Over and Under, or Yes and No.

### Three-way moneylines

A game that can end in a draw, like most soccer games, has three possible results.
It gets three separate Yes / No markets, not one market with three outcomes.

| `marketType`                     | Question                |
| -------------------------------- | ----------------------- |
| `MONEYLINE_3_WAY_WIN`, home team | Does the home team win? |
| `MONEYLINE_3_WAY_WIN`, away team | Does the away team win? |
| `MONEYLINE_3_WAY_DRAW`           | Is the game a draw?     |

<Warning>
  **`No` isn't the other team.** It means any other result: the other team wins, or the game is a draw. Use each result's own market.
</Warning>

## Outcome

An outcome is one answer to its market's question.
An order names an outcome, never a market.
Each outcome has its own order book.

```json theme={"dark"}
{
  "outcomes": [
    {
      "outcomeId": "3f2504e0-…",
      "name": "Kansas City Chiefs",
      "status": "TBD"
    },
    {
      "outcomeId": "5a1c9e73-…",
      "name": "Buffalo Bills",
      "status": "TBD"
    }
  ]
}
```

| Field       | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| `outcomeId` | What an order names. Fixed for the life of the market |
| `name`      | Display text. Don't parse it                          |
| `status`    | `TBD`, `WIN`, `LOSS`, `PUSH`, or a price              |

A market that settles at fair market value sets each outcome's `status` to a decimal price.

<Warning>
  **The `outcomes` array has no fixed order.** Don't read a side from its position. Match each outcome by its `outcomeId`.
</Warning>
