/** Comma-separated node base URLs, e.g. `http://localhost:8781,http://localhost:8782`. */
export const NODE_URLS: string[] = (import.meta.env.VITE_ZOO_NODES ?? "")
  .split(",")
  .map((s: string) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);
