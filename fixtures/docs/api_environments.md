> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Environments

> The host for each environment, and how keys work across them.

export const WEB_PROFILE = "https://novig.com/Profile/ProfileScreen";

export const HOST_VAR = "NOVIG_HOST";

export const QA_PROFILE = "https://novig-mobile-app--qa.expo.app/Profile/ProfileScreen";

export const QA_APP_HOST = "https://novig-mobile-app--qa.expo.app";

export const PROD_HOST = "https://api.novig.com";

export const V3_WS_HOST = "wss://api.qa.novig.com";

export const V3_HOST = "https://api.qa.novig.com";

Every example on this site reads the host from <code>{HOST_VAR}</code>. Set it once:

```bash theme={"dark"}
export NOVIG_HOST=https://api.qa.novig.com
```

| Environment | Host                     | Money | Location check |
| ----------- | ------------------------ | ----- | -------------- |
| QA          | <code>{V3_HOST}</code>   | Test  | Yes            |
| Production  | <code>{PROD_HOST}</code> | Real  | Yes            |

In both environments, you create a key on Profile after an identity check.

In QA, use <a href={QA_PROFILE}>Profile</a> in the QA app. In Production, use <a href={WEB_PROFILE}>Profile</a> on novig.com.

QA's identity check accepts only test values. Get them from [Set up a QA account](#set-up-a-qa-account) before you start.

The websocket uses the same host as REST. On QA, that's <code>{V3_WS_HOST}</code>.

## Set up a QA account

QA has its own web app at <a href={QA_APP_HOST}>{QA_APP_HOST}</a>. It runs on test money, so you can trade without risk.

<Warning>
  **Don't enter your real details or card in QA.** The identity check and deposit accept only the test values below.
</Warning>

| Field             | Test value            |
| ----------------- | --------------------- |
| Date of birth     | April 1, 1975         |
| Phone number      | `+14257789900`        |
| Verification code | `123456`              |
| Card number       | `4242 4242 4242 4242` |
| CVV               | `123`                 |
| Expiry            | `12/30`               |

Any name and address work for the card. A ZIP code of `99999` declines it.

QA caps each card payment at \$95. To fund more, make several payments of \$95 or less.

These values pass only in QA. Production runs a real identity check and charges a real card.

<Steps>
  <Step title="Sign up">Open the <a href={QA_APP_HOST}>QA app</a> and sign up with Google.</Step>
  <Step title="Pass the identity check">Enter the test date of birth and phone number from the table, not your own, then the test code.</Step>
  <Step title="Deposit">Add the test card from the table, then deposit up to \$95 per payment.</Step>
  <Step title="Create a key">Open <a href={QA_PROFILE}>Profile</a>, then press **Settings** and **Novig API**.</Step>
</Steps>

## Each environment has its own keys

A key works only in the environment where you created it.
Production rejects a QA key with `api key not found`.
Store each environment's keypair in its own secret.

## Switch environments

1. Point <code>{HOST_VAR}</code> at the new host.
2. Create a keypair in that environment.
3. Re-run the [Quickstart](/api/quickstart) to test your signature.
