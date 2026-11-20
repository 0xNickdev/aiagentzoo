import { useEffect, useState } from "react";

/** Pages served by this app. /docs is its own document and loads normally. /play is the old name of /contests. */
export const ROUTES = ["/", "/xray", "/feed", "/contests", "/play", "/connect", "/stats", "/x402", "/callers", "/volume"] as const;
export type Route = (typeof ROUTES)[number];

const current = (): Route => {
  const p = location.pathname.replace(/\/+$/, "") || "/";
  return (ROUTES as readonly string[]).includes(p) ? (p as Route) : "/";
};

const listeners = new Set<() => void>();

export function navigate(href: string): void {
  const url = new URL(href, location.href);
  history.pushState(null, "", url.pathname + url.search + url.hash);
  listeners.forEach((l) => l());
  requestAnimationFrame(() => {
    const target = url.hash ? document.getElementById(url.hash.slice(1)) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo({ top: 0, behavior: "instant" });
  });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const sync = () => setRoute(current());
    listeners.add(sync);
    window.addEventListener("popstate", sync);
    return () => {
      listeners.delete(sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  return route;
}

/** Same-origin links to this app's pages switch pages without a reload; everything else behaves as usual. */
export function interceptLinks(): void {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest("a");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (!(ROUTES as readonly string[]).includes(path)) return;
    // A hash on the current page is a plain in-page jump.
    if (path === (location.pathname.replace(/\/+$/, "") || "/") && url.hash) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
}

export const TITLES: Record<Route, string> = {
  "/": "ZOOAI AGENCY - see who you're buying from",
  "/xray": "X-Ray - ZOOAI AGENCY",
  "/feed": "Live feed - ZOOAI AGENCY",
  "/contests": "Contests - ZOOAI AGENCY",
  "/play": "Contests - ZOOAI AGENCY",
  "/connect": "Connect an agent - ZOOAI AGENCY",
  "/stats": "Stats - ZOOAI AGENCY",
  "/x402": "Pay per check with x402 - ZOOAI AGENCY",
  "/callers": "Caller Truth - ZOOAI AGENCY",
  "/volume": "Real volume - ZOOAI AGENCY",
};
