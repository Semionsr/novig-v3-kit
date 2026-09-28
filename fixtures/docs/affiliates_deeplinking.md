> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Deeplinking

> Direct users into the Novig app with pre-populated bet slips

## Overview

Deeplinking allows you to send users directly from your platform into the Novig app with a pre-populated bet slip. Novig supports both mobile and web deeplinks.

<Note>
  Always include your Partner ID in deeplinks to ensure proper attribution tracking.
</Note>

<Warning>
  You must detect your user's platform via their **User-Agent** and use the appropriate URL scheme:

  * **Desktop / mobile web** users → use `novig.com/events/...`
  * **iOS / Android native app** users → use `novigapp://events/...`

  Using the wrong scheme will result in a broken experience — web links won't open the native app, and `novigapp://` links won't work in a desktop browser.
</Warning>

## Web Deeplinking

For desktop and web users, use the `novig.com` domain.

### URL Structure

```
novig.com/events/<outcome_id>/<partner_id>/<wager_amount>?referralCode=YOUR_CODE
```

| Parameter      | Required | Description                                             |
| -------------- | -------- | ------------------------------------------------------- |
| `outcome_id`   | Yes      | The outcome ID(s) for the bet slip                      |
| `partner_id`   | Yes      | Used for tracking all deeplinked trading activity       |
| `wager_amount` | No       | Optional pre-filled wager amount (requires partner\_id) |
| `referralCode` | No       | Recommended - credits new sign-ups to your partnership  |

<Tip>
  Including `?referralCode=YOUR_CODE` is highly recommended to capture sign-up credits from users who register through your deeplinks.
</Tip>

### Straight Bet Example

Single outcome with partner ID, 10 Novig Cash, and referral code:

```
novig.com/events/abc123-event-uuid/novig/10?referralCode=YOUR_CODE
```

### Parlay Example

For parlays, separate multiple outcome IDs with commas:

```
novig.com/events/<outcome_id>,<outcome_id>,<outcome_id>/<partner_id>/<wager_amount>?referralCode=YOUR_CODE
```

Example with three legs:

```
novig.com/events/abc123,def456,ghi789/partner_code/25?referralCode=YOUR_CODE
```

## Native App Deeplinking

For native app integrations use the custom URL scheme:

```
novigapp://events/<outcome_id>,<outcome_id>,<outcome_id>/<partner_id>?referralCode=YOUR_CODE
```

## Best Practices

<CardGroup cols={2}>
  <Card title="Always Include Partner ID" icon="check">
    Ensures all trading activity is properly attributed to your partnership.
  </Card>

  <Card title="Include Referral Code" icon="user-plus">
    Append `?referralCode=YOUR_CODE` to credit new sign-ups to your partnership.
  </Card>
</CardGroup>
