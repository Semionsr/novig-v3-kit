/** "What I noticed": the v3 findings from building the SDK, each with how to reproduce it. */
import { Card } from "../components/ui.tsx";

const FINDINGS = [
  {
    title: "The public book's ETag changes on every request",
    body: "Four GETs of the same unchanged book (same seq) returned four different ETags. The prefix looks like a per-instance id, so behind the load balancer If-None-Match almost never returns 304. An ETag built from market id + seq would make conditional polling work.",
    repro: "for i in 1 2 3 4; do curl -s -D - -o /dev/null https://api.novig.com/v3/public/catalog/markets/<id>/book | grep -i etag; done",
  },
  {
    title: "Browsers can't read Retry-After, X-Request-Id or ETag",
    body: "Responses send Access-Control-Allow-Origin: * but no Access-Control-Expose-Headers, so a web client can't honor Retry-After, can't read ETag, and can't quote a request id to support. Exposing those three fixes it.",
    repro: "curl -s -D - -o /dev/null -H 'Origin: https://example.com' https://api.novig.com/v3/public/types/leagues | grep -i access-control",
  },
  {
    title: "The `public` throttle is named but not defined",
    body: "Every /v3/public route lists a `public` throttle that the throttling page doesn't describe. Measured: about a 10-request burst refilling about 2/s per IP, shared across public routes. Both SDKs now model it.",
  },
  {
    title: "The API changelog is empty",
    body: "v3 replaced OAuth with NOVIG-V3 signing and moved the old API under /deprecated, but the changelog page has no entries yet. Partners migrating from NBX v1 would benefit from a dated list.",
  },
];

export function Findings() {
  return (
    <div className="stack fade-in" style={{ maxWidth: 980 }}>
      <Card title="What I'd fix first" eyebrow="small change, every partner benefits the same day">
        <p className="footnote fg2" style={{ margin: 0 }}>
          Make the public book's ETag change only when the book changes. Then every partner polling books gets <span className="kbd">304 Not Modified</span> instead of re-downloading the same book.
        </p>
      </Card>
      <Card title="Things I noticed in v3" eyebrow="checked on 2026-09-28">
        <div className="stack" style={{ gap: 14 }}>
          {FINDINGS.map((f) => (
            <div key={f.title} className="finding">
              <h4>{f.title}</h4>
              <div className="footnote fg2">{f.body}</div>
              {f.repro && <pre className="code" style={{ marginTop: 10, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{f.repro}</pre>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
