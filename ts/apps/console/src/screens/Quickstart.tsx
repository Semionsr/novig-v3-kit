/**
 * Novig's five-call quickstart as buttons, against QA. Step 0 is getting a key, which only a
 * human can do (Google sign-in + test identity), so the page walks through it.
 */
import { useState } from "react";
import { IconCheck } from "../components/icons.tsx";
import { Card, ErrorLine, Notice } from "../components/ui.tsx";
import { IS_DEMO, api, type ServerStatus } from "../lib/api.ts";

interface Step {
  n: number;
  title: string;
  call: string;
  signedBy: string;
  run: () => Promise<unknown>;
  needs?: "management" | "trading";
}

export function Quickstart({ status, refresh }: { status?: ServerStatus; refresh: () => void }) {
  const [results, setResults] = useState<Record<number, { ok: boolean; data: unknown }>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [firstOutcome, setFirstOutcome] = useState<string>("");

  const steps: Step[] = [
    { n: 1, title: "Prove the signer works", call: "POST /v3/echo", signedBy: "management", needs: "management", run: () => api.post("/api/signed/echo", { body: { hello: "novig" } }) },
    { n: 2, title: "Open a subaccount", call: "POST /v3/account/subaccounts", signedBy: "management", needs: "management", run: async () => { const r = await api.post("/api/signed/subaccounts", { label: "v3-console" }); refresh(); return r; } },
    { n: 3, title: "Fund it with $25 of test money", call: "POST /v3/account/subaccounts/{keyId}/transfer", signedBy: "management", needs: "trading", run: () => api.post("/api/signed/transfer", { amount: "25" }) },
    { n: 4, title: "List markets", call: "GET /v3/catalog/markets", signedBy: "trading", needs: "trading", run: async () => { const r: any = await api.get("/api/signed/markets?limit=5"); const o = r?.items?.[0]?.outcomes?.[0]?.outcomeId; if (o) setFirstOutcome(o); return r; } },
    { n: 5, title: "Rest an order far from the market", call: "POST /v3/orders", signedBy: "trading", needs: "trading", run: () => api.post("/api/signed/orders", { outcomeId: firstOutcome, price: "0.010", qty: 100, tif: "GTC" }) },
  ];

  const run = async (st: Step) => {
    setBusy(st.n);
    try { setResults((r) => ({ ...r, [st.n]: { ok: true, data: undefined } })); const data = await st.run(); setResults((r) => ({ ...r, [st.n]: { ok: true, data } })); }
    catch (e) { setResults((r) => ({ ...r, [st.n]: { ok: false, data: e } })); }
    finally { setBusy(null); }
  };

  return (
    <div className="stack fade-in">
      {IS_DEMO && <Notice>The quickstart signs real requests against Novig QA, so it runs locally with a QA key, see the README (<span className="kbd">make dev</span>). Keys never touch this hosted page. Markets, Signature Lab, Connection, Throttle and the reference maker all work right here.</Notice>}
      <div className="grid g2" style={{ alignItems: "start" }}>
        <Card title="0 · Get a QA key" eyebrow="one manual step">
          <ol className="footnote" style={{ paddingLeft: 18, margin: 0, lineHeight: "24px" }}>
            <li>Open <a href="https://novig-mobile-app--qa.expo.app" target="_blank" rel="noreferrer">the QA app</a> and sign up with Google.</li>
            <li>Identity check with Novig's test values only: DOB <span className="kbd">April 1, 1975</span>, phone <span className="kbd">+14257789900</span>, code <span className="kbd">123456</span>.</li>
            <li>Deposit with card <span className="kbd">4242 4242 4242 4242</span>, CVV <span className="kbd">123</span>, expiry <span className="kbd">12/30</span> (max $95 per payment).</li>
            <li>Profile → Settings → Novig API → create a <b>management</b> key and download the <span className="kbd">.pem</span>.</li>
            <li>Put it next to this kit and fill <span className="kbd">.env</span>, then restart <span className="kbd">make dev</span>:</li>
          </ol>
          <pre className="code" style={{ marginTop: 12 }}>{`NOVIG_ENV=qa\nNOVIG_KEY_ID=<management key id>\nNOVIG_PEM=keys/novig-api-key-management.pem`}</pre>
          <div className="caption fg2" style={{ marginTop: 10 }}>Keys work only in the environment that made them: a QA key on api.novig.com answers <span className="kbd">api key not found</span>. <span className="kbd">.env</span>, <span className="kbd">*.pem</span> and <span className="kbd">.novig/</span> are gitignored.</div>
        </Card>
        <Card title="Keys loaded" eyebrow={status?.env ?? ""}>
          <div className="stack" style={{ gap: 10 }}>
            <KeyRow label="Management key" v={status?.management} hint="from .env" />
            <KeyRow label="Trading key (subaccount)" v={status?.trading} hint="step 2 creates one and saves it to .novig/" />
          </div>
        </Card>
      </div>
      <Card title="Novig's quickstart, five calls" eyebrow="docs.novig.com/api/quickstart">
        {!status?.management && <Notice>Steps unlock once a management key is loaded (step 0).</Notice>}
        <div className="stack" style={{ gap: 12, marginTop: status?.management ? 0 : 14 }}>
          {steps.map((st) => {
            const r = results[st.n];
            const blocked = (st.needs === "management" && !status?.management) || (st.needs === "trading" && !status?.trading) || (st.n === 5 && !firstOutcome);
            return (
              <div key={st.n} className="finding">
                <div className="row">
                  <span className={`badge ${r?.ok && r.data !== undefined ? "pos" : ""}`}>{r?.ok && r.data !== undefined ? <IconCheck /> : st.n}</span>
                  <div>
                    <div className="medium">{st.title}</div>
                    <div className="mono fg2">{st.call} · signed by {st.signedBy} key</div>
                  </div>
                  <div className="spacer" />
                  <button className="btn sm primary" disabled={blocked || busy !== null} onClick={() => run(st)}>{busy === st.n ? "Running…" : "Run"}</button>
                </div>
                {r && !r.ok && <ErrorLine error={r.data} />}
                {r?.ok && r.data !== undefined && <pre className="code" style={{ marginTop: 10, maxHeight: 220 }}>{JSON.stringify(r.data, null, 2)}</pre>}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function KeyRow({ label, v, hint }: { label: string; v?: { keyId: string; algorithm: string } | null; hint: string }) {
  return (
    <div className="stat" style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div className="k">{label}</div>
        <div className="mono">{v ? `${v.keyId} · ${v.algorithm}` : "not loaded"}</div>
      </div>
      {v ? <span className="badge pos">ready</span> : <span className="badge caption">{hint}</span>}
    </div>
  );
}
