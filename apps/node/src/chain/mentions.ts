import type { DatabaseSync } from "node:sqlite";

/**
 * Where a token was seen on X: the extension, drawing its chip next to an address in a post, tells the node which
 * handle posted it and when. Public posts only, nothing about who was reading. With the first-second wallets and the
 * KOL list this says whether a KOL's wallet bought before that KOL posted.
 */

export interface Mention {
  handle: string;
  url: string;
  /** When the post was written (ms), as X shows it. */
  postAt: number;
  seenAt: number;
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const URL_RE = /^https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,25}$/;
const MINT = /^(?:[1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-f]{40})$/;

export class Mentions {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mentions (
        mint TEXT NOT NULL,
        handle TEXT NOT NULL,
        url TEXT NOT NULL,
        post_at INTEGER NOT NULL,
        seen_at INTEGER NOT NULL,
        PRIMARY KEY (mint, url)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS mentions_mint ON mentions (mint, post_at);
    `);
  }

  /** Keeps one sighting; false when the fields are not what a post looks like. */
  note(raw: { mint?: unknown; handle?: unknown; url?: unknown; postAt?: unknown }, now = Date.now()): boolean {
    const mint = typeof raw.mint === "string" ? (raw.mint.startsWith("0x") ? raw.mint.toLowerCase() : raw.mint) : "";
    const handle = typeof raw.handle === "string" ? raw.handle.replace(/^@/, "") : "";
    const url = typeof raw.url === "string" ? raw.url.split("?")[0]! : "";
    const postAt = Number(raw.postAt);
    if (!MINT.test(mint) || !HANDLE.test(handle) || !URL_RE.test(url) || !Number.isFinite(postAt) || postAt <= 0 || postAt > now + 600_000) return false;
    this.db.prepare("INSERT OR IGNORE INTO mentions (mint, handle, url, post_at, seen_at) VALUES (?, ?, ?, ?, ?)").run(mint, handle.toLowerCase(), url, Math.round(postAt), now);
    return true;
  }

  /** The earliest posts naming a token, oldest first. */
  of(mint: string, limit = 20): Mention[] {
    const rows = this.db.prepare("SELECT handle, url, post_at, seen_at FROM mentions WHERE mint = ? ORDER BY post_at LIMIT ?").all(mint, limit) as Array<{ handle: string; url: string; post_at: number; seen_at: number }>;
    return rows.map((r) => ({ handle: r.handle, url: r.url, postAt: Number(r.post_at), seenAt: Number(r.seen_at) }));
  }

  /** Posts older than the memory's own window go. */
  prune(now = Date.now(), keepMs = 90 * 24 * 3_600_000): void {
    this.db.prepare("DELETE FROM mentions WHERE seen_at < ?").run(now - keepMs);
  }
}

/** The X handle inside a KOL's link, lowercase, for matching a mention to a wallet's owner. */
export const handleOf = (x: string | null | undefined): string | null => {
  const m = x ? /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/.exec(x) : null;
  return m ? m[1]!.toLowerCase() : null;
};
