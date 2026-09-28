/**
 * Signature Lab: the "why is my 401?" desk. Builds a correct NOVIG-V3 request, runs Novig's own
 * 30 test vectors in this browser, and diagnoses a partner's failing request line by line.
 * Runs entirely client-side with the TypeScript SDK; nothing leaves the page.
 */
import { LINE_LABELS, PrivateKey, PublicKey, diagnose, explainError, sign, stringToSign, bodyHash, type Diagnosis } from "@semion/novig-v3";
import vectors from "../../../../../fixtures/signing-vectors.json";
import { useMemo, useState } from "react";
import { IconCheck, IconX } from "../components/icons.tsx";
import { Card, Notice, Stat } from "../components/ui.tsx";

const KEYS = vectors.keypairs as Record<string, { private_key_pkcs8_pem: string; public_key_spki_pem: string }>;
const TEST_ED = KEYS["ed25519-test-1"]!;
const TEST_P256 = KEYS["ecdsa-p256-test-1"]!;

type KeyChoice = "ed" | "p256" | "custom";

export function SignatureLab() {
  return (
    <div className="stack fade-in">
      <Notice>
        Every signed v3 request carries <span className="kbd">Novig-Key-Id</span>, <span className="kbd">Novig-Timestamp</span> and <span className="kbd">Novig-Signature</span> over a six-line canonical string. This page builds that string, checks it against Novig's published vectors, and names the exact mistake when a partner's signature is rejected. It runs in the browser; keys never leave the page.
      </Notice>
      <div className="grid g2" style={{ alignItems: "start" }}>
        <Builder />
        <Doctor />
      </div>
      <div className="grid g2" style={{ alignItems: "start" }}>
        <Vectors />
        <ErrorExplainer />
      </div>
    </div>
  );
}

function Builder() {
  const [method, setMethod] = useState("POST");
  const [path, setPath] = useState("/v3/orders");
  const [query, setQuery] = useState("");
  const [body, setBody] = useState('{"outcomeId":"01a0e8eb-2375-7db0-92f2-84ed53c2c39c","price":"0.665","qty":110,"tif":"GTC"}');
  const [keyChoice, setKeyChoice] = useState<KeyChoice>("ed");
  const [pem, setPem] = useState("");
  const [keyId, setKeyId] = useState("5f0c6a8e-1b2d-4c3e-9f40-7a1b2c3d4e5f");
  const [fixedTs, setFixedTs] = useState(false);
  const [ts] = useState(() => Date.now());

  const result = useMemo(() => {
    try {
      const priv = keyChoice === "ed" ? TEST_ED.private_key_pkcs8_pem : keyChoice === "p256" ? TEST_P256.private_key_pkcs8_pem : pem;
      const key = PrivateKey.fromPkcs8Pem(priv);
      const timestamp = fixedTs ? 1755000000000 : ts;
      const bodyVal = method === "GET" || method === "DELETE" ? (body.trim() ? body : "") : body;
      const s = sign({ keyId, key }, { timestamp, method, path, query, body: bodyVal });
      return { s, key, bodyVal, error: null as string | null };
    } catch (e) {
      return { s: null, key: null, bodyVal: "", error: (e as Error).message };
    }
  }, [method, path, query, body, keyChoice, pem, keyId, fixedTs, ts]);

  const lines = result.s?.stringToSign.split("\n") ?? [];
  const host = "https://api.qa.novig.com";
  const curl = result.s
    ? [`curl -X ${method} '${host}${path}${query ? `?${query}` : ""}'`, `  -H 'Novig-Key-Id: ${keyId}'`, `  -H 'Novig-Timestamp: ${result.s.headers["Novig-Timestamp"]}'`, `  -H 'Novig-Signature: ${result.s.headers["Novig-Signature"]}'`, ...(result.bodyVal ? [`  -H 'Content-Type: application/json'`, `  --data-raw '${result.bodyVal}'`] : [])].join(" \\\n")
    : "";

  return (
    <Card title="Build & sign" eyebrow="NOVIG-V3">
      <div className="stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
          <select className="select" style={{ width: 110 }} value={method} onChange={(e) => setMethod(e.target.value)}>
            {["GET", "POST", "DELETE", "PATCH", "PUT"].map((m) => <option key={m}>{m}</option>)}
          </select>
          <input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/v3/orders" />
        </div>
        <div className="field"><label>Raw query (exactly as sent, no “?”)</label><input className="input mono" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="league=NFL&limit=50" /></div>
        <div className="field"><label>Body (the exact bytes you send)</label><textarea className="textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <div className="row">
          <div className="seg">
            <button className={keyChoice === "ed" ? "on" : ""} onClick={() => setKeyChoice("ed")}>Test key · Ed25519</button>
            <button className={keyChoice === "p256" ? "on" : ""} onClick={() => setKeyChoice("p256")}>Test key · P-256</button>
            <button className={keyChoice === "custom" ? "on" : ""} onClick={() => setKeyChoice("custom")}>Your PEM</button>
          </div>
          <label className="row tight caption fg2" style={{ cursor: "pointer" }}><input type="checkbox" checked={fixedTs} onChange={(e) => setFixedTs(e.target.checked)} /> vector timestamp</label>
        </div>
        {keyChoice === "custom" && (
          <div className="grid g2" style={{ gap: 10 }}>
            <div className="field"><label>Key id (UUID)</label><input className="input mono" value={keyId} onChange={(e) => setKeyId(e.target.value)} /></div>
            <div className="field"><label>Private key, PKCS#8 PEM (stays in this tab)</label><textarea className="textarea" rows={2} value={pem} onChange={(e) => setPem(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" /></div>
          </div>
        )}
        {result.error && <Notice warn>{result.error}</Notice>}
        {result.s && (
          <>
            <div className="caption fg2">Canonical string (six lines joined by LF, no trailing newline)</div>
            <div className="canon">
              {lines.map((l, i) => (
                <div className="canon-row" key={i}>
                  <span className="n">{i + 1}</span>
                  <span className="l">{LINE_LABELS[i]}</span>
                  <code className={l === "" ? "empty" : ""}>{l === "" ? "(empty: still present)" : l}</code>
                </div>
              ))}
            </div>
            <div className="grid g2" style={{ gap: 10 }}>
              <Stat k="Algorithm" v={result.key!.algorithm} s={result.key!.algorithm === "P-256" ? "ECDSA + SHA-256, DER-encoded" : "64-byte signature"} />
              <Stat k="Body hash" v={<span className="mono" style={{ fontSize: 13 }}>{bodyHash(result.bodyVal).slice(0, 16)}…</span>} s={result.bodyVal ? `${new TextEncoder().encode(result.bodyVal).length} bytes` : "zero bytes (e3b0c442…)"} />
            </div>
            <pre className="code">{curl}</pre>
          </>
        )}
      </div>
    </Card>
  );
}

const SAMPLE_BAD = {
  method: "GET",
  path: "/v3/catalog/markets",
  query: "league=NFL&marketType=MONEY&q=New York",
  body: "",
  ts: "1755000000000",
  theirs: "NOVIG-V3\n1755000000000\nGET\n/v3/catalog/markets\nleague=NFL&marketType=MONEY&q=New+York\n44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
};

function Doctor() {
  const [method, setMethod] = useState(SAMPLE_BAD.method);
  const [path, setPath] = useState(SAMPLE_BAD.path);
  const [query, setQuery] = useState(SAMPLE_BAD.query);
  const [body, setBody] = useState(SAMPLE_BAD.body);
  const [ts, setTs] = useState(SAMPLE_BAD.ts);
  const [theirs, setTheirs] = useState(SAMPLE_BAD.theirs);
  const [sig, setSig] = useState("");
  const [pub, setPub] = useState("");
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = () => {
    try {
      setErr(null);
      const d = diagnose({
        request: { timestamp: Number(ts), method, path, query, body },
        theirString: theirs.trim() ? theirs.replace(/\\n/g, "\n") : undefined,
        signature: sig.trim() || undefined,
        publicKeyPem: pub.trim() || undefined,
        now: Number(ts),
      });
      setResult(d);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Card title="Diagnose a rejected request" eyebrow="partner support">
      <div className="stack" style={{ gap: 12 }}>
        <div className="caption fg2">What they meant to send:</div>
        <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
          <select className="select" style={{ width: 110 }} value={method} onChange={(e) => setMethod(e.target.value)}>{["GET", "POST", "DELETE", "PATCH", "PUT"].map((m) => <option key={m}>{m}</option>)}</select>
          <input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} />
          <input className="input mono" style={{ width: 170 }} value={ts} onChange={(e) => setTs(e.target.value)} title="Novig-Timestamp" />
        </div>
        <input className="input mono" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="raw query" />
        <textarea className="textarea" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="raw body (empty for none)" />
        <div className="field"><label>Their string to sign (paste from their logs; \n is fine)</label><textarea className="textarea" rows={6} value={theirs} onChange={(e) => setTheirs(e.target.value)} /></div>
        <div className="grid g2" style={{ gap: 10 }}>
          <div className="field"><label>Their Novig-Signature (optional)</label><input className="input mono" value={sig} onChange={(e) => setSig(e.target.value)} /></div>
          <div className="field"><label>Their public key PEM (optional)</label><textarea className="textarea" rows={2} style={{ minHeight: 40 }} value={pub} onChange={(e) => setPub(e.target.value)} /></div>
        </div>
        <div className="row"><button className="btn primary" onClick={run}>Diagnose</button><span className="caption fg2">The sample is a real mistake: see what it finds.</span></div>
        {err && <Notice warn>{err}</Notice>}
        {result && <DiagnosisView d={result} />}
      </div>
    </Card>
  );
}

function DiagnosisView({ d }: { d: Diagnosis }) {
  return (
    <div className="stack fade-in" style={{ gap: 12 }}>
      <div className="row">
        {d.ok ? <span className="badge pos"><IconCheck /> Matches the expected string</span> : <span className="badge neg"><IconX /> {d.findings.length} problem{d.findings.length === 1 ? "" : "s"} found</span>}
        {d.signature?.validForCorrectString !== undefined && (
          d.signature.validForCorrectString ? <span className="badge pos">signature verifies</span> : <span className="badge neg">signature does not verify</span>
        )}
      </div>
      <div className="canon">
        {d.lines.map((l) => (
          <div className={`canon-row ${l.ok ? "" : "bad"}`} key={l.n}>
            <span className="n">{l.n}</span>
            <span className="l">{l.label}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              {!l.ok && l.got !== undefined && <code className="got">{l.got || "(empty)"}</code>}
              <code className={l.expected === "" ? "empty" : ""}>{l.expected === "" ? "(empty)" : l.expected}</code>
            </div>
          </div>
        ))}
      </div>
      {d.findings.map((f, i) => (
        <div className="finding" key={i}>
          <h4>{f.line && <span className="badge">line {f.line}</span>}{f.title}{f.documented && <span className="badge accent">in Novig's vectors</span>}</h4>
          <div className="wr"><span className="neg caption">sent</span><code>{f.wrong}</code><span className="pos caption">expected</span><code>{f.right}</code></div>
          <div className="footnote">{f.fix}</div>
        </div>
      ))}
    </div>
  );
}

interface VecResult {
  id: string;
  alg: string;
  ok: boolean;
  ms: number;
  covers: string[];
}

function runVectors(): VecResult[] {
  return vectors.vectors.map((v) => {
    const t0 = performance.now();
    const kp = KEYS[v.keypair_id]!;
    const key = PrivateKey.fromPkcs8Pem(kp.private_key_pkcs8_pem);
    const pub = PublicKey.fromSpkiPem(kp.public_key_spki_pem);
    const i = v.input;
    const s = stringToSign({ timestamp: i.timestamp, method: i.method, path: i.path, query: i.query, body: i.body });
    const ours = sign({ keyId: "k", key }, { timestamp: i.timestamp, method: i.method, path: i.path, query: i.query, body: i.body });
    const ok = s === v.string_to_sign && (v.algorithm === "ed25519" ? ours.headers["Novig-Signature"] === v.signature : pub.verify(v.string_to_sign, v.signature) && pub.verify(ours.stringToSign, ours.headers["Novig-Signature"]));
    return { id: v.id, alg: v.algorithm === "ed25519" ? "Ed25519" : "P-256", ok, ms: performance.now() - t0, covers: v.covers_divergence_point };
  });
}

function Vectors() {
  const [results] = useState(runVectors);
  const passed = results.filter((r) => r.ok).length;
  return (
    <Card title="Novig's official test vectors" right={<span className={`badge ${passed === results.length ? "pos" : "neg"}`}>{passed}/{results.length} pass in this browser</span>}>
      <div className="caption fg2" style={{ marginBottom: 12 }}>Ed25519 signatures must match byte for byte. P-256 is randomized, so Novig's signature and ours must both verify. The same file runs in <span className="kbd">cargo test</span> and <span className="kbd">vitest</span>.</div>
      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table className="table">
          <thead><tr><th /><th>Vector</th><th>Alg</th><th>Covers</th><th className="num">ms</th></tr></thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id}>
                <td>{r.ok ? <IconCheck className="pos" /> : <IconX className="neg" />}</td>
                <td className="mono">{r.id.replace(/^(ed25519|ecdsa_p256)_/, "")}</td>
                <td className="fg2">{r.alg}</td>
                <td className="caption fg2">{r.covers.join(", ").replace(/_/g, " ") || "–"}</td>
                <td className="num fg2">{r.ms.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ErrorExplainer() {
  const [status, setStatus] = useState("401");
  const [body, setBody] = useState('{"code":"SIGNATURE_REJECTED","message":"api key not found"}');
  const out = useMemo(() => {
    let parsed: { code?: string; message?: string } | string = body;
    try { parsed = JSON.parse(body); } catch { /* HTML or text */ }
    return explainError(Number(status), parsed);
  }, [status, body]);
  return (
    <Card title="Explain an error response" eyebrow="docs.novig.com/api/errors">
      <div className="stack" style={{ gap: 12 }}>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <select className="select" style={{ width: 110 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            {["400", "401", "403", "404", "409", "413", "423", "429", "451"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <span className="caption fg2">Paste the body they got back (JSON, or the edge's HTML):</span>
        </div>
        <textarea className="textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="finding"><h4>{out.title}</h4><div className="footnote">{out.fix}</div></div>
        <div className="chips">
          {[
            ["401", '{"code":"SIGNATURE_REJECTED","message":"novig-timestamp is too old"}'],
            ["403", "<html><body>Request blocked</body></html>"],
            ["429", '{"code":"RATE_LIMIT_EXCEEDED","message":"Rate limit exceeded. Please wait before retrying."}'],
            ["451", '{"code":"GEOLOCATION_EXPIRED","message":"..."}'],
            ["400", '{"code":"INVALID_PRICE","message":"price 0.667 is not on the grid"}'],
          ].map(([s, b]) => (<button key={b} className="chip" onClick={() => { setStatus(s!); setBody(b!); }}>{s} {b!.startsWith("<") ? "edge HTML" : JSON.parse(b!).code}</button>))}
        </div>
      </div>
    </Card>
  );
}
