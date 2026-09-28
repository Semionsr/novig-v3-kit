import type { ReactNode } from "react";
import { IconInfo } from "./icons.tsx";

export function Card({ title, eyebrow, right, children, className = "", flat }: { title?: ReactNode; eyebrow?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; flat?: boolean }) {
  return (
    <section className={`card ${flat ? "flat" : ""} ${className}`}>
      {(title || right || eyebrow) && (
        <div className="card-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h3 className="title3" style={{ margin: 0 }}>{title}</h3>}
          </div>
          <div className="spacer" />
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ k, v, s, tone }: { k: ReactNode; v: ReactNode; s?: ReactNode; tone?: "pos" | "neg" | "accent" | "caution" }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={`v ${tone ?? ""}`}>{v}</div>
      {s !== undefined && <div className="s">{s}</div>}
    </div>
  );
}

export function Notice({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <div className={`notice ${warn ? "warn" : ""}`}>
      <IconInfo className={warn ? "caution" : "accent"} />
      <div className="footnote">{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="title3">{title}</div>
      {children && <div className="footnote">{children}</div>}
    </div>
  );
}

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { code?: string; message?: string };
  return (
    <div className="notice warn" style={{ marginTop: 12 }}>
      <IconInfo className="caution" />
      <div className="footnote"><b className="caution">{e.code ?? "Error"}</b> {e.message ?? String(error)}</div>
    </div>
  );
}
