/**
 * The SDK itself, as copy-paste steps. Every file shown here is imported raw from the files that
 * were run against Novig QA (rust/crates/novig-v3/examples/snippet_*.rs, examples/ts/*.ts), so the
 * page can't drift from the tested code.
 */
import { useState, type ReactNode } from "react";
import rsSetup from "../../../../../rust/crates/novig-v3/examples/snippet_setup.rs?raw";
import rsOrder from "../../../../../rust/crates/novig-v3/examples/snippet_order.rs?raw";
import rsStream from "../../../../../rust/crates/novig-v3/examples/snippet_stream.rs?raw";
import tsSetup from "../../../../../examples/ts/setup.ts?raw";
import tsOrder from "../../../../../examples/ts/order.ts?raw";
import tsStream from "../../../../../examples/ts/stream.ts?raw";
import { IconCheck } from "../components/icons.tsx";
import { Card } from "../components/ui.tsx";

const REPO = "https://github.com/Semionsr/novig-v3-kit";
type Lang = "rust" | "ts";

const LANGS: Record<Lang, {
  install: string;
  keys: string;
  files: { setup: [string, string]; order: [string, string]; stream: [string, string] };
  run: { setup: string; order: string; stream: string };
}> = {
  rust: {
    install: `cargo new my-novig-bot && cd my-novig-bot
cargo add novig-v3 --git ${REPO}
cargo add tokio --features full
cargo add anyhow
mkdir -p src/bin`,
    keys: `cp ~/Downloads/novig-api-key-*.pem management.pem
export NOVIG_KEY_ID=<API KEY ID from the app>`,
    files: { setup: ["src/bin/setup.rs", rsSetup], order: ["src/bin/order.rs", rsOrder], stream: ["src/bin/stream.rs", rsStream] },
    run: { setup: "cargo run --bin setup", order: "cargo run --bin order", stream: "cargo run --bin stream" },
  },
  ts: {
    install: `mkdir my-novig-bot && cd my-novig-bot
npm init -y && npm pkg set type=module
pnpm add "github:Semionsr/novig-v3-kit#path:ts/packages/novig-v3" ws tsx`,
    keys: `cp ~/Downloads/novig-api-key-*.pem management.pem
export NOVIG_KEY_ID=<API KEY ID from the app>`,
    files: { setup: ["setup.ts", tsSetup], order: ["order.ts", tsOrder], stream: ["stream.ts", tsStream] },
    run: { setup: "npx tsx setup.ts", order: "npx tsx order.ts", stream: "npx tsx stream.ts" },
  },
};

const INSIDE = [
  { part: "Signing: proves each request is really you", rust: "rust/crates/novig-v3/src/sign.rs", ts: "ts/packages/novig-v3/src/sign.ts" },
  { part: "Live feed: stays connected and fixes missed messages", rust: "rust/crates/novig-v3/src/ws.rs", ts: "ts/packages/novig-v3/src/ws.ts" },
  { part: "Pacing: never sends requests too fast", rust: "rust/crates/novig-v3/src/throttle.rs", ts: "ts/packages/novig-v3/src/throttle.ts" },
  { part: "Client: the simple commands you call", rust: "rust/crates/novig-v3/src/client.rs", ts: "ts/packages/novig-v3/src/client.ts" },
];

function initialLang(): Lang {
  try { return localStorage.getItem("sdk-lang") === "ts" ? "ts" : "rust"; } catch { return "rust"; }
}

export function GetSdk() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const pick = (l: Lang) => { setLang(l); try { localStorage.setItem("sdk-lang", l); } catch { /* private mode */ } };
  const L = LANGS[lang];

  return (
    <div className="stack fade-in" style={{ maxWidth: 980 }}>
      <section className="card" style={{ padding: "28px 32px" }}>
        <div className="grid g2" style={{ gap: 28 }}>
          <div>
            <div className="caps fg2" style={{ marginBottom: 8 }}>The problem</div>
            <div className="title2">Every company that wants its program to trade on Novig has to build the same tricky connection code from scratch, which takes days and is easy to get wrong.</div>
          </div>
          <div>
            <div className="caps accent" style={{ marginBottom: 8 }}>The fix</div>
            <div className="title2">This is that connection code, built once and tested, so a company can plug it in and start trading in minutes.</div>
          </div>
        </div>
      </section>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="seg">
          <button className={lang === "rust" ? "on" : ""} onClick={() => pick("rust")}>Rust</button>
          <button className={lang === "ts" ? "on" : ""} onClick={() => pick("ts")}>TypeScript</button>
        </div>
        <span className="caption fg2">Every file below ran against Novig QA on Sep 28, 2026.</span>
      </div>

      <Step n={1} title="Get a test key" note="Novig's QA exchange uses test money. Its identity check and deposit only accept Novig's published test values, never your real ones.">
        <ol className="footnote fg2" style={{ margin: 0, paddingLeft: 22, lineHeight: "26px" }}>
          <li>Open the <a href="https://novig-mobile-app--qa.expo.app" target="_blank" rel="noreferrer">QA app</a> and sign up with Google.</li>
          <li>Identity check: date of birth <span className="kbd">April 1, 1975</span>, phone <span className="kbd">+14257789900</span>, code <span className="kbd">123456</span>.</li>
          <li>Allow location when the browser asks, and wait for the location check to finish.</li>
          <li>Deposit with card <span className="kbd">4242 4242 4242 4242</span>, CVV <span className="kbd">123</span>, expiry <span className="kbd">12/30</span> (up to $95 per payment).</li>
          <li>Profile → Settings → Novig API → Create Key. It downloads a <span className="kbd">.pem</span> file and shows an API key ID.</li>
        </ol>
      </Step>

      <Step n={2} title="Make a project and install the SDK">
        <Code label="Terminal" text={L.install} />
      </Step>

      <Step n={3} title="Add your key">
        <Code label="Terminal" text={L.keys} />
      </Step>

      <Step n={4} title="Make a trading key (once)" note="Your key from the app manages the account. Trading uses a separate key for a subaccount. This makes one, puts $10 of test money in it, and saves it as trading.pem. Novig allows 5 subaccounts per account, so run it once and keep the file.">
        <Code label={L.files.setup[0]} text={L.files.setup[1]} />
        <Code label="Terminal" text={L.run.setup} />
        <p className="caption fg2" style={{ margin: 0 }}>It prints one <span className="kbd">export NOVIG_TRADING_KEY_ID=…</span> line. Paste that line into your terminal.</p>
      </Step>

      <Step n={5} title="Place an order" note="Finds an open market, rests an order far from the price so it won't fill, then cancels it.">
        <Code label={L.files.order[0]} text={L.files.order[1]} />
        <Code label="Terminal" text={L.run.order} />
      </Step>

      <Step n={6} title="Watch your orders live" note="Run this in a second terminal, then run step 5 again. You'll see your order open, then cancel.">
        <Code label={L.files.stream[0]} text={L.files.stream[1]} />
        <Code label="Terminal" text={L.run.stream} />
      </Step>

      <Card title="What's inside the SDK" eyebrow="the hard parts, so you don't write them">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Piece</th><th>{lang === "rust" ? "Rust" : "TypeScript"} file</th></tr></thead>
            <tbody>
              {INSIDE.map((r) => {
                const path = lang === "rust" ? r.rust : r.ts;
                return (
                  <tr key={r.part}>
                    <td>{r.part}</td>
                    <td><a className="mono" href={`${REPO}/blob/main/${path}`} target="_blank" rel="noreferrer">{path.split("/").pop()}</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="footnote fg2" style={{ margin: "16px 0 0", paddingLeft: 18, lineHeight: "22px" }}>
          <li>Signs the exact path, query and body bytes it sends, and always sends Content-Type on bodies</li>
          <li>Splits order batches under the edge's 8 KiB cap (~90 orders), which otherwise fails as an HTML 403</li>
          <li>Money as strings and exact decimals, prices snapped to the 279-price grid</li>
          <li>A 201 means "queued": order state comes from the private stream's open / fill / cancel / reject</li>
        </ul>
      </Card>
    </div>
  );
}

function Step({ n, title, note, children }: { n: number; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="card">
      <div className="row" style={{ marginBottom: note ? 6 : 14, flexWrap: "nowrap" }}>
        <span className="step-n">{n}</span>
        <h3 className="title3" style={{ margin: 0 }}>{title}</h3>
      </div>
      {note && <p className="footnote fg2" style={{ margin: "0 0 14px 40px" }}>{note}</p>}
      <div className="stack" style={{ gap: 12 }}>{children}</div>
    </section>
  );
}

function Code({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement("textarea");
      t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="mono caption fg2">{label}</span>
        <button className="btn sm" onClick={copy}>{copied ? <><IconCheck /> Copied</> : "Copy"}</button>
      </div>
      <pre className="code">{text.trimEnd()}</pre>
    </div>
  );
}
