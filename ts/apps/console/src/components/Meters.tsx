/** Token-bucket meters drawn like the throttle table on docs.novig.com. */
export interface MeterBucket {
  bucket: string;
  capacity: number;
  refillPerSec: number;
  tokens: number;
  spent?: number;
  waitedMs?: number;
  rejections?: number;
  blockedMs?: number;
}

export function Meters({ buckets }: { buckets: MeterBucket[] }) {
  return (
    <div className="meters">
      <div className="meter-row head">
        <span>Throttle</span>
        <span>Tokens now</span>
        <span style={{ textAlign: "right" }}>Burst</span>
        <span style={{ textAlign: "right" }}>Refill</span>
      </div>
      {buckets.map((b) => {
        const f = b.capacity ? b.tokens / b.capacity : 0;
        return (
          <div className="meter-row" key={b.bucket}>
            <code>{b.bucket}</code>
            <div>
              <div className="meter"><i className={f < 0.05 ? "empty" : f < 0.25 ? "low" : ""} style={{ width: `${Math.max(0, Math.min(1, f)) * 100}%` }} /></div>
              <div className="caption fg2" style={{ marginTop: 5, display: "flex", gap: 14 }}>
                <span className="num">{Math.floor(b.tokens).toLocaleString()} left</span>
                {b.spent !== undefined && <span className="num">{b.spent.toLocaleString()} spent</span>}
                {!!b.waitedMs && <span className="num caution" title="Summed over every request that waited, including ones waiting at the same time">{(b.waitedMs / 1000).toFixed(1)}s of queued waits</span>}
                {!!b.rejections && <span className="num neg">{b.rejections} × 429</span>}
                {!!b.blockedMs && <span className="num neg">blocked {Math.ceil(b.blockedMs / 1000)}s</span>}
              </div>
            </div>
            <span className="cap">{b.capacity.toLocaleString()}</span>
            <span className="rate">{b.refillPerSec} Hz</span>
          </div>
        );
      })}
    </div>
  );
}
