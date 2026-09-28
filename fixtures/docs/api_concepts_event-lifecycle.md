> ## Documentation Index
> Fetch the complete documentation index at: https://docs.novig.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Event lifecycle

> The states an event moves through, and how its markets settle.

## Event states

<svg className="sd" viewBox="0 0 600 190" role="img" aria-label="Event states: OPEN_PREGAME to OPEN_INGAME to FINAL along the top. DELAYED and CANCELED sit below.">
  <path className="sd-edge" d="M150,48 H236" />

  <path className="sd-head" d="M236,48 L229,51.5 L229,44.5 z" />

  <g><text className="sd-label" x="193" y="40" textAnchor="middle">GOLIVE</text></g>

  <path className="sd-edge" d="M364,48 H466" />

  <path className="sd-head" d="M466,48 L459,51.5 L459,44.5 z" />

  <path className="sd-edge" d="M110,66 L236,150" />

  <path className="sd-head" d="M236,150 L228.2,149 L232.1,143.2 z" />

  <path className="sd-edge" d="M280,66 V136" />

  <path className="sd-head" d="M280,136 L276.5,129 L283.5,129 z" />

  <g><text className="sd-label" x="274" y="106" textAnchor="end">UNLIVE</text></g>

  <path className="sd-edge" d="M324,140 V70" />

  <path className="sd-head" d="M324,70 L327.5,77 L320.5,77 z" />

  <g><text className="sd-label" x="330" y="106" textAnchor="start">GOLIVE</text></g>

  <path className="sd-edge" d="M364,62 L466,144" />

  <path className="sd-head" d="M466,144 L458.4,142.3 L462.7,136.9 z" />

  <path className="sd-edge" d="M364,158 H466" />

  <path className="sd-head" d="M466,158 L459,161.5 L459,154.5 z" />

  <g className="sd-box sd-cream"><rect x="20" y="30" width="130" height="36" rx="2" /><circle cx="141" cy="39" r="2.5" /><text x="30" y="52">OPEN\_PREGAME</text></g>
  <g className="sd-box sd-blue"><rect x="240" y="30" width="124" height="36" rx="2" /><circle cx="355" cy="39" r="2.5" /><text x="250" y="52">OPEN\_INGAME</text></g>
  <g className="sd-box sd-green"><rect x="470" y="30" width="90" height="36" rx="2" /><circle cx="551" cy="39" r="2.5" /><text x="480" y="52">FINAL</text></g>
  <g className="sd-box sd-amber"><rect x="240" y="140" width="124" height="36" rx="2" /><circle cx="355" cy="149" r="2.5" /><text x="250" y="162">DELAYED</text></g>
  <g className="sd-box sd-cream"><rect x="470" y="140" width="110" height="36" rx="2" /><circle cx="571" cy="149" r="2.5" /><text x="480" y="162">CANCELED</text></g>
</svg>

<p className="tree-foot">The top row is the normal path. <code>DELAYED</code> pauses an event before or during the game.</p>

| Status         | Tradable | Fees    | Terminal |
| -------------- | -------- | ------- | -------- |
| `OPEN_PREGAME` | ✓        |         |          |
| `OPEN_INGAME`  | ✓        | `taker` |          |
| `DELAYED`      | ✓        |         |          |
| `FINAL`        |          |         | ✓        |
| `CANCELED`     |          |         | ✓        |

<Warning>
  When an event goes live (`GOLIVE`), we void every resting order on its markets. Each order's `cancel` event gives the reason in `cancel.reason`.
</Warning>

`DELAYED` is a pause before or during the game. When the event reopens, its book is cleared.

The Fees column applies to a market whose `fee.charged` is `WHEN_LIVE`, which includes every game market.
A futures event never reaches `OPEN_INGAME`, and its league sets its fee schedule.
See [Which schedule a market is on](/api/concepts/fees#which-schedule-a-market-is-on).

## Settlement

When an event ends, we grade each of its markets.
The grade sets the status of every outcome in the market at once.

| Grade        | Outcome status                   | A contract pays                        |
| ------------ | -------------------------------- | -------------------------------------- |
| `Winner`     | `WIN` on one, `LOSS` on the rest | Full value on `WIN`, nothing on `LOSS` |
| `Pushes`     | `PUSH` on every outcome          | Its collateral back                    |
| `FMV(price)` | One price per outcome            | `price` × full value                   |

<svg className="sd" viewBox="0 0 600 340" role="img" aria-label="Market status: OPEN to CLOSED to SETTLED, with a dashed remediation edge back to CLOSED. Outcome status: TBD to WIN, LOSS, PUSH, or FMV(price), with a dashed remediation edge back to TBD.">
  <g><text className="sd-lane" x="20" y="18">MARKET STATUS</text></g>

  <path className="sd-edge" d="M110,48 H226" />

  <path className="sd-head" d="M226,48 L219,51.5 L219,44.5 z" />

  <g><text className="sd-label" x="168" y="40" textAnchor="middle">close</text></g>

  <path className="sd-edge" d="M330,48 H446" />

  <path className="sd-head" d="M446,48 L439,51.5 L439,44.5 z" />

  <g><text className="sd-label" x="388" y="40" textAnchor="middle">grade</text></g>

  <path className="sd-edge sd-edge-dashed" d="M505,66 V86 H280 V70" />

  <path className="sd-head" d="M280,70 L283.5,77 L276.5,77 z" />

  <g><text className="sd-label" x="392" y="100" textAnchor="middle">remediation</text></g>
  <g className="sd-box sd-cream"><rect x="20" y="30" width="90" height="36" rx="2" /><circle cx="101" cy="39" r="2.5" /><text x="30" y="52">OPEN</text></g>
  <g className="sd-box sd-fill"><rect x="230" y="30" width="100" height="36" rx="2" /><circle cx="321" cy="39" r="2.5" /><text x="240" y="52">CLOSED</text></g>
  <g className="sd-box sd-green"><rect x="450" y="30" width="110" height="36" rx="2" /><circle cx="551" cy="39" r="2.5" /><text x="460" y="52">SETTLED</text></g>
  <g><text className="sd-lane" x="20" y="136">OUTCOME STATUS</text></g>

  <path className="sd-edge" d="M100,225 L296,168" />

  <path className="sd-head" d="M296,168 L290.3,173.3 L288.3,166.6 z" />

  <g><text className="sd-label" x="250" y="176" textAnchor="middle">Winner</text></g>

  <path className="sd-edge" d="M100,225 L296,212" />

  <path className="sd-head" d="M296,212 L289.2,216 L288.8,209 z" />

  <g><text className="sd-label" x="250" y="210" textAnchor="middle">Winner</text></g>

  <path className="sd-edge" d="M100,225 L296,256" />

  <path className="sd-head" d="M296,256 L288.5,258.4 L289.6,251.4 z" />

  <g><text className="sd-label" x="250" y="244" textAnchor="middle">Pushes</text></g>

  <path className="sd-edge" d="M100,225 L296,300" />

  <path className="sd-head" d="M296,300 L288.2,300.8 L290.7,294.2 z" />

  <g><text className="sd-label" x="250" y="277" textAnchor="middle">FMV</text></g>

  <path className="sd-edge sd-edge-dashed" d="M420,168 H440" />

  <path className="sd-edge sd-edge-dashed" d="M420,212 H440" />

  <path className="sd-edge sd-edge-dashed" d="M420,256 H440" />

  <path className="sd-edge sd-edge-dashed" d="M420,300 H440" />

  <path className="sd-edge sd-edge-dashed" d="M440,168 V330 H60 V247" />

  <path className="sd-head" d="M60,247 L63.5,254 L56.5,254 z" />

  <g><text className="sd-label" x="250" y="324" textAnchor="middle">remediation</text></g>
  <g className="sd-box sd-cream"><rect x="20" y="207" width="80" height="36" rx="2" /><circle cx="91" cy="216" r="2.5" /><text x="30" y="229">TBD</text></g>
  <g className="sd-box sd-green"><rect x="300" y="150" width="120" height="36" rx="2" /><circle cx="411" cy="159" r="2.5" /><text x="310" y="172">WIN</text></g>
  <g className="sd-box sd-orange"><rect x="300" y="194" width="120" height="36" rx="2" /><circle cx="411" cy="203" r="2.5" /><text x="310" y="216">LOSS</text></g>
  <g className="sd-box sd-cream"><rect x="300" y="238" width="120" height="36" rx="2" /><circle cx="411" cy="247" r="2.5" /><text x="310" y="260">PUSH</text></g>
  <g className="sd-box sd-cream"><rect x="300" y="282" width="120" height="36" rx="2" /><circle cx="411" cy="291" r="2.5" /><text x="310" y="304">FMV(price)</text></g>
</svg>

<p className="tree-foot">A grade moves every outcome out of <code>TBD</code> at once. Remediation is the only way back.</p>

Remediation undoes a settlement.
The market returns to `CLOSED`, every outcome returns to `TBD`, and we grade the market again.
A market normally stays `SETTLED`, but remediation can move it out.

<Warning>
  **An FMV outcome's `status` is a bare decimal string, not the word `FMV`.** Treat any `status` other than `TBD`, `WIN`, `LOSS`, or `PUSH` as a price between `"0.000"` and `"1.000"`.
</Warning>

The generated TypeScript enum lists only the four words, so a price arrives outside its members.

* A market's FMV prices sum to `1.000`, so the other side of a price is `1 − price`.
* Each market voids one way, by push or by FMV, never both. We refuse a grade of the other kind.
* `PUSH` and a price are both voids, not wins. Only `WIN` and `LOSS` pay full value or nothing.
