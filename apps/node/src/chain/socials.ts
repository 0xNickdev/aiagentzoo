import type { DatabaseSync, StatementSync } from "node:sqlite";
import { type PumpTape, tape } from "./pump.ts";

/**
 * The X accounts, X communities and Telegram groups launches point to, and what happened to those launches. A
 * rugger reuses the same account for launch after launch; a fresh wallet hides who is behind it, the link it
 * advertises does not. Read from each token's own metadata (the address is in its create event on chain).
 *
 * Only accounts the token presents as its own count: a link to someone's tweet (x.com/<name>/status/...) is
 * usually a famous person's post the token is about, not its makers, so it is left out.
 */

export type SocialKind = "x" | "x-community" | "telegram";

export interface Social {
  kind: SocialKind;
  /** "x:@name", "x-community:123", "telegram:name": lowercase. */
  key: string;
  url: string;
  label: string;
}

/** The accounts a metadata JSON links to, normalized; tweets, websites and anything odd are left out. */
export function socialsOf(meta: { twitter?: unknown; telegram?: unknown }): Social[] {
  const out: Social[] = [];
  const x = typeof meta.twitter === "string" ? meta.twitter.trim() : "";
  const community = /^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/i\/communities\/(\d{5,25})\/?(?:\?.*)?$/i.exec(x);
  const profile = /^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?(?:\?.*)?$/i.exec(x);
  if (community) out.push({ kind: "x-community", key: `x-community:${community[1]}`, url: `https://x.com/i/communities/${community[1]}`, label: `X community ${community[1]}` });
  else if (profile && !["i", "home", "search", "intent", "share"].includes(profile[1]!.toLowerCase())) {
    const h = profile[1]!;
    out.push({ kind: "x", key: `x:@${h.toLowerCase()}`, url: `https://x.com/${h}`, label: `@${h}` });
  }
  const tg = typeof meta.telegram === "string" ? meta.telegram.trim() : "";
  const group = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,32})\/?$/i.exec(tg);
  if (group) out.push({ kind: "telegram", key: `telegram:${group[1]!.toLowerCase()}`, url: `https://t.me/${group[1]}`, label: `t.me/${group[1]}` });
  return out;
}

/** IPFS through gateways that answer servers; the uri's own host otherwise. */
function metadataUrls(uri: string): string[] {
  const cid = /\/ipfs\/([A-Za-z0-9]{40,80})/.exec(uri)?.[1];
  // Pinata answers our server; ipfs.io rate-limits it and 4everland often hangs, so they are only the fallbacks.
  if (cid) return [`https://gateway.pinata.cloud/ipfs/${cid}`, `https://4everland.io/ipfs/${cid}`, `https://ipfs.io/ipfs/${cid}`];
  return /^https:\/\//.test(uri) ? [uri] : [];
}

/** A metadata image as a URL a browser loads: IPFS through a public gateway, plain https as it is, anything else dropped. */
export function imageUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 300) return null;
  const cid = /(?:\/ipfs\/|^ipfs:\/\/)([A-Za-z0-9]{40,80})/.exec(v)?.[1];
  if (cid) return `https://gateway.pinata.cloud/ipfs/${cid}`;
  return /^https:\/\/[^\s"'<>]+$/.test(v) ? v : null;
}

export interface AccountRecord {
  social: Social;
  launches: number;
  /** Launches whose creator sold half their bag or more within five minutes. */
  fastDumps: number;
  creators: number;
  /** How far back the launches were looked for: 2 days in memory, 90 with the long memory attached. */
  windowDays: number;
  recent: Array<{ mint: string; symbol: string; createdAt: number; dumpedAfterMin: number | null }>;
}

const KEEP_MS = 48 * 3_600_000;
/** The long memory keeps which launches linked which account this long. */
export const SOCIALS_KEEP_MS = 90 * 24 * 3_600_000;
/** At most this many of an account's launches are read back for one answer, newest first. */
const ROWS_MAX = 5_000;

interface LinkRow {
  mint: string;
  kind: string;
  url: string;
  label: string;
  creator: string;
  symbol: string;
  created_at: number;
  dumped_after_min: number | null;
}

/** Accounts memecoins point to because they are about them, never because they run them. */
const FAMOUS = new Set(["elonmusk", "chatgpt", "openai", "sama", "solana", "pumpdotfun", "binance", "cz_binance", "realdonaldtrump", "potus", "whitehouse", "x", "grok", "xai", "anthropicai", "claudeai", "nvidia", "tesla", "spacex", "jupiterexchange", "raydiumprotocol", "metdaoteam", "bonk_inu", "coinbase", "base", "jessepollak", "vitalikbuterin", "toly", "aeyakovenko"]);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export class SocialsRegistry {
  private readonly tape: PumpTape;
  private readonly fetchFn: typeof fetch;
  /** Mint -> the accounts it links to (an empty list once read and found none). */
  private readonly byMint = new Map<string, Social[]>();
  private readonly byKey = new Map<string, Set<string>>();
  /** Mint -> the picture its metadata points to, as a URL a browser can load. */
  private readonly images = new Map<string, string>();
  /** Launches already put at the front once, so a page polling the feed does not re-queue them forever. */
  private readonly wanted = new Set<string>();
  private queue: Array<{ mint: string; uri: string }> = [];
  private pausedUntil = 0;
  private timer: NodeJS.Timeout | null = null;
  /** The long memory: account -> launches (mint, dev, time, dump) for 90 days, in the history database. */
  private db: { db: DatabaseSync; put: StatementSync; byAccount: StatementSync; ofMint: StatementSync; prune: StatementSync } | null = null;

  constructor(t: PumpTape, fetchFn: typeof fetch = fetch) {
    this.tape = t;
    this.fetchFn = fetchFn;
  }

  /**
   * Keeps account -> launches in `db` (the north node's history.db) for 90 days, so an account is known by every
   * launch it was on, not only the last two days the tape holds. Memory stays at the two days; the rest is on disk.
   */
  attach(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS social_links (
        account TEXT NOT NULL,
        mint TEXT NOT NULL,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        label TEXT NOT NULL,
        creator TEXT NOT NULL,
        symbol TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        dumped_after_min INTEGER,
        PRIMARY KEY (account, mint)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS social_links_mint ON social_links (mint);
      CREATE INDEX IF NOT EXISTS social_links_created ON social_links (created_at);
    `);
    this.db = {
      db,
      put: db.prepare(`INSERT INTO social_links (account, mint, kind, url, label, creator, symbol, created_at, dumped_after_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (account, mint) DO UPDATE SET dumped_after_min = excluded.dumped_after_min, symbol = excluded.symbol`),
      byAccount: db.prepare("SELECT mint, kind, url, label, creator, symbol, created_at, dumped_after_min FROM social_links WHERE account = ? ORDER BY created_at DESC LIMIT ?"),
      ofMint: db.prepare("SELECT account, kind, url, label FROM social_links WHERE mint = ?"),
      prune: db.prepare("DELETE FROM social_links WHERE created_at < ?"),
    };
    this.persistAll();
  }

  /** Writes one launch's links with what the tape knows of it now (its dev, and whether they dumped). */
  private persist(mint: string, socials: Social[]): void {
    if (!this.db || !socials.length) return;
    const o = this.tape.outline(mint);
    if (!o) return;
    for (const s of socials) this.db.put.run(s.key, mint, s.kind, s.url, s.label, o.creator, o.symbol, o.createdAt, o.dumpedAfterMin);
  }

  /** Every launch in memory written again in one transaction: dumps seen since the first write land on disk. */
  private persistAll(): void {
    if (!this.db) return;
    this.db.db.exec("BEGIN");
    try {
      for (const [mint, s] of this.byMint) this.persist(mint, s);
      this.db.db.exec("COMMIT");
    } catch (e) {
      this.db.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Records what one token links to. */
  add(mint: string, socials: Social[]): void {
    // Read once with links, kept with links: a later empty read (another gateway, an edited file) does not flip it.
    if (!socials.length && this.byMint.get(mint)?.length) return;
    this.byMint.set(mint, socials);
    for (const s of socials) {
      const set = this.byKey.get(s.key) ?? new Set();
      set.add(mint);
      this.byKey.set(s.key, set);
    }
    this.persist(mint, socials);
  }

  /** A launch whose accounts and picture came from somewhere else (four.meme's own API): kept as if read. */
  recordMeta(mint: string, meta: { twitter?: unknown; telegram?: unknown; image?: unknown }): void {
    this.add(mint, socialsOf(meta));
    const img = imageUrl(meta.image);
    if (img) this.images.set(mint, img);
  }

  /** Reads one token's metadata; false when the gateways refuse, so the reader backs off. */
  async read(mint: string, uri: string): Promise<boolean> {
    let refused = false;
    for (const url of metadataUrls(uri)) {
      try {
        const r = await this.fetchFn(url, { headers: { "user-agent": "Mozilla/5.0 (zooaiagency)" }, signal: AbortSignal.timeout(4_000) });
        if (r.status === 429 || r.status === 403) {
          refused = true;
          continue;
        }
        if (!r.ok) break;
        const meta = (await r.json()) as { twitter?: unknown; telegram?: unknown; image?: unknown };
        this.add(mint, socialsOf(meta));
        const img = imageUrl(meta.image);
        if (img) this.images.set(mint, img);
        return true;
      } catch {
        // Next gateway.
      }
    }
    // A miss after a good read keeps what was read: a gateway timing out must not take the coin's links away.
    if (!this.byMint.has(mint)) this.byMint.set(mint, []);
    return !refused;
  }

  /** Puts a launch someone is looking at at the front of the reader, when its picture is still unknown. */
  want(mint: string): void {
    if (this.images.has(mint) || this.wanted.has(mint)) return;
    const uri = this.tape.metadataOf(mint);
    if (!uri) return;
    this.wanted.add(mint);
    this.queue = [{ mint, uri }, ...this.queue.filter((q) => q.mint !== mint)].slice(0, 2_000);
  }

  /**
   * Reads one launch's metadata now, outside the queue: for the few coins a page is showing this moment. A miss is
   * tried again after a minute; at most a handful read at once.
   */
  private readonly lastTried = new Map<string, number>();
  private inflightNow = 0;
  fetchNow(mint: string, now = Date.now()): void {
    if (this.images.has(mint) || this.inflightNow >= 6) return;
    if (now - (this.lastTried.get(mint) ?? 0) < 60_000) return;
    const uri = this.tape.metadataOf(mint);
    if (!uri) return;
    this.lastTried.set(mint, now);
    if (this.lastTried.size > 5_000) this.lastTried.delete(this.lastTried.keys().next().value!);
    this.inflightNow += 1;
    void this.read(mint, uri)
      .catch(() => false)
      .finally(() => (this.inflightNow -= 1));
  }

  /**
   * Whether the token's own metadata links an X account, X community or Telegram: the odds' `social` input, as the
   * odds were fitted (any link in the metadata, before the famous-account and reuse filters the check applies). A good
   * read is never undone by a later miss, so the same coin reads the same odds from one ask to the next.
   */
  linksSocial(mint: string): boolean {
    return (this.byMint.get(mint)?.length ?? 0) > 0;
  }

  /** The token's picture, once its metadata was read. */
  image(mint: string): string | undefined {
    return this.images.get(mint);
  }

  /** What a token links to, and every other launch that links to the same: two days in memory, 90 on disk. */
  forMint(mint: string): Array<AccountRecord> {
    const own = this.byMint.get(mint) ?? (this.db ? (this.db.ofMint.all(mint) as Array<{ account: string; kind: SocialKind; url: string; label: string }>).map((r) => ({ key: r.account, kind: r.kind, url: r.url, label: r.label })) : []);
    return own.map((s) => this.record(s.key, mint, s)).filter((r): r is AccountRecord => Boolean(r));
  }

  /** The launches that linked one account: from disk when attached (the tape's live state wins for coins it still holds). */
  private launchesOf(key: string): Array<{ mint: string; symbol: string; creator: string; createdAt: number; dumpedAfterMin: number | null; fastDump: boolean; social?: Social }> {
    if (this.db) {
      return (this.db.byAccount.all(key, ROWS_MAX) as unknown as LinkRow[]).map((r) => {
        const live = this.tape.outline(r.mint);
        if (live) return { ...live, social: { key, kind: r.kind as SocialKind, url: r.url, label: r.label } };
        return { mint: r.mint, symbol: r.symbol, creator: r.creator, createdAt: r.created_at, dumpedAfterMin: r.dumped_after_min, fastDump: r.dumped_after_min !== null && r.dumped_after_min <= 5, social: { key, kind: r.kind as SocialKind, url: r.url, label: r.label } };
      });
    }
    return [...(this.byKey.get(key) ?? [])].map((m) => {
      const o = this.tape.outline(m);
      return o ? { ...o, social: this.byMint.get(m)?.find((s) => s.key === key) } : null;
    }).filter((o): o is NonNullable<typeof o> => Boolean(o));
  }

  private record(key: string, except?: string, known?: Social): AccountRecord | null {
    const all = this.launchesOf(key);
    const outlines = all.filter((o) => o.mint !== except);
    const social = known ?? all.find((o) => o.social)?.social;
    if (!social) return null;
    // A token named after the account it links to is about that account (a ChatGPT coin linking @chatgpt): the
    // account is the meme's subject, not the hand behind it. Most of its launches like that, and it is left out.
    const handle = squash(social.label.replace(/^@|^t\.me\//, ""));
    if (social.kind === "x" && FAMOUS.has(handle)) return null;
    const about = outlines.filter((o) => {
      const sym = squash(o.symbol);
      return handle.length >= 3 && sym.length >= 3 && (handle.includes(sym) || sym.includes(handle));
    }).length;
    if (outlines.length && about / outlines.length >= 0.5) return null;
    return {
      social,
      launches: outlines.length,
      fastDumps: outlines.filter((o) => o.fastDump).length,
      creators: new Set(outlines.map((o) => o.creator)).size,
      windowDays: this.windowDays,
      recent: outlines
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 8)
        .map((o) => ({ mint: o.mint, symbol: o.symbol, createdAt: o.createdAt, dumpedAfterMin: o.dumpedAfterMin })),
    };
  }

  /** Accounts linked to two or more launches in two days, the ones whose launches were dumped fastest first. */
  reused(limit = 30): AccountRecord[] {
    const out: AccountRecord[] = [];
    for (const [key, mints] of this.byKey) if (mints.size >= 2) {
      const r = this.record(key);
      if (r && r.launches >= 2) out.push(r);
    }
    return out.sort((a, b) => b.fastDumps - a.fastDumps || b.launches - a.launches).slice(0, limit);
  }

  /** How far back an account's launches reach: 90 days with the long memory, the tape's two without. */
  get windowDays(): number {
    return this.db ? 90 : 2;
  }

  get size() {
    return { read: this.byMint.size, accounts: this.byKey.size, queued: this.queue.length };
  }

  /** Forgets launches the tape no longer keeps; on disk, writes the last dumps and drops what is past 90 days. */
  prune(now = Date.now()): void {
    // Written before memory lets go, so the dumps of the last hour are kept.
    this.persistAll();
    for (const mint of this.byMint.keys()) {
      const o = this.tape.outline(mint);
      if (!o || now - o.createdAt > KEEP_MS) {
        this.byMint.delete(mint);
        this.images.delete(mint);
      }
    }
    for (const [key, mints] of this.byKey) {
      for (const m of mints) if (!this.byMint.has(m)) mints.delete(m);
      if (!mints.size) this.byKey.delete(key);
    }
    if (this.db) {
      this.db.prune.run(now - SOCIALS_KEEP_MS);
    }
  }

  /** Reads new launches' metadata, `perSecond` at most, newest first; backs off for five minutes when refused. */
  start(perSecond = 1): void {
    if (this.timer) return;
    let tick = 0;
    this.timer = setInterval(() => {
      tick += 1;
      if (tick % 15 === 0) {
        const fresh = this.tape.withMetadata(300).filter((x) => !this.byMint.has(x.mint) && !this.queue.some((q) => q.mint === x.mint));
        this.queue = [...fresh, ...this.queue].slice(0, 2_000);
      }
      if (tick % 3600 === 0) {
        this.prune();
        this.wanted.clear();
      }
      if (Date.now() < this.pausedUntil) return;
      for (let i = 0; i < perSecond; i++) {
        const next = this.queue.shift();
        if (!next) break;
        void this.read(next.mint, next.uri).then((ok) => {
          if (!ok) this.pausedUntil = Date.now() + 5 * 60_000;
        });
      }
    }, 1_000);
    this.timer.unref();
  }

  snapshot(): string {
    return JSON.stringify({ v: 1, byMint: [...this.byMint], images: [...this.images] });
  }

  load(json: string): number {
    try {
      const saved = JSON.parse(json) as { v?: number; byMint?: Array<[string, Social[]]>; images?: Array<[string, string]> };
      if (saved.v !== 1) return 0;
      for (const [mint, socials] of saved.byMint ?? []) if (this.tape.outline(mint)) this.add(mint, socials);
      for (const [mint, img] of saved.images ?? []) if (this.tape.outline(mint)) this.images.set(mint, img);
      return this.byMint.size;
    } catch {
      return 0;
    }
  }
}

/** The one registry per node process, beside the one tape. */
export const socials = new SocialsRegistry(tape);
