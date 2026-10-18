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
  if (cid) return [`https://4everland.io/ipfs/${cid}`, `https://gateway.pinata.cloud/ipfs/${cid}`];
  return /^https:\/\//.test(uri) ? [uri] : [];
}

export interface AccountRecord {
  social: Social;
  launches: number;
  /** Launches whose creator sold half their bag or more within five minutes. */
  fastDumps: number;
  creators: number;
  recent: Array<{ mint: string; symbol: string; createdAt: number; dumpedAfterMin: number | null }>;
}

const KEEP_MS = 48 * 3_600_000;

export class SocialsRegistry {
  private readonly tape: PumpTape;
  private readonly fetchFn: typeof fetch;
  /** Mint -> the accounts it links to (an empty list once read and found none). */
  private readonly byMint = new Map<string, Social[]>();
  private readonly byKey = new Map<string, Set<string>>();
  private queue: Array<{ mint: string; uri: string }> = [];
  private pausedUntil = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(t: PumpTape, fetchFn: typeof fetch = fetch) {
    this.tape = t;
    this.fetchFn = fetchFn;
  }

  /** Records what one token links to. */
  add(mint: string, socials: Social[]): void {
    this.byMint.set(mint, socials);
    for (const s of socials) {
      const set = this.byKey.get(s.key) ?? new Set();
      set.add(mint);
      this.byKey.set(s.key, set);
    }
  }

  /** Reads one token's metadata; false when the gateways refuse, so the reader backs off. */
  async read(mint: string, uri: string): Promise<boolean> {
    let refused = false;
    for (const url of metadataUrls(uri)) {
      try {
        const r = await this.fetchFn(url, { headers: { "user-agent": "Mozilla/5.0 (zooaiagency)" }, signal: AbortSignal.timeout(6_000) });
        if (r.status === 429 || r.status === 403) {
          refused = true;
          continue;
        }
        if (!r.ok) break;
        const meta = (await r.json()) as { twitter?: unknown; telegram?: unknown };
        this.add(mint, socialsOf(meta));
        return true;
      } catch {
        // Next gateway.
      }
    }
    this.byMint.set(mint, []);
    return !refused;
  }

  /** What a token links to, and every other launch of the last two days that links to the same. */
  forMint(mint: string): Array<AccountRecord> {
    return (this.byMint.get(mint) ?? []).map((s) => this.record(s.key, mint)).filter((r): r is AccountRecord => Boolean(r));
  }

  private record(key: string, except?: string): AccountRecord | null {
    const mints = [...(this.byKey.get(key) ?? [])];
    const outlines = mints.map((m) => this.tape.outline(m)).filter((o): o is NonNullable<ReturnType<PumpTape["outline"]>> => Boolean(o) && o!.mint !== except);
    const social = this.byMint.get(mints[0] ?? "")?.find((s) => s.key === key);
    if (!social) return null;
    return {
      social,
      launches: outlines.length,
      fastDumps: outlines.filter((o) => o.fastDump).length,
      creators: new Set(outlines.map((o) => o.creator)).size,
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

  get size() {
    return { read: this.byMint.size, accounts: this.byKey.size, queued: this.queue.length };
  }

  /** Forgets launches the tape no longer keeps. */
  prune(now = Date.now()): void {
    for (const mint of this.byMint.keys()) {
      const o = this.tape.outline(mint);
      if (!o || now - o.createdAt > KEEP_MS) this.byMint.delete(mint);
    }
    for (const [key, mints] of this.byKey) {
      for (const m of mints) if (!this.byMint.has(m)) mints.delete(m);
      if (!mints.size) this.byKey.delete(key);
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
      if (tick % 3600 === 0) this.prune();
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
    return JSON.stringify({ v: 1, byMint: [...this.byMint] });
  }

  load(json: string): number {
    try {
      const saved = JSON.parse(json) as { v?: number; byMint?: Array<[string, Social[]]> };
      if (saved.v !== 1) return 0;
      for (const [mint, socials] of saved.byMint ?? []) if (this.tape.outline(mint)) this.add(mint, socials);
      return this.byMint.size;
    } catch {
      return 0;
    }
  }
}

/** The one registry per node process, beside the one tape. */
export const socials = new SocialsRegistry(tape);
