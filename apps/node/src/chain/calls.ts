/**
 * Who is calling a coin: pump.fun's own callouts (relayed by the public Telegram channel @pumpfun_lp, which posts each
 * call with the caller's wallet and follower count) and FOMO theses (what traders on fomo.family wrote when they bought,
 * via fomoapi.io). The X-Ray sets each caller against the chain: a caller who sniped the launch or is the dev's own
 * wallet is the point, not the shill itself.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";

const CHANNEL = `https://t.me/s/${process.env.CALLOUT_CHANNEL ?? "pumpfun_lp"}`;
/** A call is kept 30 days, on disk, so a restart does not empty the tab. */
const KEEP_MS = 30 * 86_400_000;
const POLL_MS = 30_000;
/** A cold start walks the channel back this many pages, one a second: a polite reader of a public page. */
const BACKFILL_PAGES = 40;

export interface Callout {
  /** The channel post id, unique and increasing. */
  post: number;
  mint: string;
  symbol: string;
  text: string;
  caller: string;
  followers: number | null;
  twitter: string | null;
  wallet: string | null;
  /** Market cap in USD when the call was made, and when the channel posted it. */
  calledMcUsd: number | null;
  mcUsd: number | null;
  /** The caller's how-many-th call on this coin. */
  nth: number | null;
  /** When the call was made: the post time less the channel's "Called: N minutes ago". */
  at: number;
  /** When the channel posted it. */
  postedAt: number;
  url: string;
}

/** pump.fun mentions arrive as @[name](user id): keep the name. */
export const cleanMentions = (s: string) => s.replace(/@\[([^\]]{1,40})\]\([0-9a-f-]{36}\)/gi, "@$1");
const AGO: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };

const strip = (html: string) =>
  html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/(blockquote|div|p)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#036;/g, "$")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

const usd = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** One channel page: every callout post on it, oldest first. Posts that are not callouts are skipped. */
export function parseChannel(html: string): Callout[] {
  const out: Callout[] = [];
  for (const block of html.split('data-post="').slice(1)) {
    const id = /^[^/]+\/(\d+)"/.exec(block);
    const start = block.indexOf("js-message_text");
    if (!id || start < 0) continue;
    const end = block.indexOf("tgme_widget_message_footer", start);
    const text = strip(block.slice(block.indexOf(">", start) + 1, end > 0 ? end : undefined));
    if (!/CALLOUT/.test(text)) continue;
    const line = (label: RegExp) => label.exec(text)?.[1]?.trim();
    const mint = /CONTRACT\s*\n+\s*([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(text)?.[1] ?? /pump\.fun\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(block)?.[1];
    if (!mint) continue;
    const sym = /\(\s*\$([^)\n]{1,24})\)/.exec(text)?.[1]?.trim() ?? "";
    const said = cleanMentions(/💬\s*CALLOUT\s*\n+([\s\S]*?)\n+\s*💰/.exec(text)?.[1]?.trim() ?? "");
    const time = /<time datetime="([^"]+)"/.exec(block)?.[1];
    const postedAt = time ? Date.parse(time) : Date.now();
    const ago = /Called:\s*(\d+|a|an)\s*(second|minute|hour|day)s?\s+ago/i.exec(text);
    const back = ago ? (/^\d+$/.test(ago[1]!) ? Number(ago[1]) : 1) * (AGO[ago[2]!.toLowerCase()] ?? 0) : 0;
    const twitter = line(/Twitter:\s*([^\n]+)/);
    out.push({
      post: Number(id[1]),
      mint,
      symbol: sym,
      text: said.slice(0, 400),
      caller: line(/Caller:\s*([^\n]+)/) ?? "",
      followers: usd(line(/Followers:\s*([^\n]+)/)),
      twitter: twitter && twitter.startsWith("@") ? twitter : null,
      wallet: line(/Wallet:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/) ?? null,
      calledMcUsd: usd(line(/Called at MC:\s*([^\n]+)/)),
      mcUsd: usd(line(/Market cap:\s*([^\n]+)/)),
      nth: Number(line(/Callout:\s*#(\d+)/)) || null,
      at: postedAt - back,
      postedAt,
      url: `https://t.me/pumpfun_lp/${id[1]}`,
    });
  }
  return out.sort((a, b) => a.post - b.post);
}

/** Calls by coin, refreshed from the channel every 30 seconds, kept 48 hours. */
export class CalloutFeed {
  private byMint = new Map<string, Callout[]>();
  private seen = new Set<number>();
  private last = 0;
  private timer: NodeJS.Timeout | null = null;

  private fetchFn: typeof fetch;
  private log: (m: string) => void;
  private file: string | null;
  private dirty = false;

  constructor(fetchFn: typeof fetch = fetch, log: (m: string) => void = () => {}, file: string | null = null) {
    this.fetchFn = fetchFn;
    this.log = log;
    this.file = file;
    if (file && existsSync(file)) {
      try {
        this.add(JSON.parse(readFileSync(file, "utf8")) as Callout[]);
        this.dirty = false;
      } catch (e) {
        log(`callouts: could not read ${file}: ${(e as Error).message}`);
      }
    }
  }

  get size(): number {
    return this.seen.size;
  }

  private save(): void {
    if (!this.file || !this.dirty) return;
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify([...this.byMint.values()].flat()));
      renameSync(tmp, this.file);
      this.dirty = false;
    } catch (e) {
      this.log(`callouts: could not save: ${(e as Error).message}`);
    }
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  add(calls: Callout[]): number {
    let added = 0;
    for (const c of calls) {
      if (this.seen.has(c.post)) continue;
      this.seen.add(c.post);
      const list = this.byMint.get(c.mint) ?? [];
      list.push(c);
      this.byMint.set(c.mint, list);
      this.last = Math.max(this.last, c.post);
      this.dirty = true;
      added++;
    }
    return added;
  }

  private busy = false;

  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const page = async (before?: number) => {
        const r = await this.fetchFn(before ? `${CHANNEL}?before=${before}` : CHANNEL, { headers: { "user-agent": "Mozilla/5.0 (ZOOAI X-Ray)" }, signal: AbortSignal.timeout(10_000) });
        return r.ok ? parseChannel(await r.text()) : [];
      };
      const prevLast = this.last;
      let calls = await page();
      this.add(calls);
      // Walk back until we meet what we already had: a busy minute (5 pages), or a cold start (40 pages, one a second).
      const pages = prevLast > 0 ? 5 : BACKFILL_PAGES;
      for (let i = 0; i < pages; i++) {
        const oldest = calls[0]?.post;
        if (oldest === undefined || (prevLast > 0 && oldest <= prevLast + 1)) break;
        if (prevLast === 0) await new Promise((r) => setTimeout(r, 1000));
        calls = await page(oldest);
        // An empty page, or one that did not go further back, ends the walk.
        if (!calls.length || (calls[0]?.post ?? oldest) >= oldest) break;
        this.add(calls);
      }
      this.prune();
      this.save();
    } catch (e) {
      this.log(`callouts: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private prune(): void {
    const cut = Date.now() - KEEP_MS;
    for (const [mint, list] of this.byMint) {
      const kept = list.filter((c) => c.at >= cut);
      if (kept.length !== list.length) this.dirty = true;
      if (kept.length) this.byMint.set(mint, kept);
      else this.byMint.delete(mint);
    }
    if (this.seen.size > 50_000) this.seen = new Set([...this.seen].slice(-20_000));
  }

  of(mint: string): Callout[] {
    return [...(this.byMint.get(mint) ?? [])].sort((a, b) => a.at - b.at);
  }
}

export interface Thesis {
  id: string;
  text: string;
  handle: string;
  name: string;
  avatar: string | null;
  tradeUsd: number | null;
  pnlUsd: number | null;
  isDev: boolean;
  likes: number;
  at: number;
  url: string;
  /** Hype, not a claim: emoji, "send it", cap targets. Counted, not quoted. */
  hype: boolean;
}

/**
 * A thesis that says something: enough letters to carry a claim, not only emoji, cap targets or "send it".
 * The same rule as the tutor's, so a reader of both sees the same theses quoted.
 */
const HYPE = /^(?:[\s\p{Emoji}\p{P}]|easy|send(?:\s+it)?|lfg|gm|wagmi|moon|hold(?:ing)?|tight|ape|bullish|let'?s\s+go|we\s+(?:up|go)|\d+(?:\.\d+)?\s*[kmb]?\s*(?:mc|cap)?|soon|ez|next|millions?|billions?)*$/iu;
export function meaningful(text: string): boolean {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return letters >= 15 && !HYPE.test(text.trim());
}

const TTL = 60 * 60_000;
/** What the API answers when a key can no longer read: bad key, out of credits, or held back. */
const REFUSED = new Set([401, 402, 403, 429]);

/**
 * FOMO theses for a coin, through fomoapi.io (unofficial). A page costs credits, so each coin is read at most once an
 * hour per sort and the node stops at a daily budget (FOMO_DAILY_CALLS, default 30, inside the free plan). A coin
 * under two hours old is read newest first, an older one by likes; the two merge by id. FOMO_API_KEY can list several
 * keys, comma separated: when the API refuses one (credits gone), the next takes over.
 */
export class FomoTheses {
  private cache = new Map<string, { at: number; sorts: Set<"recent" | "likes">; theses: Map<string, Thesis> }>();
  private day = "";
  private spent = 0;
  private keys: string[];
  private active = 0;
  private dailyBudget: number;
  private fetchFn: typeof fetch;

  constructor(key: string, dailyBudget = 30, fetchFn: typeof fetch = fetch) {
    this.keys = key.split(",").map((k) => k.trim()).filter(Boolean);
    this.dailyBudget = dailyBudget;
    this.fetchFn = fetchFn;
  }

  get enabled(): boolean {
    return this.keys.length > 0;
  }

  async of(mint: string, sort: "recent" | "likes" = "likes"): Promise<{ theses: Thesis[]; status: "ok" | "off" | "budget" | "error" }> {
    if (!this.enabled) return { theses: [], status: "off" };
    const hit = this.cache.get(mint);
    const fresh = hit && Date.now() - hit.at < TTL ? hit : null;
    const list = (h: typeof hit) => [...(h?.theses.values() ?? [])].sort((a, b) => b.at - a.at);
    if (fresh?.sorts.has(sort)) return { theses: list(fresh), status: "ok" };
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) (this.day = today), (this.spent = 0);
    if (this.spent >= this.dailyBudget) return { theses: list(hit), status: "budget" };
    this.spent++;
    try {
      const read = () =>
        this.fetchFn(`https://api.fomoapi.io/v2/thesis/token/${mint}?limit=40&pages=1&sort=${sort}&network=sol`, {
          headers: { authorization: `Bearer ${this.keys[this.active]}` },
          signal: AbortSignal.timeout(10_000),
        });
      let r = await read();
      while (REFUSED.has(r.status) && this.active < this.keys.length - 1) {
        this.active++;
        r = await read();
      }
      if (!r.ok) return { theses: list(hit), status: "error" };
      const body = (await r.json()) as { theses?: Array<Record<string, unknown>> };
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const merged = new Map(fresh?.theses ?? []);
      for (const x of body.theses ?? []) {
        if (typeof x.text !== "string" || !x.text.trim()) continue;
        const text = cleanMentions(String(x.text).trim()).slice(0, 500);
        const real = num(x.realizedPnlUsd);
        const unreal = num(x.unrealizedPnlUsd);
        const t: Thesis = {
          id: String(x.id ?? `${x.handle}:${x.ts}`),
          text,
          handle: String(x.handle ?? ""),
          name: String(x.name ?? ""),
          avatar: typeof x.avatar === "string" ? x.avatar : null,
          tradeUsd: num(x.tradeUsd),
          pnlUsd: real === null && unreal === null ? null : (real ?? 0) + (unreal ?? 0),
          isDev: x.isDev === true,
          likes: num(x.likes) ?? 0,
          at: Date.parse(String(x.ts ?? "")) || 0,
          url: x.handle ? `https://fomo.family/${String(x.handle)}` : "https://fomo.family",
          hype: !meaningful(text),
        };
        merged.set(t.id, t);
      }
      const entry = { at: Date.now(), sorts: new Set([...(fresh?.sorts ?? []), sort]), theses: merged };
      this.cache.set(mint, entry);
      if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value!);
      return { theses: list(entry), status: "ok" };
    } catch {
      return { theses: list(hit), status: "error" };
    }
  }
}
