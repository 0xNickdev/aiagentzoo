import { PublicKey } from "@solana/web3.js";
import { type Page, safeFetch } from "./safeFetch.ts";
import { CURVE_ALIVE_SOL } from "../agents/judgement.ts";
import { solUsd } from "../chain/price.ts";
import { type TelegramClaim, telegramClaim, telegramName, type Tie, type XBook, xBook, type XClaim, xClaimOf } from "./social.ts";

/**
 * What a token says about itself, checked: the GitHub it links to (does it exist, is it its own, does it point back)
 * and whether its DexScreener profile was paid for. A link proves nothing alone: anyone can put a famous repository
 * into a coin's metadata. It counts as the token's own only when the other side names the mint too: a coin can point at any site and any
 * repository, and those two belonging together says nothing about the coin.
 */

export interface GithubClaim {
  /** none: no link found. unread: GitHub did not answer. broken: the link leads nowhere. oneway: the repository never mentions the token. related: it belongs with the site or X account the token links to, yet neither names the mint, so the token may only be pointing at someone else's project. mutual: the repository names the mint, or names the site and the site names the mint. */
  status: "none" | "unread" | "broken" | "oneway" | "related" | "mutual";
  url?: string;
  /** Where the link was found. */
  foundIn?: "metadata" | "dexscreener" | "website";
  repo?: string;
  /** What ties the repository to the token, when something does. */
  tiedBy?: Array<"mint" | "website" | "x">;
  createdAt?: number;
  pushedAt?: number;
  commits?: number;
  /** Commits on each of the last 30 days, oldest first, the last one today (UTC); 100 a page at most. */
  days?: number[];
  /** shipping: a commit in the last 7 days. active: in 30. quiet: in 180. dormant: older, or archived. */
  activity?: "shipping" | "active" | "quiet" | "dormant";
  lastCommitAt?: number;
  stars?: number;
  language?: string | null;
  fork?: boolean;
  forkOf?: string;
  archived?: boolean;
  ownerCreatedAt?: number;
  /** Plain-word points a reader should know, worst first. */
  flags: string[];
}

export interface DexClaim {
  /** null when DexScreener did not answer. */
  paid: boolean | null;
  paidAt?: number;
  /** A community takeover was paid for and approved. */
  takeover?: boolean;
  pending?: boolean;
  boosts?: number;
}

export interface Claims {
  mint: string;
  readAt: number;
  website: string | null;
  x: string | null;
  /** The token's own metadata could not be read, so a missing link is not "no link". */
  metadataRead: boolean;
  websiteRead: boolean | null;
  github: GithubClaim;
  dex: DexClaim;
  /** The X account it links to (`x` is its handle). */
  account: XClaim;
  telegram: TelegramClaim;
}

type Json = (url: string, headers?: Record<string, string>) => Promise<{ status: number; body: unknown; link: string | null } | null>;
export interface Deps {
  json: Json;
  page: (url: string, opts?: { maxBytes?: number; timeoutMs?: number }) => Promise<Page | null>;
  metadata: (mint: string) => Promise<Record<string, unknown> | null>;
  now: () => number;
  lineUsd: () => number | null;
  book: XBook;
}

const RESERVED = new Set(["about", "apps", "blog", "collections", "contact", "customer-stories", "enterprise", "explore", "events", "features", "join", "login", "marketplace", "new", "notifications", "orgs", "pricing", "pulls", "readme", "search", "security", "settings", "signup", "site", "sponsors", "team", "topics", "trending"]);
const REPO = /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?:\/([A-Za-z0-9._-]{1,100}))?/gi;

/** The GitHub places named in a text, repositories before bare profiles. */
export function githubLinks(text: string): Array<{ owner: string; repo: string | null }> {
  const out: Array<{ owner: string; repo: string | null }> = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(REPO)) {
    const owner = m[1]!;
    if (RESERVED.has(owner.toLowerCase())) continue;
    const repo = m[2]?.replace(/[.]+$/, "").replace(/\.git$/i, "") || null;
    const key = `${owner}/${repo ?? ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, repo });
  }
  return out.sort((a, b) => Number(Boolean(b.repo)) - Number(Boolean(a.repo)));
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** Hosts thousands of tokens share: naming one ties nothing to anyone. */
const SHARED_HOST = /(^|\.)(github\.com|github\.io|x\.com|twitter\.com|t\.me|telegram\.me|discord\.(gg|com)|youtube\.com|tiktok\.com|instagram\.com|reddit\.com|medium\.com|linktr\.ee|pump\.fun|dexscreener\.com|google\.com|notion\.site|vercel\.app|netlify\.app|wikipedia\.org|bags\.fm)$/i;
const hostOf = (u: string | null) => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
};
export const xHandle = (v: string): string | null => {
  const m = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i.exec(v);
  return m && !["i", "home", "search", "intent", "share", "hashtag"].includes(m[1]!.toLowerCase()) && !/\/status\//i.test(v) ? m[1]!.toLowerCase() : null;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** What in a repository's own words names this token. */
export function tiesOf(text: string, t: { mint: string; website: string | null; x: string | null }): Array<"mint" | "website" | "x"> {
  const out: Array<"mint" | "website" | "x"> = [];
  if (text.includes(t.mint)) out.push("mint");
  const host = hostOf(t.website);
  if (host && !SHARED_HOST.test(host) && new RegExp(`(^|[^a-z0-9.-])(www\\.)?${escapeRe(host)}(?![a-z0-9-]|\\.[a-z0-9])`, "i").test(text)) out.push("website");
  if (t.x && new RegExp(`((x|twitter)\\.com/|(^|[^a-z0-9_@.])@)${escapeRe(t.x)}(?![a-z0-9_])`, "i").test(text)) out.push("x");
  return out;
}

const DAY = 86_400_000;

/** A page's own scripts, at most six: the same host, loaded by the page. */
export function ownScripts(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1]!, pageUrl);
      if (u.host === new URL(pageUrl).host && /\.m?js$/i.test(u.pathname)) out.push(u.href);
    } catch {
      // Not a URL.
    }
    if (out.length === 6) break;
  }
  return out;
}

export async function readClaims(mint: string, d: Deps): Promise<Claims> {
  const now = d.now();
  const [meta, pairs, orders] = await Promise.all([
    d.metadata(mint).catch(() => null),
    d.json(`https://api.dexscreener.com/tokens/v1/solana/${mint}`),
    d.json(`https://api.dexscreener.com/orders/v1/solana/${mint}`),
  ]);
  type Info = { websites?: Array<{ url?: string }>; socials?: Array<{ url?: string }> };
  const info = (Array.isArray(pairs?.body) ? (pairs!.body as Array<{ info?: Info }>) : []).find((p) => p.info)?.info;
  const m = meta ?? {};
  const ext = (typeof m.extensions === "object" && m.extensions ? m.extensions : {}) as Record<string, unknown>;
  const tgName = telegramName([m.telegram, ext.telegram, m.website].map(str).concat((info?.socials ?? []).map((s) => str(s.url))));
  const own = [m.website, m.external_url, m.twitter, m.github, m.description, ext.website, ext.github, ext.twitter].map(str).filter(Boolean);
  const dexLinks = [...(info?.websites ?? []), ...(info?.socials ?? [])].map((x) => str(x.url)).filter(Boolean);
  const site = [m.website, m.external_url, ext.website].map(str).concat((info?.websites ?? []).map((w) => str(w.url))).find((u) => /^https?:\/\//i.test(u) && !SHARED_HOST.test(hostOf(u) ?? "github.com")) ?? null;
  const x = [m.twitter, ext.twitter].map(str).concat((info?.socials ?? []).map((s) => str(s.url))).map(xHandle).find(Boolean) ?? null;

  // The token's own words first, then what it paid to show, then the page it sends people to.
  let foundIn: GithubClaim["foundIn"] = "metadata";
  let links = githubLinks(own.join("\n"));
  if (!links.length) {
    foundIn = "dexscreener";
    links = githubLinks(dexLinks.join("\n"));
  }
  let websiteRead: boolean | null = null;
  let siteNamesMint = false;
  let fromScript = false;
  if (site) {
    const page = await d.page(site.replace(/^http:/i, "https:"));
    websiteRead = Boolean(page && page.status < 400);
    if (websiteRead) {
      siteNamesMint = page!.body.includes(mint);
      const foundNothing = !links.length;
      if (foundNothing) {
        foundIn = "website";
        links = githubLinks(page!.body);
      }
      // A site drawn in the browser has its text in its own scripts: the first ones are read too.
      if (!links.length || !siteNamesMint) {
        const bundles = await Promise.all(ownScripts(page!.body, page!.url).map((u) => d.page(u, { maxBytes: 600_000, timeoutMs: 5_000 })));
        const code = bundles.map((b) => (b && b.status === 200 ? b.body : "")).join("\n");
        siteNamesMint ||= code.includes(mint);
        if (foundNothing && !links.length) {
          links = githubLinks(code);
          fromScript = links.length > 0;
        }
      }
    }
  }
  // One rule for every account: it is the token's when it names the mint, or the site that names the mint.
  const tie = (words: string): Tie => {
    const t = tiesOf(words, { mint, website: site, x });
    return t.includes("mint") || (t.includes("website") && siteNamesMint) ? "mutual" : t.includes("website") ? "related" : "oneway";
  };
  const social = Promise.all([
    x ? readX(x, d).then((r) => xClaimOf(x, r, tie, now, d.book)) : xClaimOf(null, null, tie, now, d.book),
    telegramClaim(tgName, mint, tie, d).catch((): TelegramClaim => ({ status: "unread", ...(tgName ? { name: tgName } : {}), flags: [] })),
  ]);
  let github: GithubClaim = { status: "none", flags: [] };
  // A page can link several projects (its tools, its template). The one that names the token back is the token's.
  for (const link of links.slice(0, foundIn === "website" ? 3 : 2)) {
    const got = await readGithub(link, foundIn, { mint, website: site, x, siteNamesMint }, d, now);
    // A script names its libraries as well, so a repository found there counts only when something ties it.
    if (fromScript && got.status !== "mutual" && got.status !== "related") continue;
    if (github.status === "none" || got.status === "mutual") github = got;
    if (got.status === "mutual" || got.status === "unread") break;
  }
  const [accountClaim, telegram] = await social;
  return { mint, readAt: now, website: site, x, metadataRead: meta !== null, websiteRead, github, dex: dexOf(orders), account: accountClaim, telegram };
}

export function dexOf(r: { status: number; body: unknown } | null): DexClaim {
  if (!r || r.status !== 200 || !r.body || typeof r.body !== "object") return { paid: null };
  const b = r.body as { orders?: unknown; boosts?: unknown } | unknown[];
  // DexScreener answered with a bare list before it wrapped it.
  const list = (Array.isArray(b) ? b : Array.isArray(b.orders) ? b.orders : null) as Array<{ type?: string; status?: string; paymentTimestamp?: number }> | null;
  if (!list) return { paid: null };
  const ok = list.filter((o) => o.status === "approved");
  const profile = ok.filter((o) => o.type === "tokenProfile").sort((a, c) => (a.paymentTimestamp ?? 0) - (c.paymentTimestamp ?? 0))[0];
  const takeover = ok.some((o) => o.type === "communityTakeover");
  const pending = !profile && list.some((o) => o.type === "tokenProfile" && (o.status === "processing" || o.status === "on-hold"));
  const boosts = !Array.isArray(b) && Array.isArray(b.boosts) ? b.boosts.length : 0;
  return { paid: Boolean(profile), ...(profile?.paymentTimestamp ? { paidAt: profile.paymentTimestamp } : {}), ...(takeover ? { takeover } : {}), ...(pending ? { pending } : {}), ...(boosts ? { boosts } : {}) };
}

async function readGithub(link: { owner: string; repo: string | null }, foundIn: GithubClaim["foundIn"], token: { mint: string; website: string | null; x: string | null; siteNamesMint: boolean }, d: Deps, now: number): Promise<GithubClaim> {
  const gh = (p: string) => d.json(`https://api.github.com${p}`, { accept: "application/vnd.github+json" });
  type Repo = { full_name: string; name: string; description: string | null; homepage: string | null; fork: boolean; archived: boolean; size: number; stargazers_count: number; language: string | null; created_at: string; pushed_at: string; default_branch: string; owner: { login: string }; parent?: { full_name: string }; source?: { full_name: string } };
  const base = { url: `https://github.com/${link.owner}${link.repo ? `/${link.repo}` : ""}`, foundIn };

  let repo: Repo | null = null;
  if (link.repo) {
    const r = await gh(`/repos/${link.owner}/${link.repo}`);
    if (!r || (r.status !== 200 && r.status !== 404 && r.status !== 451)) return { ...base, status: "unread", flags: [] };
    if (r.status !== 200) return { ...base, status: "broken", flags: ["the repository it links to does not exist or is private"] };
    repo = r.body as Repo;
  } else {
    const r = await gh(`/users/${link.owner}/repos?sort=pushed&per_page=20`);
    if (!r || (r.status !== 200 && r.status !== 404)) return { ...base, status: "unread", flags: [] };
    if (r.status === 404) return { ...base, status: "broken", flags: ["the GitHub account it links to does not exist"] };
    const list = r.body as Repo[];
    if (!list.length) return { ...base, status: "oneway", flags: ["the GitHub account has no public code"] };
    // The repository that names the token speaks for the account; otherwise its own latest work does.
    repo = list.find((x) => tiesOf(`${x.description ?? ""}\n${x.homepage ?? ""}`, token).length) ?? list.find((x) => !x.fork) ?? list[0]!;
  }
  const full = repo.full_name;
  const [commits, recent, owner, readme] = await Promise.all([
    gh(`/repos/${full}/commits?per_page=1`),
    gh(`/repos/${full}/commits?per_page=100&since=${new Date(now - 30 * DAY).toISOString()}`),
    gh(`/users/${repo.owner.login}`),
    // Read from the raw host, which does not count against the API's hourly limit.
    d.page(`https://raw.githubusercontent.com/${full}/HEAD/README.md`, { maxBytes: 200_000, timeoutMs: 5_000 }),
  ]);
  const u = owner?.status === 200 ? (owner.body as { created_at?: string; blog?: string | null; bio?: string | null; twitter_username?: string | null }) : null;
  const count = commitCount(commits);
  const words = [repo.description, repo.homepage, readme && readme.status === 200 ? readme.body : "", u?.blog, u?.bio, u?.twitter_username ? `https://x.com/${u.twitter_username}` : ""].filter(Boolean).join("\n");
  const ties = tiesOf(words, token);
  const createdAt = Date.parse(repo.created_at);
  const pushedAt = Date.parse(repo.pushed_at);
  const ownerAt = u?.created_at ? Date.parse(u.created_at) : undefined;
  const forkOf = repo.parent?.full_name ?? repo.source?.full_name;

  const { days, lastCommitAt } = commitDays(recent, now);
  const last = lastCommitAt ?? (Number.isFinite(pushedAt) ? pushedAt : null);
  const activity: GithubClaim["activity"] = repo.archived || last === null || now - last > 180 * DAY ? "dormant" : now - last <= 7 * DAY ? "shipping" : now - last <= 30 * DAY ? "active" : "quiet";
  const named = ties.includes("mint") || (ties.includes("website") && token.siteNamesMint);
  const flags: string[] = [];
  if (ties.length && !named) flags.push("it goes with the site or X account this token links to, but neither names this token's address: it may be someone else's project");
  if (!ties.length) flags.push(readme ? "the repository does not mention this token, its site or its X account" : "nothing read in the repository mentions this token; its README could not be read");
  if (repo.fork) flags.push(forkOf ? `it is a fork of ${forkOf}` : "it is a fork of another project");
  if (repo.size === 0 || count === 0) flags.push("the repository is empty");
  else if (count !== null && count <= 3) flags.push(`only ${count} commit${count === 1 ? "" : "s"}`);
  if (!repo.language && repo.size > 0) flags.push("no code GitHub recognizes, only text or media");
  if (now - createdAt < 3 * DAY) flags.push(`created ${age(now - createdAt)} ago`);
  if (ownerAt && now - ownerAt < 14 * DAY) flags.push(`the GitHub account is ${age(now - ownerAt)} old`);
  if (repo.archived) flags.push("archived by its owner");
  else if (now - pushedAt > 180 * DAY) flags.push(`no push in ${Math.floor((now - pushedAt) / (30 * DAY))} months`);

  return {
    ...base,
    status: named ? "mutual" : ties.length ? "related" : "oneway",
    repo: full,
    ...(ties.length ? { tiedBy: ties } : {}),
    createdAt,
    pushedAt,
    ...(count !== null ? { commits: count } : {}),
    ...(days ? { days } : {}),
    activity,
    ...(lastCommitAt ? { lastCommitAt } : {}),
    stars: repo.stargazers_count,
    language: repo.language,
    fork: repo.fork,
    ...(repo.fork && forkOf ? { forkOf } : {}),
    archived: repo.archived,
    ...(ownerAt ? { ownerCreatedAt: ownerAt } : {}),
    flags,
  };
}

/** X's public mirror answers 404 for living accounts about two times in five, so it is asked again before giving up. */
const X_TRIES = 4;
const X_KEEP_MS = 6 * 3_600_000;
const xKept = new Map<string, { at: number; got: { status: number; body: unknown } }>();
export async function readX(handle: string, d: Pick<Deps, "json" | "now">): Promise<{ status: number; body: unknown } | null> {
  const hit = xKept.get(handle);
  if (hit && d.now() - hit.at < X_KEEP_MS) return hit.got;
  for (let i = 0; i < X_TRIES; i++) {
    const r = await d.json(`https://api.fxtwitter.com/${handle}`);
    if (r?.status === 200 && (r.body as { user?: { id?: string } } | null)?.user?.id) {
      xKept.set(handle, { at: d.now(), got: r });
      if (xKept.size > 5_000) xKept.delete(xKept.keys().next().value!);
      return r;
    }
    if (r?.status === 429) break;
  }
  return null;
}

const age = (ms: number) => (ms < 2 * DAY ? `${Math.max(1, Math.round(ms / 3_600_000))} h` : `${Math.round(ms / DAY)} days`);

/** Commits per UTC day over the last 30 days, oldest first; undefined when GitHub did not answer. */
export function commitDays(r: { status: number; body: unknown } | null, now: number): { days?: number[]; lastCommitAt?: number } {
  if (!r || (r.status !== 200 && r.status !== 409) || (r.status === 200 && !Array.isArray(r.body))) return {};
  const days = Array<number>(30).fill(0);
  const today = Math.floor(now / DAY);
  let lastCommitAt: number | undefined;
  for (const c of r.status === 200 ? (r.body as Array<{ commit?: { committer?: { date?: string }; author?: { date?: string } } }>) : []) {
    const at = Date.parse(c.commit?.committer?.date ?? c.commit?.author?.date ?? "");
    if (!Number.isFinite(at) || at > now) continue;
    const i = 29 - (today - Math.floor(at / DAY));
    if (i >= 0 && i < 30) days[i]! += 1;
    lastCommitAt = Math.max(lastCommitAt ?? 0, at);
  }
  return { days, ...(lastCommitAt ? { lastCommitAt } : {}) };
}

/** The number of commits, read from the last page number; null when GitHub did not say. */
export function commitCount(r: { status: number; body: unknown; link: string | null } | null): number | null {
  if (!r) return null;
  if (r.status === 409) return 0;
  if (r.status !== 200 || !Array.isArray(r.body)) return null;
  const last = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(r.link ?? "");
  return last ? Number(last[1]) : r.body.length;
}

/* ---------- the real world ---------- */

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

async function account(address: string, encoding: "jsonParsed" | "base64"): Promise<unknown> {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [address, { encoding }] }), signal: AbortSignal.timeout(6_000) });
  return ((await r.json()) as { result?: { value?: { data?: unknown } | null } }).result?.value?.data ?? null;
}

/** The metadata address in a Metaplex account: three length-prefixed strings after the two keys; the third is the uri. */
export function uriOfMetaplex(data: Buffer): string | null {
  try {
    let at = 65;
    let s = "";
    for (let i = 0; i < 3; i++) {
      const n = data.readUInt32LE(at);
      if (n > 400) return null;
      s = data.subarray(at + 4, at + 4 + n).toString("utf8");
      at += 4 + n;
    }
    return s.replace(/\0/g, "").trim() || null;
  } catch {
    return null;
  }
}

async function metadataUri(mint: string): Promise<string | null> {
  const data = (await account(mint, "jsonParsed")) as { parsed?: { info?: { extensions?: Array<{ extension: string; state?: { uri?: string } }> } } } | null;
  const uri = data?.parsed?.info?.extensions?.find((e) => e.extension === "tokenMetadata")?.state?.uri;
  if (uri) return uri;
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX.toBuffer(), new PublicKey(mint).toBuffer()], METAPLEX);
  const raw = (await account(pda.toBase58(), "base64")) as [string, string] | null;
  return raw ? uriOfMetaplex(Buffer.from(raw[0], "base64")) : null;
}

export async function metadataOf(mint: string): Promise<Record<string, unknown> | null> {
  const uri = await metadataUri(mint);
  if (!uri) return null;
  const cid = /(?:\/ipfs\/|^ipfs:\/\/)([A-Za-z0-9]{40,80})/.exec(uri)?.[1];
  const read = async (u: string) => {
    const page = await safeFetch(u, { maxBytes: 60_000, timeoutMs: 7_000 });
    if (!page || page.status !== 200) throw new Error("no answer");
    const j = JSON.parse(page.body) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("not metadata");
    return j as Record<string, unknown>;
  };
  // IPFS gateways stall one by one, so they are asked together and the first good answer is taken.
  return Promise.any((cid ? ["https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/", "https://dweb.link/ipfs/", "https://4everland.io/ipfs/"].map((g) => g + cid) : [uri]).map(read)).catch(() => null);
}

const json: Json = async (url, headers = {}) => {
  try {
    const token = process.env.GITHUB_TOKEN;
    const r = await fetch(url, { headers: { "user-agent": "zoo-claims/1.0", ...headers, ...(token && url.startsWith("https://api.github.com/") ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(6_000) });
    return { status: r.status, body: await r.json().catch(() => null), link: r.headers.get("link") };
  } catch {
    return null;
  }
};

const REAL: Deps = { json, page: safeFetch, metadata: metadataOf, now: () => Date.now(), book: xBook, lineUsd: () => { const p = solUsd(); return p === null ? null : p * CURVE_ALIVE_SOL; } };

const FRESH_MS = 20 * 60_000;
/** An answer with a hole in it (GitHub's limit, a gateway asleep) is asked again soon. */
const RETRY_MS = 2 * 60_000;
const kept = new Map<string, { at: number; claims: Claims }>();
const inflight = new Map<string, Promise<Claims>>();
const MAX_INFLIGHT = 8;

/** The claims of a token, kept for a while; null when too many are being read at once. */
export async function claimsOf(mint: string, deps: Deps = REAL): Promise<Claims | null> {
  const now = deps.now();
  const hit = kept.get(mint);
  if (hit) {
    const hole = hit.claims.github.status === "unread" || hit.claims.dex.paid === null || hit.claims.account.status === "unread" || hit.claims.telegram.status === "unread" || !hit.claims.metadataRead;
    if (now - hit.at < (hole ? RETRY_MS : FRESH_MS)) return hit.claims;
  }
  const going = inflight.get(mint);
  if (going) return going;
  if (inflight.size >= MAX_INFLIGHT) return null;
  const p = readClaims(mint, deps)
    .then((claims) => {
      kept.set(mint, { at: deps.now(), claims });
      if (kept.size > 5_000) kept.delete(kept.keys().next().value!);
      return claims;
    })
    .finally(() => inflight.delete(mint));
  inflight.set(mint, p);
  return p;
}
