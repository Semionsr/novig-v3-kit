> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# LP onboarding

> How to get API access to Novig as a Liquidity Provider (LP)

A Liquidity Provider (LP) is a trader who supplies prices for others to trade against.
This page covers how to get API access as an LP, and how RFQ trades are charged.

## Onboarding steps

<Steps>
  <Step title="Contact us">
    Email **[developers@novig.com](mailto:developers@novig.com)** and tell us whether you're an individual or an entity.
    We'll reply with what we need to open the account: a W-9, and for an entity, its legal name and EIN.
  </Step>

  <Step title="QA access">
    Once we have your details, we'll give you access to QA, our test environment, within **2 business days**.
  </Step>

  <Step title="Initial deposit">
    Before you go live, we generally require a minimum deposit of **\$30,000** to your API account.
  </Step>

  <Step title="Production access">
    You're then fully onboarded with production API access, and you trade on the standard [fee schedule](/fees).
  </Step>
</Steps>

<Note>
  There's no application form, no market-making contract to negotiate, and no opt-in step for Maker Credits.
  The Ludlow Member Agreement and the Rulebook govern your account, the same as any other Member.
</Note>

## RFQ trades

An [RFQ](/api-reference/rfq/overview) (request for quote) trade is a combination contract, and it has its own fee schedule.

The taker pays a fee with a coefficient of **0.10** on every execution, whether or not the event is live:

```
RFQ Taker Fee  =  0.10  ×  wager  ×  collateral  ÷  (wager + collateral)
```

The maker is the LP who prices the RFQ.
The maker pays no fee, but earns **no Maker Credit**, because combination contracts are excluded from the [Maker Credit Program](/maker-credit-program).

Receiving RFQs is opt-in.
Registering a pricer is a separate step, and you don't need it to trade the order book.

<Note>
  These coefficients are the current schedule, posted under Rule 3.6 of the Ludlow Rulebook.
  Read them from [Trading Fees](/fees) rather than hardcoding a rate you can't update.
</Note>
