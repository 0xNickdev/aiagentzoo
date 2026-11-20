import type { ReactNode } from "react";
import { t } from "../../i18n";
import type { Market } from "./Market";
import type { Calls } from "./Calls";
import type { AccessState } from "./access";
import type { XRayReport } from "./types";

/** The sections of a report: the sidebar's Report and Deep check groups. */
export type Sec = "overview" | "dev" | "first" | "setup" | "bundles" | "holders" | "calls" | "trace" | "sol" | "wallets";
export const SECS: Sec[] = ["overview", "dev", "first", "setup", "bundles", "holders", "calls", "trace", "sol", "wallets"];
/** The old tab names still open the right section, so links shared before keep working. */
export const OLD_TABS: Record<string, Sec> = { five: "first", network: "trace", map: "sol" };
export const secOf = (q: string | null): Sec => (q ? (OLD_TABS[q] ?? (SECS.includes(q as Sec) ? (q as Sec) : "overview")) : "overview");
export const SEC_NAME: Record<Sec, string> = {
  overview: "Overview",
  dev: "The dev",
  first: "First seconds",
  setup: "Launch setup",
  bundles: "Bundles",
  holders: "Holders",
  calls: "Who's calling it",
  trace: "Funding trace",
  sol: "Where SOL went",
  wallets: "All wallets",
};
export const DEEP_SECS: Sec[] = ["trace", "sol", "wallets"];

/** What every panel of a report reads from. */
export interface Ctx {
  r: XRayReport;
  access: AccessState;
  market: Market | null;
  calls: Calls | null;
  go: (s: Sec, anchor?: string) => void;
  onPick: (mint: string) => void;
  /** Spend the weekly free deep check on this mint, or show the Pro panel when it is spent. */
  unlock: () => void;
}

/** One panel: a hairline box with a 40px head, a title, an optional tag and a quiet meta line. */
export function Pn({ id, span, title, meta, tag, more, children, body = true, className = "" }: { id?: string; span: string; title: string; meta?: ReactNode; tag?: string; more?: { label: string; on: () => void }; children: ReactNode; body?: boolean; className?: string }) {
  return (
    <section className={`x-pn ${span} ${className}`} id={id} aria-label={title}>
      <div className="x-ph">
        <h2>{title}</h2>
        {tag && <span className="x-tag">{tag}</span>}
        {meta !== undefined && <span className="x-m">{meta}</span>}
        {more && (
          <button type="button" className="x-more" style={meta === undefined ? { marginLeft: "auto" } : undefined} onClick={more.on}>
            {more.label} →
          </button>
        )}
      </div>
      {body ? <div className="x-pb">{children}</div> : children}
    </section>
  );
}

/** Key-value rows on hairlines. */
export function Kv({ rows, flush }: { rows: Array<[string, ReactNode, ("d" | "up" | "w" | "")?] | null | false | undefined>; flush?: boolean }) {
  const list = rows.filter(Boolean) as Array<[string, ReactNode, string?]>;
  if (!list.length) return null;
  return (
    <div className={`x-kv ${flush ? "x-flush" : ""}`}>
      {list.map(([k, v, tone]) => (
        <div key={k}>
          <span>{k}</span>
          <b className={tone ? `x-${tone}` : ""}>{v}</b>
        </div>
      ))}
    </div>
  );
}

/** A locked deep-check part: says what is behind it, never shows made-up numbers. */
export function LockRow({ text, onUnlock, label }: { text: string; onUnlock: () => void; label?: string }) {
  return (
    <div className="x-lockrow">
      <p>
        <b>{t("Deep check")}</b> · {text}
      </p>
      <button type="button" className="x-mbtn" onClick={onUnlock}>
        {label ?? t("Unlock")}
      </button>
    </div>
  );
}

/** The ZOOAI wordmark, drawn, never a picture. */
export function Logo() {
  return (
    <svg viewBox="0 -6 1152 284" fill="#fff" role="img" aria-label="ZOOAI">
      <path d="M0 3H215V40L69 220H215V267H0V227L140 50H0Z" />
      <circle cx="363" cy="135" r="113" fill="none" stroke="#fff" strokeWidth="48" />
      <circle cx="363" cy="135" r="38" />
      <circle cx="656" cy="135" r="113" fill="none" stroke="#fff" strokeWidth="48" />
      <circle cx="656" cy="135" r="38" />
      <path fillRule="evenodd" d="M784 267L907 3H957L1084 267H1032L1004 203H862L834 267ZM934 65L980 160H887Z" />
      <path d="M1104 3H1152V267H1104Z" />
    </svg>
  );
}

const I = ({ children }: { children: ReactNode }) => (
  <svg className="x-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    {children}
  </svg>
);
export const ICONS: Record<Sec | "feed" | "api" | "home" | "contests", ReactNode> = {
  overview: <I><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></I>,
  dev: <I><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></I>,
  first: <I><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></I>,
  setup: <I><path d="M4 7h10M4 17h6M18 7h2M14 17h6" /><circle cx="16" cy="7" r="2" /><circle cx="12" cy="17" r="2" /></I>,
  bundles: <I><rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></I>,
  holders: <I><path d="M3 20h18M6 16V9M11 16V5M16 16v-4M21 16V8" /></I>,
  calls: <I><path d="M4 5h16v11H8l-4 4z" /></I>,
  trace: <I><circle cx="12" cy="12" r="2.5" /><circle cx="4.5" cy="6" r="1.8" /><circle cx="19.5" cy="6" r="1.8" /><circle cx="19" cy="19" r="1.8" /><path d="M10 11 6 7M14 11l4-4M14 13.5l3.6 4" /></I>,
  sol: <I><path d="M3 12h7l3-6 3 12 2-6h3" /></I>,
  wallets: <I><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 14h8" /></I>,
  contests: <I><path d="M8 4h8v5a4 4 0 0 1-8 0zM5 5H3v2a3 3 0 0 0 3 3M19 5h2v2a3 3 0 0 1-3 3M12 13v4M8 21h8" /></I>,
  feed: <I><path d="M4 6h16M4 12h16M4 18h10" /></I>,
  api: <I><path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" /></I>,
  home: <I><path d="M4 11l8-7 8 7v9H4z" /></I>,
};

/** Odds as people read them: 0.01%, 0.1%, 2.7%, 11%. */
export const oddsPct = (p: number) => {
  const v = p * 100;
  return v >= 10 ? String(Math.round(v)) : v >= 0.1 ? v.toFixed(1) : v > 0 ? v.toFixed(2) : "0";
};
