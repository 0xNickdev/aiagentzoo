import { useEffect, useRef, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { t, tChain } from "../i18n";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
/** One re-check every few seconds, round the list: about one look per coin a minute or two, inside the free rate. */
const CHECK_EVERY_MS = 3_500;
const LIST_EVERY_MS = 60_000;
/** A coin stays watched this long after it first showed up, even once it leaves the clean list. */
const WATCH_MS = 3 * 60 * 60_000;
const STORE = "zoo:radar";

interface Launch {
  mint: string;
  symbol: string;
  name: string;
  ageMin: number;
  buyers: number;
  curveSol: number;
  graduated: boolean;
}
type Verdict = "pass" | "caution" | "avoid" | "unknown";
export interface Watched extends Launch {
  firstSeen: number;
  verdict: Verdict | null;
  checkedAt: number | null;
  turnedAt: number | null;
  reason: string | null;
}

function load(): Record<string, Watched> {
  try {
    const raw = localStorage.getItem(STORE);
    const all = raw ? (JSON.parse(raw) as Record<string, Watched>) : {};
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, w]) => now - w.firstSeen < WATCH_MS));
  } catch {
    return {};
  }
}
function save(w: Record<string, Watched>) {
  try {
    localStorage.setItem(STORE, JSON.stringify(w));
  } catch {
    /* private mode: the radar still runs for this tab */
  }
}

export const ago = (at: number) => {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
  return m < 1 ? t("just now") : m < 60 ? t("{n} min ago", { n: m }) : t("{n} h ago", { n: Math.round(m / 60) });
};

/**
 * The radar: fresh coins that passed our checks, watched in the open. It never says buy; it says which ones have
 * stopped looking clean, the moment they do. Everything runs in this tab against public node data, so it costs the
 * nodes nothing new; the Telegram ping comes when the nodes run on our own servers.
 */
export function useRadar() {
  const [watched, setWatched] = useState<Record<string, Watched>>(load);
  const ref = useRef(watched);
  ref.current = watched;
  const [notify, setNotify] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted");
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    if (!NORTH) return;
    const pull = () =>
      fetch(`${NORTH}/v1/chain/clean?limit=30`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { launches: Launch[] } | null) => {
          if (!b) return;
          const next = { ...ref.current };
          const now = Date.now();
          for (const l of b.launches) {
            const prev = next[l.mint];
            next[l.mint] = prev ? { ...prev, ...l } : { ...l, firstSeen: now, verdict: null, checkedAt: null, turnedAt: null, reason: null };
          }
          setWatched(next);
          save(next);
        })
        .catch(() => {});
    pull();
    const id = window.setInterval(pull, LIST_EVERY_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!NORTH) return;
    const tick = async () => {
      const list = Object.values(ref.current).filter((w) => !w.turnedAt);
      if (!list.length) return;
      // The coin looked at longest ago goes next.
      const w = list.sort((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0))[0];
      try {
        const r = await fetch(`${NORTH}/v1/check/${w.mint}`);
        if (!r.ok) return;
        const c = (await r.json()) as { verdict: Verdict; reasons: string[] };
        const now = Date.now();
        const cur = ref.current[w.mint];
        if (!cur) return;
        const turned = (c.verdict === "avoid" || c.verdict === "caution") && cur.verdict === "pass";
        // A coin we never saw clean is not a turn; it simply leaves the radar.
        const dropped = (c.verdict === "avoid" || c.verdict === "caution") && cur.verdict === null;
        const next = { ...ref.current };
        if (dropped) delete next[w.mint];
        else
          next[w.mint] = {
            ...cur,
            verdict: c.verdict,
            checkedAt: now,
            turnedAt: turned ? now : cur.turnedAt,
            reason: turned ? (c.reasons[0] ?? null) : cur.reason,
          };
        setWatched(next);
        save(next);
        if (turned && notifyRef.current && typeof Notification !== "undefined") {
          new Notification(t("${s} turned: {v}", { s: cur.symbol, v: c.verdict === "avoid" ? t("avoid") : t("caution") }), {
            body: c.reasons[0] ? tChain(c.reasons[0]) : undefined,
            tag: w.mint,
          });
        }
      } catch {
        /* the next tick tries the next coin */
      }
    };
    const id = window.setInterval(tick, CHECK_EVERY_MS);
    return () => clearInterval(id);
  }, []);

  const askNotify = async () => {
    if (typeof Notification === "undefined") return;
    setNotify((await Notification.requestPermission()) === "granted");
  };
  return { watched, notify, askNotify };
}
