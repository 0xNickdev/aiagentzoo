import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "./safeFetch.ts";

/**
 * The X account and the Telegram a token links to, read from what both show everyone. A coin can link any account, so
 * an account counts as the token's only when it names the mint (or the token's site, which names the mint). Nothing
 * here says who a person is: it says what the token links to and what that account shows.
 */

export type Tie = "mutual" | "related" | "oneway";

export interface XClaim {
  status: "none" | "unread" | Tie;
  handle?: string;
  followers?: number;
  joinedAt?: number;
  posts?: number;
  /** Other handles this same account had when we saw it before. */
  was?: string[];
  seenSince?: number;
  flags: string[];
}

export interface TelegramClaim {
  /** group: a chat whose messages are not public. channel: its posts were read. */
  status: "none" | "unread" | "broken" | "group" | "channel";
  name?: string;
  members?: number;
  tie?: Tie;
  /** The posts read, newest back: how many and since when. */
  posts?: number;
  since?: number;
  /** Contracts posted there other than this token, and how many trade under the line or nowhere now. */
  contracts?: number;
  under?: number;
  lineUsd?: number;
  /**
   * Posts saying the dev is holding, will not sell, or that supply or liquidity is locked, while the dev wallet sold:
   * each with its time, and whether it went up after the sell (that one is the lie; before it, it was only overtaken).
   */
  heldClaims?: HeldClaim[];
  flags: string[];
}

export interface HeldClaim {
  /** When the channel posted it, ms. */
  at: number;
  /** The words that said it, as posted (cut short). */
  said: string;
  /** When the dev wallet sold: past half of the bag when it did, otherwise its first sale; ms. */
  soldAt: number;
  /** Share of the bag the dev wallet has sold by now, 0..100. */
  soldPct: number;
  afterSell: boolean;
}

/** What north says of the dev's selling: launch time, share sold, and the first and main sale in seconds after launch. */
export interface DevSells {
  createdAt: number;
  soldPct: number | null;
  firstSec: number | null;
  mainSec: number | null;
}

const DAY = 86_400_000;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/* ---------- X ---------- */

interface XUser {
  id?: string;
  screen_name?: string;
  followers?: number;
  tweets?: number;
  description?: string;
  joined?: string;
  website?: { url?: string } | null;
}

/** Handles by account id, kept on disk: a rename shows when the same id comes back under another handle. */
export class XBook {
  private readonly rows = new Map<string, { handles: string[]; at: number }>();
  private readonly file: string | null;
  constructor(file: string | null) {
    this.file = file;
    if (!file || !existsSync(file)) return;
    try {
      for (const [id, r] of JSON.parse(readFileSync(file, "utf8")) as Array<[string, { handles: string[]; at: number }]>) this.rows.set(id, r);
    } catch {
      // A torn file starts the book over.
    }
  }
  note(id: string, handle: string, now: number): { was: string[]; since: number } {
    const h = handle.toLowerCase();
    const row = this.rows.get(id) ?? { handles: [], at: now };
    if (row.handles.at(-1) !== h) {
      row.handles = [...row.handles.filter((x) => x !== h), h].slice(-6);
      this.rows.set(id, row);
      if (this.rows.size > 50_000) this.rows.delete(this.rows.keys().next().value!);
      this.save();
    }
    return { was: row.handles.filter((x) => x !== h), since: row.at };
  }
  private timer: NodeJS.Timeout | null = null;
  private save(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        writeFileSync(`${this.file}.tmp`, JSON.stringify([...this.rows]));
        renameSync(`${this.file}.tmp`, this.file!);
      } catch {
        // Tried again at the next new handle.
      }
    }, 5_000);
    this.timer.unref();
  }
}

export const xBook = new XBook(process.env.ZOO_ROLE === "marsh" ? join(process.env.ZOO_DATA_DIR ?? join(process.cwd(), "data"), "x-accounts.json") : null);

const FRESH_X = 14 * DAY;
export const age = (ms: number) => (ms < 2 * DAY ? `${Math.max(1, Math.round(ms / 3_600_000))} h` : `${Math.round(ms / DAY)} days`);

export function xClaimOf(handle: string | null, got: { status: number; body: unknown } | null, tie: (words: string) => Tie, now: number, book: XBook): XClaim {
  if (!handle) return { status: "none", flags: [] };
  const u = got?.status === 200 ? (got.body as { user?: XUser } | null)?.user : undefined;
  if (!u?.id || !u.screen_name) return { status: "unread", handle, flags: [] };
  const joinedAt = Date.parse(str(u.joined));
  const seen = book.note(u.id, u.screen_name, now);
  const status = tie(`${str(u.description)}\n${str(u.website?.url)}`);
  const flags: string[] = [];
  if (seen.was.length) flags.push(`the X account was @${seen.was.at(-1)} before`);
  if (Number.isFinite(joinedAt) && now - joinedAt < FRESH_X) flags.push(`the X account is ${age(now - joinedAt)} old`);
  return {
    status,
    handle: u.screen_name,
    ...(typeof u.followers === "number" ? { followers: u.followers } : {}),
    ...(typeof u.tweets === "number" ? { posts: u.tweets } : {}),
    ...(Number.isFinite(joinedAt) ? { joinedAt } : {}),
    ...(seen.was.length ? { was: seen.was } : {}),
    seenSince: seen.since,
    flags,
  };
}

/* ---------- Telegram ---------- */

export function telegramName(links: string[]): string | null {
  for (const l of links) {
    const m = /(?:^|\/\/|\.)(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})(?:[/?#]|$)/i.exec(l.trim());
    if (m && !["joinchat", "share", "addstickers", "proxy", "iv", "login"].includes(m[1]!.toLowerCase())) return m[1]!;
  }
  return null;
}

const unescape = (s: string) => s.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff))).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
const plain = (html: string) => unescape(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""));

/** The public card of a Telegram name: members, description, whether its posts are public. Null when no such name. */
export function telegramCard(html: string, name: string): { members: number | null; about: string; channel: boolean } | null {
  const extra = /tgme_page_extra">([^<]+)</.exec(html)?.[1];
  // A person's own name, or one nobody holds: the page looks the same, so it is only said to be no channel or group.
  if (!extra) return null;
  const n = /([\d\s ]+)\s*(?:subscriber|member)/i.exec(extra)?.[1]?.replace(/\D/g, "");
  if (!n) return null;
  return { members: Number(n), about: plain(/tgme_page_description[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ""), channel: new RegExp(`href="/s/${name}"`, "i").test(html) };
}

/** One page of a channel: the text of each post with its time, and the address of the page before. */
export function telegramPosts(html: string): { posts: Array<{ at: number; text: string }>; before: string | null } {
  const posts: Array<{ at: number; text: string }> = [];
  for (const block of html.split(/<div class="tgme_widget_message_wrap/).slice(1)) {
    // The post's own words, not the reply it quotes; its links count as words.
    const text = [...block.matchAll(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => `${plain(m[1]!)}\n${[...m[1]!.matchAll(/href="([^"]+)"/g)].map((h) => unescape(h[1]!)).join("\n")}`).join("\n");
    const at = Date.parse(/<time[^>]+datetime="([^"]+)"/.exec(block)?.[1] ?? "");
    if (Number.isFinite(at)) posts.push({ at, text });
  }
  const before = /rel="prev" href="[^"]*[?&]before=(\d+)"/.exec(html)?.[1] ?? /href="[^"]*[?&]before=(\d+)"[^>]*(?:tme_messages_more|rel="prev")/.exec(html)?.[1] ?? null;
  return { posts, before };
}

/** Pump.fun mints end in "pump"; other Solana addresses in a text may be wallets, so only these are read as contracts. */
export function contractsIn(text: string): string[] {
  return [...new Set(text.match(/(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{28,40}pump(?![1-9A-HJ-NP-Za-km-z])/g) ?? [])];
}

/**
 * A post telling holders the dev keeps their bag: "holding", "not selling", "dev won't sell", "never selling",
 * "LP locked", "supply burned". Read in English only.
 */
const HOLD_WORDS = /\b(?:(?:dev|devs|team|we|i)(?:'?s|'?re| is| are| am|'m)?\s+(?:still\s+)?holding|holding\s+(?:strong|forever|long|my bag|our bag|the bag)|(?:not|never|no|won'?t|will not|wont|isn'?t|is not|aren'?t|are not)\s+(?:be\s+)?sell(?:ing|s)?|no\s+dev\s+sell(?:ing|s)?|(?:lp|liquidity|supply|tokens?|bag|dev wallet)\s+(?:is\s+|are\s+|has been\s+|have been\s+)?(?:locked|burn(?:ed|t))|locked\s+(?:lp|liquidity|supply))\b/i;

/** The first claim of holding in a post, with a few words around it; null when it has none. */
export function holdingSaid(text: string): string | null {
  const m = HOLD_WORDS.exec(text);
  if (!m) return null;
  const from = Math.max(0, m.index - 30);
  const to = Math.min(text.length, m.index + m[0].length + 30);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "…" : ""}`;
}

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const dayHhmm = (ms: number, other: number) => (new Date(ms).toISOString().slice(0, 10) === new Date(other).toISOString().slice(0, 10) ? hhmm(ms) : `${new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${hhmm(ms)}`);

/**
 * The channel's posts against the dev wallet's sales: every post since launch that says the dev is holding while the
 * dev wallet sold, the ones after the sale first. Nothing when the dev has not sold.
 */
export function heldVsSold(posts: Array<{ at: number; text: string }>, sells: DevSells | null): { claims: HeldClaim[]; flags: string[] } {
  if (!sells || !sells.soldPct || sells.soldPct <= 0) return { claims: [], flags: [] };
  const sec = sells.mainSec ?? sells.firstSec;
  if (sec === null) return { claims: [], flags: [] };
  const soldAt = sells.createdAt + sec * 1000;
  const claims = posts
    .filter((p) => p.at >= sells.createdAt)
    .map((p) => ({ p, said: holdingSaid(p.text) }))
    .filter((x): x is { p: { at: number; text: string }; said: string } => x.said !== null)
    .map(({ p, said }) => ({ at: p.at, said, soldAt, soldPct: Math.round(sells.soldPct!), afterSell: p.at > soldAt }))
    .sort((a, b) => Number(b.afterSell) - Number(a.afterSell) || b.at - a.at)
    .slice(0, 3);
  const flags = claims.filter((c) => c.afterSell).slice(0, 1).map((c) => `the channel posted '${c.said}' at ${dayHhmm(c.at, c.soldAt)} UTC; the dev wallet sold ${c.soldPct}% at ${dayHhmm(c.soldAt, c.at)} UTC`);
  return { claims, flags };
}

const PAGES = 5;
const MAX_CONTRACTS = 60;

export interface SocialDeps {
  page: (url: string, opts?: { maxBytes?: number; timeoutMs?: number }) => Promise<Page | null>;
  json: (url: string) => Promise<{ status: number; body: unknown; link: string | null } | null>;
  now: () => number;
  /** The zoo's "alive" line in dollars at today's price; null when the price is unknown. */
  lineUsd: () => number | null;
  /** How the dev sold, from north's check; absent or null when north is not reachable. */
  devSells?: (mint: string) => Promise<DevSells | null>;
}

export async function telegramClaim(name: string | null, mint: string, tie: (words: string) => Tie, d: SocialDeps): Promise<TelegramClaim> {
  if (!name) return { status: "none", flags: [] };
  const card = await d.page(`https://t.me/${name}`, { maxBytes: 200_000, timeoutMs: 5_000 });
  if (!card || card.status !== 200) return { status: "unread", name, flags: [] };
  const c = telegramCard(card.body, name);
  if (!c) return { status: "broken", name, flags: [] };
  const base = { name, ...(c.members !== null ? { members: c.members } : {}) };
  if (!c.channel) return { ...base, status: "group", tie: tie(c.about), flags: [] };

  const posts: Array<{ at: number; text: string }> = [];
  let before: string | null = null;
  for (let i = 0; i < PAGES; i++) {
    const p = await d.page(`https://t.me/s/${name}${before ? `?before=${before}` : ""}`, { maxBytes: 600_000, timeoutMs: 5_000 });
    if (!p || p.status !== 200) break;
    const got = telegramPosts(p.body);
    posts.push(...got.posts);
    if (!got.before || !got.posts.length || got.before === before) break;
    before = got.before;
  }
  const all = `${c.about}\n${posts.map((p) => p.text).join("\n")}`;
  const others = contractsIn(all).filter((m) => m !== mint).slice(0, MAX_CONTRACTS);
  const line = d.lineUsd();
  let under: number | undefined;
  if (others.length && line !== null) under = await underLine(others, line, d);
  const held = posts.some((p) => holdingSaid(p.text)) && d.devSells ? heldVsSold(posts, await d.devSells(mint).catch(() => null)) : { claims: [], flags: [] };
  const flags: string[] = [...held.flags];
  if (others.length >= 3) flags.push(under !== undefined ? `the channel posted ${others.length} other contracts in the posts we read; ${under} of them trade under the line or nowhere now` : `the channel posted ${others.length} other contracts in the posts we read`);
  return {
    ...base,
    status: "channel",
    tie: tie(all),
    posts: posts.length,
    ...(posts.length ? { since: Math.min(...posts.map((p) => p.at)) } : {}),
    contracts: others.length,
    ...(under !== undefined ? { under, lineUsd: Math.round(line!) } : {}),
    ...(held.claims.length ? { heldClaims: held.claims } : {}),
    flags,
  };
}

/** How many of these coins trade under the line, or have no market at all; undefined when DexScreener left any batch unanswered. */
async function underLine(mints: string[], line: number, d: SocialDeps): Promise<number | undefined> {
  let up = 0;
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    const r = await d.json(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`);
    if (!r || r.status !== 200 || !Array.isArray(r.body)) return undefined;
    const best = new Map<string, number>();
    for (const p of r.body as Array<{ baseToken?: { address?: string }; marketCap?: number; fdv?: number; liquidity?: { usd?: number } }>) {
      const a = p.baseToken?.address;
      // A drained pool still shows a cap: without a thousand dollars in it, the price is not one anyone can sell at.
      if (!a || (p.liquidity && (p.liquidity.usd ?? 0) < 1_000)) continue;
      best.set(a, Math.max(best.get(a) ?? 0, p.marketCap ?? p.fdv ?? 0));
    }
    up += batch.filter((m) => (best.get(m) ?? 0) >= line).length;
  }
  return mints.length - up;
}
