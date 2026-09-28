> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Order lifecycle

> The five order statuses, and the events that move an order between them.

Every status change arrives as an event on the [private stream](/api/streaming/private).
The status you read over REST is a snapshot of the same state.

<svg className="sd" viewBox="0 0 620 230" role="img" aria-label="Order states: PENDING leads to OPEN, FILLED, CANCELED, or REJECTED. OPEN loops on a partial fill and leads to FILLED or CANCELED.">
  <path className="sd-edge" d="M130,115 L246,56" />

  <path className="sd-head" d="M246,56 L241.3,62.3 L238.2,56.1 z" />

  <g><text className="sd-label" x="176" y="78" textAnchor="end">open</text></g>

  <path className="sd-edge" d="M350,48 H476" />

  <path className="sd-head" d="M476,48 L469,51.5 L469,44.5 z" />

  <g><text className="sd-label" x="413" y="40" textAnchor="middle">fill</text></g>

  <path className="sd-edge" d="M350,60 L476,115" />

  <path className="sd-head" d="M476,115 L468.2,115.4 L471,109 z" />

  <g><text className="sd-label" x="440" y="82" textAnchor="start">cancel</text></g>

  <path className="sd-edge" d="M75,107 V14 H540 V26" />

  <path className="sd-head" d="M540,26 L536.5,19 L543.5,19 z" />

  <g><text className="sd-label" x="82" y="64" textAnchor="start">fill</text></g>

  <path className="sd-edge" d="M275,66 C275,94 325,94 325,70" />

  <path className="sd-head" d="M325,70 L328.5,77 L321.5,77 z" />

  <g><text className="sd-label" x="300" y="106" textAnchor="middle">partial fill</text></g>

  <path className="sd-edge" d="M130,125 H476" />

  <path className="sd-head" d="M476,125 L469,128.5 L469,121.5 z" />

  <g><text className="sd-label" x="420" y="119" textAnchor="middle">cancel</text></g>

  <path className="sd-edge" d="M130,135 L476,197" />

  <path className="sd-head" d="M476,197 L468.5,199.2 L469.7,192.3 z" />

  <g><text className="sd-label" x="300" y="184" textAnchor="middle">reject</text></g>
  <g className="sd-box sd-cream"><rect x="20" y="107" width="110" height="36" rx="2" /><circle cx="121" cy="116" r="2.5" /><text x="30" y="129">PENDING</text></g>
  <g className="sd-box sd-blue"><rect x="250" y="30" width="100" height="36" rx="2" /><circle cx="341" cy="39" r="2.5" /><text x="260" y="52">OPEN</text></g>
  <g className="sd-box sd-green"><rect x="480" y="30" width="120" height="36" rx="2" /><circle cx="591" cy="39" r="2.5" /><text x="490" y="52">FILLED</text></g>
  <g className="sd-box sd-cream"><rect x="480" y="107" width="120" height="36" rx="2" /><circle cx="591" cy="116" r="2.5" /><text x="490" y="129">CANCELED</text></g>
  <g className="sd-box sd-orange"><rect x="480" y="184" width="120" height="36" rx="2" /><circle cx="591" cy="193" r="2.5" /><text x="490" y="206">REJECTED</text></g>
</svg>

<p className="tree-foot">Every order starts <code>PENDING</code>. A resting order is <code>OPEN</code>. The right column holds the three final states.</p>

| Event                   | From             | To         |
| ----------------------- | ---------------- | ---------- |
| `open`                  | `PENDING`        | `OPEN`     |
| `fill`, `remaining > 0` | `OPEN`           | `OPEN`     |
| `fill`, `remaining = 0` | `PENDING` `OPEN` | `FILLED`   |
| `cancel`                | `PENDING` `OPEN` | `CANCELED` |
| `reject`                | `PENDING`        | `REJECTED` |

* `open` means the order is resting. Any fills that matched when it entered the book arrive first.
* A partial `fill` keeps the order `OPEN` and shrinks `remaining`.
* `cancel` means you canceled the order, it expired, or we voided it. An `IOC` order that fills in part cancels the rest.
* `reject` means we refused the order after accepting it. An `IOC`, `FOK`, or `PO` order that fills nothing is rejected.

| Status     | Means                                   | Terminal |
| ---------- | --------------------------------------- | -------- |
| `PENDING`  | Accepted, waiting on the exchange       |          |
| `OPEN`     | Resting on the book                     |          |
| `FILLED`   | Completely filled                       | ✓        |
| `CANCELED` | Left the book unfilled or partly filled | ✓        |
| `REJECTED` | Refused after acceptance                | ✓        |

<Note>
  There's no `PARTIALLY_FILLED` status. Track `remaining` instead.
</Note>

## Track order state

<Steps>
  <Step title="Subscribe first">Subscribe to orders on the private stream before you place an order.</Step>
  <Step title="Take a snapshot">Take a snapshot of your open orders and its sequence number, `seq`.</Step>
  <Step title="Apply events in order">Apply events in `seq` order. If you see a gap, take a new snapshot.</Step>
  <Step title="Key on orderId">Key your state on `orderId`.</Step>
</Steps>
