/**
 * Who is calling a coin: pump.fun's own callouts (relayed by the public Telegram channel @pumpfun_lp, which posts each
 * call with the caller's wallet and follower count) and FOMO theses (what traders on fomo.family wrote when they bought,
 * via fomoapi.io). The X-Ray sets each caller against the chain: a caller who sniped the launch or is the dev's own
 * wallet is the point, not the shill itself.
 */

const CHANNEL = "https://t.me/s/pumpfun_lp";
/** A call stays this long; the X-Ray reads coins up to two days old. */
const KEEP_MS = 48 * 3600_000;
const POLL_MS = 30_000;

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
  at: number;
  url: string;
}

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
    const said = /💬\s*CALLOUT\s*\n+([\s\S]*?)\n+\s*💰/.exec(text)?.[1]?.trim() ?? "";
    const time = /<time datetime="([^"]+)"/.exec(block)?.[1];
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
      at: time ? Date.parse(time) : Date.now(),
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

  constructor(fetchFn: typeof fetch = fetch, log: (m: string) => void = () => {}) {
    this.fetchFn = fetchFn;
    this.log = log;
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
      added++;
    }
    return added;
  }

  async poll(): Promise<void> {
    try {
      const page = async (before?: number) => {
        const r = await this.fetchFn(before ? `${CHANNEL}?before=${before}` : CHANNEL, { headers: { "user-agent": "Mozilla/5.0 (ZOOAI X-Ray)" }, signal: AbortSignal.timeout(10_000) });
        return r.ok ? parseChannel(await r.text()) : [];
      };
      const prevLast = this.last;
      let calls = await page();
      this.add(calls);
      // A busy minute can post more than one page: walk back until we meet what we already had (at most 5 pages).
      for (let i = 0; i < 5 && prevLast > 0; i++) {
        const oldest = calls[0]?.post;
        if (oldest === undefined || oldest <= prevLast + 1) break;
        calls = await page(oldest);
        this.add(calls);
      }
      this.prune();
    } catch (e) {
      this.log(`callouts: ${(e as Error).message}`);
    }
  }

  private prune(): void {
    const cut = Date.now() - KEEP_MS;
    for (const [mint, list] of this.byMint) {
      const kept = list.filter((c) => c.at >= cut);
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
}

/**
 * FOMO theses for a coin, through fomoapi.io. A page costs credits, so each coin is read at most once per 15 minutes
 * and the node stops asking after a daily budget; the X-Ray then says the theses are resting, not that there are none.
 */
export class FomoTheses {
  private cache = new Map<string, { at: number; theses: Thesis[] }>();
  private day = "";
  private spent = 0;

  private key: string;
  private dailyBudget: number;
  private fetchFn: typeof fetch;

  constructor(key: string, dailyBudget = 300, fetchFn: typeof fetch = fetch) {
    this.key = key;
    this.dailyBudget = dailyBudget;
    this.fetchFn = fetchFn;
  }

  get enabled(): boolean {
    return this.key.length > 0;
  }

  async of(mint: string): Promise<{ theses: Thesis[]; status: "ok" | "off" | "budget" | "error" }> {
    if (!this.enabled) return { theses: [], status: "off" };
    const hit = this.cache.get(mint);
    if (hit && Date.now() - hit.at < 15 * 60_000) return { theses: hit.theses, status: "ok" };
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) (this.day = today), (this.spent = 0);
    if (this.spent >= this.dailyBudget) return { theses: hit?.theses ?? [], status: "budget" };
    this.spent++;
    try {
      const r = await this.fetchFn(`https://api.fomoapi.io/v2/thesis/token/${mint}?limit=12&sort=likes&network=sol`, {
        headers: { authorization: `Bearer ${this.key}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!r.ok) return { theses: hit?.theses ?? [], status: "error" };
      const body = (await r.json()) as { theses?: Array<Record<string, unknown>> };
      const theses: Thesis[] = (body.theses ?? [])
        .filter((x) => typeof x.text === "string" && (x.text as string).trim())
        .map((x) => ({
          id: String(x.id),
          text: String(x.text).slice(0, 500),
          handle: String(x.handle ?? ""),
          name: String(x.name ?? ""),
          avatar: typeof x.avatar === "string" ? x.avatar : null,
          tradeUsd: typeof x.tradeUsd === "number" ? x.tradeUsd : null,
          pnlUsd: typeof x.unrealizedPnlUsd === "number" || typeof x.realizedPnlUsd === "number" ? Number(x.unrealizedPnlUsd ?? 0) + Number(x.realizedPnlUsd ?? 0) : null,
          isDev: x.isDev === true,
          likes: Number(x.likes ?? 0),
          at: Date.parse(String(x.ts ?? "")) || 0,
          url: x.handle ? `https://fomo.family/${String(x.handle)}` : "https://fomo.family",
        }));
      this.cache.set(mint, { at: Date.now(), theses });
      if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value!);
      return { theses, status: "ok" };
    } catch {
      return { theses: hit?.theses ?? [], status: "error" };
    }
  }
}
