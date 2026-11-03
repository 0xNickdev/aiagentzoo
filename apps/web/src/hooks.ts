import { useEffect, useState } from "react";

/**
 * Fetches one public endpoint now and then every `every` ms; null until it answers. A failed or empty answer keeps
 * the last good value, and nothing is set after the component is gone.
 */
export function useLive<T>(url: string, every = 15_000): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    let dead = false;
    const load = () =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: T | null) => b && !dead && setV(b))
        .catch(() => {});
    void load();
    const id = window.setInterval(load, every);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [url, every]);
  return v;
}
