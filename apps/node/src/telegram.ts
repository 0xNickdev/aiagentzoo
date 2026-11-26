import { solUsd } from "./chain/price.ts";
import type { Claims } from "./claims/claims.ts";
import { CURVE_ALIVE_SOL } from "./agents/judgement.ts";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { StateStore } from "@aiagentzoo/sdk";
import type { Trail } from "./chain/outflows.ts";
import type { CleanLaunch, CreatorRecord, LaunchOutcome, PulseEvent } from "./chain/pump.ts";
import type { BoardRow } from "./stats.ts";
import { HOLDER_MIN, isHolder as holds } from "./holders.ts";
import { type BotLang, botLang, chatLang, inLang, setChatLang, T, TC } from "./tg-i18n.ts";

/**
 * The zoo in Telegram, where traders already are: a welcome with a picture and buttons, the x-ray of any Solana token
 * (paste an address in private), a creator's record, live rugs and clean launches from the chain, alerts on watched
 * tokens and the contests' leaderboard. No model anywhere: every answer is read from the chain. Long polling, so it
 * runs wherever the node runs; it sets its own commands and description on start. Starts only with TELEGRAM_BOT_TOKEN.
 */

const API = "https://api.telegram.org";
/** A token or wallet on Solana (base58). */
const MINT = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
const MINT_ONLY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A 0x address: BNB Chain and Base are no longer read, so it gets a plain "Solana only". */
const EVM = /0x[0-9a-fA-F]{40}/;
const explorerTx = (tx: string) => `https://solscan.io/tx/${tx}`;
const WATCH_MAX = 5;
const SITE = "https://zooaiagency.com";
const TOKEN_CA = "2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B";
/** Generated art for the welcome; the bot falls back to text if it is missing. */
const WELCOME_IMAGE = `${SITE}/telegram/welcome.jpg`;
/** The mini app and the menu button: the X-Ray, inside Telegram. */
export const APP_URL = `${SITE}/xray`;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${Math.round(x * 100)}%`);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };
type Keyboard = Button[][];

/** One row of the trade terminals people use, each opening this mint straight away. */
const terminals = (mint: string): Button[] => [
  { text: "Axiom", url: `https://axiom.trade/t/${mint}` },
  { text: "GMGN", url: `https://gmgn.ai/sol/token/${mint}` },
  { text: "BullX", url: `https://neo.bullx.io/terminal?chainId=1399811149&address=${mint}` },
  { text: "Padre", url: `https://trade.padre.gg/trade/solana/${mint}` },
  { text: "pump.fun", url: `https://pump.fun/coin/${mint}` },
  { text: "FOMO", url: `https://fomo.family/coin?address=${mint}&chainId=1399811149&r=ZOOClawAgency` },
];

interface Message {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; language_code?: string };
  text?: string;
  reply_to_message?: { text?: string };
}
interface Update {
  update_id: number;
  message?: Message;
  callback_query?: { id: string; from: { id: number; language_code?: string }; data?: string; message?: Message };
}

/** What the canyon can tell the bot beyond the chain: the contests' leaderboard. */
export interface TelegramData {
  board?: () => Promise<{ minGraded: number; rows: BoardRow[] }>;
}

export interface TelegramOptions {
  token: string;
  store: StateStore;
  northUrl?: string;
  /** The node that reads what a token links to; without it the message has no such lines. */
  marshUrl?: string;
  data?: TelegramData;
  log?: (m: string) => void;
  fetchFn?: typeof fetch;
  /** Whether a wallet holds enough $ZOOAGENCY for alerts first. */
  isHolder?: (wallet: string) => Promise<boolean>;
}

/** Holders get chain alerts this much sooner than everyone else. */
export const HOLDER_HEAD_START_MS = 10 * 60_000;
const CODE_TTL_MS = 15 * 60_000;

/**
 * A one-time code that ties a Telegram chat to a wallet: the site makes it for a wallet that signed in, the bot
 * takes it with /link. Nothing about the wallet is shown in the chat.
 */
export async function linkCode(store: StateStore, wallet: string, now = Date.now()): Promise<string> {
  const code = randomBytes(5).toString("base64url").replace(/[-_]/g, "x").slice(0, 6).toUpperCase();
  await store.set(`tg:code:${code}`, { wallet, exp: now + CODE_TTL_MS });
  return code;
}

export interface PlannedAlert {
  chat: number;
  mint: string;
  text: string;
  /** When to send: now for holders, after the head start for everyone else. */
  at: number;
}

/** Who hears about which chain moment, and when: holders at once, everyone else after the head start. */
export async function planAlerts(
  events: PulseEvent[],
  watchers: Record<string, number[]>,
  isHolderChat: (chat: number) => Promise<boolean>,
  now: number,
  langOf: (chat: number) => Promise<BotLang> = async () => "en",
): Promise<PlannedAlert[]> {
  const out: PlannedAlert[] = [];
  for (const e of events) {
    if (e.kind === "launch") continue;
    for (const chat of watchers[e.mint] ?? []) {
      const holder = await isHolderChat(chat);
      const l = await langOf(chat);
      out.push(
        inLang(l, () =>
          holder
            ? { chat, mint: e.mint, at: now, text: `⚡ ${alertMessage(e)}` }
            : { chat, mint: e.mint, at: now + HOLDER_HEAD_START_MS, text: `${alertMessage(e)}\n${T("<i>Holders saw this {m} min ago. /link to see alerts first.</i>", { m: HOLDER_HEAD_START_MS / 60_000 })}` },
        ),
      );
    }
  }
  return out;
}

export async function redeemCode(store: StateStore, chat: number, code: string, now = Date.now()): Promise<string | null> {
  const key = `tg:code:${code.trim().toUpperCase()}`;
  const found = await store.get<{ wallet: string; exp: number }>(key);
  if (!found || found.exp < now) return null;
  await store.delete(key);
  await store.set(`tg:wallet:${chat}`, found.wallet);
  return found.wallet;
}

/**
 * Checks Telegram Mini App initData: Telegram signs it with a key derived from the bot token, so a valid hash
 * proves which user opened the app. Returns the user id, or null for anything forged or older than a day.
 */
export function verifyInitData(initData: string, botToken: string, now = Date.now()): number | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest("hex");
  if (expected.length !== hash.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;
  const authDate = Number(params.get("auth_date")) * 1000;
  if (!authDate || now - authDate > 24 * 3_600_000) return null;
  try {
    const id = (JSON.parse(params.get("user") ?? "{}") as { id?: number }).id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

/** Adds or removes a chat from a token's alerts; shared by the bot and the mini app. */
export async function setWatch(store: StateStore, chat: number, mint: string, on: boolean): Promise<{ ok: boolean; reason?: string }> {
  const all = (await store.get<Record<string, number[]>>("tg:watchers")) ?? {};
  const list = new Set(all[mint] ?? []);
  const mine = Object.entries(all).filter(([, chats]) => chats.includes(chat)).length;
  if (on && !list.has(chat) && mine >= WATCH_MAX) return { ok: false, reason: `Up to ${WATCH_MAX} tokens per chat. Stop watching one first.` };
  if (on) list.add(chat);
  else list.delete(chat);
  if (list.size) all[mint] = [...list];
  else delete all[mint];
  await store.set("tg:watchers", all);
  return { ok: true };
}

/* ---------- copy ---------- */

const WELCOME_LINES = [
  "<b>Welcome to ZOOAI AGENCY.</b>",
  "",
  "See who you're buying from: paste any Solana token and I'll show the dev's own wallets, the snipers in the first five seconds and who paid for them. Free.",
  "",
  "Everything is read straight from Solana: every launch on pump.fun, Raydium LaunchLab and Meteora, every buy and every sell.",
  "",
  "<b>What I can do for you:</b>",
  "· X-Ray any token: who bought in the first 5 seconds, and who they are",
  "· Check a dev's wallet: how many tokens it launched, how many it dumped, how fast",
  "· Alert you the moment a creator dumps a token you watch",
  "· Show fresh launches that passed the basic checks",
  "",
  "Paste a token address right here, or open the X-Ray.",
];
export const welcomeText = () => WELCOME_LINES.map((l) => T(l)).join("\n");

const HELP_LINES = () => [
  "<b>Commands</b>",
  "",
  "/xray &lt;token&gt; · who bought in the first 5 seconds, and who they are",
  "/dev &lt;wallet&gt; · a creator's last 48h: launches, dumps, how fast",
  "/rugs · the latest creator dumps, with transactions",
  "/clean · fresh launches that passed the basic checks",
  T("/watch &lt;token&gt; · alert on dumps, drained pools, graduation, big buys (up to {n})", { n: WATCH_MAX }),
  T("/radar on · holders: a ping the moment a coin with no red flags turns"),
  T("/link &lt;code&gt; · holders of {h}+ $ZOOAGENCY get alerts {m} minutes first", { h: HOLDER_MIN.toLocaleString("en-US"), m: HOLDER_HEAD_START_MS / 60_000 }),
  "/unwatch &lt;token&gt; · /list",
  "/leaderboard · the contests: guest agents and the odds model on one honest scale",
  "/token · $ZOOAGENCY",
  "",
  "/lang · English / 中文",
  "",
  "In a private chat just paste a Solana address. Not financial advice.",
];
const helpText = () => HELP_LINES().map((l) => T(l)).join("\n");

/** In groups only the x-ray and the dev check, so a chat is not buried in bot menus; everything else is in private. */
export const GROUP_COMMANDS = [
  { command: "xray", description: "Who you are buying from: insiders, crews, funders" },
  { command: "dev", description: "A creator wallet's launches and dumps" },
];
/** A member may ask once every this often in a group, and the bot answers a group at most once every GROUP_GAP_MS. */
export const GROUP_USER_GAP_MS = 150_000;
export const GROUP_GAP_MS = 25_000;

export const COMMANDS = [
  { command: "xray", description: "Who you are buying from: insiders, crews, funders" },
  { command: "dev", description: "A creator wallet's launches and dumps" },
  { command: "rugs", description: "Latest creator dumps, with transactions" },
  { command: "clean", description: "Fresh coins with no red flags so far" },
  { command: "radar", description: "Holders: a ping when a clean coin turns" },
  { command: "watch", description: "Alert when a token's creator dumps" },
  { command: "unwatch", description: "Stop watching a token" },
  { command: "list", description: "Tokens you watch" },
  { command: "link", description: "Holders: get alerts first" },
  { command: "leaderboard", description: "The contests on one honest scale" },
  { command: "token", description: "$ZOOAGENCY" },
  { command: "help", description: "All commands" },
];

const menu = (): Keyboard => [
  [{ text: T("Open the X-Ray"), web_app: { url: APP_URL } }],
  [
    { text: T("X-Ray a token"), callback_data: "prompt:xray" },
    { text: T("Check a dev"), callback_data: "prompt:dev" },
  ],
  [
    { text: T("Live rugs"), callback_data: "rugs" },
    { text: T("Clean launches"), callback_data: "clean" },
  ],
  [
    { text: T("Leaderboard"), callback_data: "leaderboard" },
    { text: T("Website"), url: SITE },
  ],
  [{ text: T("English / 中文"), callback_data: "lang" }],
];

/* ---------- formatting ---------- */

/** What /v1/xray answers, as much of it as the bot shows. */
export interface XRayReply {
  mint: string;
  createdAt?: number;
  symbol: string;
  check: {
    verdict: "avoid" | "caution" | "pass" | "unknown";
    /** Risk 0..100 inside the verdict's band; null when the tape never saw the token. */
    score?: number | null;
    odds?: OddsLite | null;
    reasons: string[];
    notes: string[];
    facts: { ageMin: number; creatorSoldPct?: number | null; venue?: string; platform?: string; top5BuyingPct?: number | null; earlyWallets: number | null; earlyHeldPct: number | null; churnPct: number | null; bumps: number | null; creatorCrew: number | null; ringWallets: number | null; serialSnipers: number | null; mayhem?: boolean } | null;
  };
  early: Array<{ bought: number; held?: number; tags?: string[] }>;
  funding: { funder: string | null; funderIsHot: boolean; funderLabel?: string | null; funderService?: string | null; siblings: unknown[]; siblingLaunches48h: number; siblingDumped48h: number } | null;
}

type OddsLite = { at?: "5min" | "early"; run: number; vsAverage: number; devDumps: number | null; settled?: { ran: true; peakSol: number; afterMin: number } | { ran: false; ageMin: number } };
/** A cap in dollars at today's SOL price, as people read it; in SOL until the first price is in. */
const capOf = (sol: number) => {
  const price = solUsd();
  if (price === null) return `${sol.toLocaleString("en-US")} SOL`;
  const v = sol * price;
  return v >= 999_500 ? `$${(v / 1e6).toFixed(1)}M` : v >= 9_950 ? `$${Math.round(v / 1e3)}K` : `$${(v / 1e3).toFixed(1)}K`;
};
/** The run odds in one line, as of minute five; once settled, what happened next to what was forecast. */
const oddsLine = (o: OddsLite | null | undefined) => {
  if (!o) return "";
  const p = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : "<1%");
  // The peak is the highest cap so far, not where it trades now, and its time is when that high was made.
  if (o.settled?.ran) return T("Highest so far: {s} market cap, {t} after launch (odds at minute 5: {p})", { s: capOf(o.settled.peakSol), t: o.settled.afterMin < 120 ? T("{n} min", { n: o.settled.afterMin }) : T("{n} h", { n: Math.round(o.settled.afterMin / 60) }), p: p(o.run) });
  if (o.settled) return T("Never passed {s} market cap in {h} h (odds at minute 5: {p})", { s: capOf(CURVE_ALIVE_SOL), h: Math.max(1, Math.round(o.settled.ageMin / 60)), p: p(o.run) });
  const dev = o.devDumps === null ? "" : ` · ${T("dev still dumps {p}", { p: p(o.devDumps) })}`;
  const x = o.vsAverage < 0.1 ? "<0.1" : o.vsAverage;
  return `${o.at === "early" ? T("Odds so far: {p} to pass {s} market cap · {x}× the average launch", { p: p(o.run), s: capOf(CURVE_ALIVE_SOL), x }) : T("Odds at minute 5: {p} to pass {s} market cap · {x}× the average launch", { p: p(o.run), s: capOf(CURVE_ALIVE_SOL), x })}${dev}`;
};
/** A few wallets can make the odds look strong on their own; only said while the odds are still a forecast. */
const thinLine = (c: XRayReply["check"]) => {
  const t = c.facts?.top5BuyingPct;
  return c.odds && !c.odds.settled && t != null && t > 50 ? T("⚠️ 5 wallets did {t}% of the buying, so read the odds with care", { t }) : "";
};

/**
 * What most caution coins with buyers carry (87% a dev who sold, 60% a sniper ring, 49% a sold launch bundle; pump.fun,
 * 30+ buyers, 24 Nov 2026): said in short, so it does not bury what is this coin's own.
 */
const COMMON: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^the creator (?:has )?sold (\d+)% of their own bag$/, (m) => T("dev sold {p}%", { p: m[1]! })],
  [/^\d+ wallets bought (\d+)% of the supply in the launch block and have sold (\d+)% of it$/, (m) => T("launch bundle of {a}%, {b}% of it sold", { a: m[1]!, b: m[2]! })],
  [/^(\d+) of the first-second wallets have sniped launches together before: one operator$/, (m) => T("sniper ring {n}", { n: m[1]! })],
  [/^(\d+) serial snipers got in first/, (m) => T("serial snipers {n}", { n: m[1]! })],
  [/^at least (\d+)% of the trading is wallets selling back/, (m) => T("at least {p}% churn", { p: m[1]! })],
];
/** The dev's record and their own wallets first: that is what tells two caution coins apart. */
const FIRST = [/keep sniping this creator's other launches/, /^the wallet that funded this creator/, /^this creator dumped/];
/** Why an avoid was softened: the coin's story, neither a fault of its own nor a common one. */
const STORY = /^the dev who launched it dumps their launches and already sold|^this dev sells early, yet/;
export function splitReasons(reasons: string[]): { story: string[]; worse: string[]; common: string[] } {
  const story: string[] = [];
  const worse: string[] = [];
  const common: string[] = [];
  for (const r of reasons) {
    if (STORY.test(r)) {
      story.push(r);
      continue;
    }
    const hit = COMMON.map(([re, say]) => [r.match(re), say] as const).find(([m]) => m);
    if (hit) common.push(hit[1](hit[0]!));
    else worse.push(r);
  }
  const rank = (r: string) => { const i = FIRST.findIndex((re) => re.test(r)); return i < 0 ? FIRST.length : i; };
  return { story, worse: worse.sort((a, b) => rank(a) - rank(b)), common };
}

/** What the token links to and paid for, in two lines; a source that did not answer says nothing. */
export function claimsLines(c: Claims | null, createdAt?: number | null): string[] {
  if (!c) return [];
  const out: string[] = [];
  const g = c.github;
  const link = g.url ? `<a href="${esc(g.repo ? `https://github.com/${g.repo}` : g.url)}">${esc(g.repo ?? g.url.replace("https://github.com/", ""))}</a>` : "";
  const commits = g.commits !== undefined ? ` · ${T("{n} commits", { n: g.commits })}` : "";
  if (g.status === "mutual") out.push(`<b>GitHub:</b> ${link} · ${T("names this token back")}${commits}`);
  else if (g.status === "related") out.push(`<b>GitHub:</b> ${link} · ${T("matches its links, but never names this token")}${commits}`);
  else if (g.status === "oneway") out.push(`<b>GitHub:</b> ⚠️ ${link} · ${T("does not mention this token")}${commits}`);
  else if (g.status === "broken") out.push(`<b>GitHub:</b> ⚠️ ${T("the link leads nowhere")}`);
  else if (g.status === "none" && c.metadataRead) out.push(`<b>GitHub:</b> ${T("no link found")}`);
  if (g.fork) out.push(`   ${g.forkOf ? T("fork of {r}", { r: esc(g.forkOf) }) : T("a fork")}`);
  const tied = (t: string | undefined) => (t === "mutual" ? T("names this token back") : t === "related" ? T("matches its links, but never names this token") : T("does not mention this token"));
  const a = c.account;
  if (a?.handle && a.status !== "unread" && a.status !== "none") {
    const extra = [a.followers !== undefined ? T("{n} followers", { n: a.followers.toLocaleString("en-US") }) : "", a.joinedAt ? T("since {d}", { d: new Date(a.joinedAt).toISOString().slice(0, 7) }) : ""].filter(Boolean).join(" · ");
    out.push(`<b>X:</b> @${esc(a.handle)} · ${a.status === "oneway" ? T("its bio does not name this token") : tied(a.status)}${extra ? ` · ${extra}` : ""}`);
    if (a.was?.length) out.push(`   ⚠️ ${T("was @{h} before", { h: esc(a.was.at(-1)!) })}`);
  }
  const tg = c.telegram;
  if (tg?.name && (tg.status === "channel" || tg.status === "group")) {
    const n = tg.members !== undefined ? ` · ${T("{n} members", { n: tg.members.toLocaleString("en-US") })}` : "";
    out.push(`<b>Telegram:</b> ${esc(tg.name)}${n} · ${tg.status === "group" ? T("a group, its posts are not public") : tg.tie === "oneway" ? T("does not name it in the posts we read") : tied(tg.tie)}`);
    if ((tg.contracts ?? 0) >= 3) out.push(`   ⚠️ ${tg.under !== undefined ? T("{n} other contracts in its last {p} posts, {u} under ${l} or not trading", { n: tg.contracts!, p: tg.posts ?? 0, u: tg.under, l: (tg.lineUsd ?? 0).toLocaleString("en-US") }) : T("{n} other contracts in its last {p} posts", { n: tg.contracts!, p: tg.posts ?? 0 })}`);
  } else if (tg?.status === "broken") out.push(`<b>Telegram:</b> ${T("no public channel or group at that link")}`);
  const d = c.dex;
  if (d.paid) {
    const min = d.paidAt && createdAt && d.paidAt >= createdAt ? Math.round((d.paidAt - createdAt) / 60_000) : null;
    out.push(`<b>DexScreener:</b> ${min === null ? T("paid") : T("paid, {t} after launch", { t: min < 120 ? T("{n} min", { n: min }) : T("{n} h", { n: Math.round(min / 60) }) })}`);
  } else if (d.paid === false) out.push(`<b>DexScreener:</b> ${T(d.pending ? "payment in review" : d.takeover ? "community takeover" : "not paid")}`);
  return out;
}

/** The x-ray as a Telegram message: the verdict with every reason, then the first seconds, the money, the churn. */
export function xrayMessage(x: XRayReply, claims: Claims | null = null): string {
  const c = x.check;
  const f = c.facts;
  const icon = c.verdict === "avoid" ? "🔴" : c.verdict === "pass" ? "🟢" : "⚪️";
  const label = { avoid: "AVOID", caution: "CAUTION", pass: "NO RED FLAGS", unknown: "NOT ON THE STREAM" }[c.verdict];
  const venue = { stonk: "StonkFun", launchlab: "Raydium LaunchLab", dbc: "Meteora", raydium: "Raydium", cpmm: "Raydium CPMM" }[f?.platform ?? f?.venue ?? ""] ?? "pump.fun";
  // Caution is most coins with buyers, so the word goes last and what differs goes first. Avoid and the rest lead with theirs.
  const caution = c.verdict === "caution";
  const thin = thinLine(c);
  const lines = [`${icon} <b>$${esc(x.symbol)}</b>${caution ? "" : ` · <b>${T(label)}</b>`} · ${venue}`, ...(c.odds ? [oddsLine(c.odds)] : []), ...(thin ? [thin] : []), ""];
  if (caution) {
    const { story, worse, common } = splitReasons(c.reasons);
    for (const r of story) lines.push(esc(TC(r)), "");
    if (worse.length) {
      lines.push(T("<b>Worse than usual</b>"));
      for (const r of worse.slice(0, 6)) lines.push(`• ${esc(TC(r))}`);
    } else lines.push(T("<b>Worse than usual:</b> nothing found"));
    if (common.length) lines.push("", `${T("<b>Common on coins with buyers:</b>")} ${common.join(", ")}`);
    lines.push("", T("Verdict: {v}", { v: T(label) }), "");
  } else {
    for (const r of c.reasons.slice(0, 6)) lines.push(`• ${esc(TC(r))}`);
    if (c.reasons.length) lines.push("");
  }
  if (f) {
    // Only what is there: a line of zeros reads like a broken report.
    const took = x.early.reduce((n, e) => n + e.bought, 0);
    if (!f.earlyWallets) lines.push(T("<b>First 5 seconds:</b> nobody bought before it was visible"));
    else {
      lines.push(T("<b>First 5 seconds:</b> {n} wallets took {t}, still hold {h}", { n: f.earlyWallets, t: pct(took), h: `${f.earlyHeldPct ?? 0}%` }));
      const count = (tag: string) => x.early.filter((e) => e.tags?.includes(tag)).length;
      const who = [
        count("kol") ? T("KOL wallets {n}", { n: count("kol") }) : "",
        count("smart") ? T("smart money {n}", { n: count("smart") }) : "",
        f.creatorCrew ? T("creator's crew {n}", { n: f.creatorCrew }) : "",
        count("rugger") ? T("known ruggers {n}", { n: count("rugger") }) : "",
        f.ringWallets ? T("sniper ring {n}", { n: f.ringWallets }) : "",
        f.serialSnipers ? T("serial snipers {n}", { n: f.serialSnipers }) : "",
        count("whale") ? T("whales {n}, hold {h}", { n: count("whale"), h: pct(x.early.filter((e) => e.tags?.includes("whale")).reduce((n, e) => n + (e.held ?? 0), 0)) }) : "",
        count("new") ? T("new wallets {n}", { n: count("new") }) : "",
      ].filter(Boolean);
      if (who.length) lines.push(who.join(" · "));
    }
    const vol = [f.churnPct ? T("at least {p}% churn", { p: f.churnPct }) : "", f.bumps ? T("{b} bump bot trades", { b: f.bumps }) : ""].filter(Boolean);
    if (vol.length) lines.push(`${T("<b>Volume:</b>")} ${vol.join(" · ")}`);
  }
  const fu = x.funding;
  if (!fu) lines.push(T("<b>Who paid for the creator:</b> not traced yet, queued"));
  else if (!fu.funder) lines.push(T("<b>Who paid for the creator:</b> no funding transfer found"));
  else if (fu.funderService) lines.push(T("<b>Who paid for the creator:</b> {x}'s launcher, it pays for every launch there", { x: fu.funderService }));
  else if (fu.funderLabel) lines.push(T("<b>Who paid for the creator:</b> a withdrawal from {x}", { x: fu.funderLabel }));
  else if (fu.funderIsHot) lines.push(T("<b>Who paid for the creator:</b> an exchange, ties no one together"));
  else lines.push(T("<b>Who paid for the creator:</b> <code>{w}</code> · funded {n} other creators, {d} dumps in 48h", { w: `${fu.funder.slice(0, 4)}…${fu.funder.slice(-4)}`, n: fu.siblings.length, d: fu.siblingDumped48h }));
  lines.push(...claimsLines(claims, x.createdAt));
  if (c.notes.length) lines.push("", `<i>${esc(c.notes.map(TC).join(" · "))}</i>`);
  return lines.join("\n");
}

/** The dev has sold at least this share of the bag before the bot follows the money: before that there is little to follow. */
const TRAIL_SOLD_PCT = 50;

/** Where the dev's SOL ended up, three hops deep, said as transfers and never as owners. */
export function trailMessage(symbol: string, t: Trail): string {
  const parts: string[] = [];
  if (t.funderBack) parts.push(T("the wallet that paid the dev"));
  if (t.devs) parts.push(t.devs === 1 ? T("a wallet that launched {n} coins and dumped {d}", { n: t.launches, d: t.dumped }) : T("{k} wallets that launched {n} coins and dumped {d}", { k: t.devs, n: t.launches, d: t.dumped }));
  if (t.kols.length) parts.push(T(t.kols.length === 1 ? "the wallet of {x}, a KOL on Kolscan" : "KOL wallets on Kolscan: {x}", { x: esc(t.kols.join(", ")) }));
  if (t.paymasters) parts.push(t.paymasters === 1 ? (t.paidDevs === 1 ? T("a wallet that pays another dev") : T("a wallet that paid {n} other devs", { n: t.paidDevs })) : T("{k} wallets that pay other devs", { k: t.paymasters }));
  if (t.cabals.length) parts.push(t.cabals.length === 1 ? T("a wallet in cabal #{c}", { c: t.cabals[0]! }) : T("wallets in {n} cabals", { n: t.cabals.length }));
  return [
    T("🧭 <b>${s}: where the SOL went</b>", { s: esc(symbol) }),
    T("In the day after launch, the dev's SOL leads to {p}.", { p: parts.join("; ") }),
    "",
    `<i>${T("Transfers we can see on chain: who received the SOL, not who owns the wallets.")}</i>`,
  ].join("\n");
}

function creatorLine(r: CreatorRecord): string {
  return T("{n} launches in 48h, dumped {d}", { n: r.launches48h, d: r.dumped }) + (r.medianDumpMin !== null ? T(", median {m} min", { m: r.medianDumpMin }) : "");
}

export function alertMessage(e: PulseEvent): string {
  const icon = e.kind === "dump" || e.kind === "drained" ? "🔴" : e.kind === "graduated" ? "🟢" : "⚪️";
  const tx = e.tx ? ` · <a href="${explorerTx(e.tx)}">tx</a>` : "";
  return `${icon} <b>$${esc(e.symbol)}</b>: ${esc(TC(e.text))}${tx}\n<code>${e.mint}</code>`;
}

const span = (sec: number) => (sec < 120 ? `${sec}s` : sec < 2 * 3600 ? `${Math.round(sec / 60)} min` : `${Math.round(sec / 3600)} h`);

/** sold in 40s · took +1.3 SOL · 23 left holding · dead: "dumped after 0 min" told launches apart from nothing. */
export function launchLine(t: LaunchOutcome): string {
  const parts: string[] = [];
  if (t.dumpedAfterMin !== null) {
    const sec = t.dumpedAfterSec ?? null;
    parts.push(sec !== null ? T("sold in {s}", { s: span(sec) }) : t.dumpedAfterMin === 0 ? T("sold within a minute") : T("dumped after {m} min", { m: t.dumpedAfterMin }));
    if (t.devTookSol !== null && t.devTookSol !== undefined && Math.abs(t.devTookSol) >= 0.05) parts.push(t.devTookSol > 0 ? T("took +{n} SOL", { n: t.devTookSol.toFixed(t.devTookSol >= 10 ? 0 : 1) }) : T("sold at a loss"));
    if (t.leftHolding) parts.push(T("{n} left holding", { n: t.leftHolding }));
  } else parts.push(T(t.graduated ? "graduated" : "creator holding"));
  if (t.alive === false) parts.push(T("dead"));
  return parts.join(" · ");
}

export function devMessage(r: CreatorRecord): string {
  const serial = r.launches48h >= 3 && r.dumped >= Math.ceil(r.launches48h / 2);
  const lines = [
    `<b>${T("Dev {w}", { w: short(r.wallet) })}</b>${serial ? T(" · 🔴 serial dumper") : ""}`,
    "",
    `<b>${creatorLine(r)}</b>`,
    T("{a} in the last 24h · {g} graduated", { a: r.launches24h, g: r.graduated }),
    "",
  ];
  const p = r.pattern;
  const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${n >= 1e4 ? Math.round(n / 1e3) : (n / 1e3).toFixed(1)}K` : `$${n}`);
  if (p?.peakCapUsd && p.peakAfterSec !== null && p.firstSellSec !== null) lines.push(T("usually: peaks {c} in {s}, dev sells after {f}", { c: money(p.peakCapUsd), s: span(p.peakAfterSec), f: span(p.firstSellSec) }));
  if (r.repeats?.length) lines.push(`🔁 ${T("repeats {r}", { r: r.repeats.map((x) => `${esc(x.symbol)} ×${x.n}`).join(", ") })}`);
  if (p || r.repeats?.length) lines.push("");
  for (const t of r.recent.slice(0, 8)) {
    lines.push(`${t.dumpedAfterMin !== null ? "🔴" : t.graduated ? "🟢" : "⚪️"} $${esc(t.symbol)} · ${launchLine(t)}`);
  }
  lines.push("", `<code>${r.wallet}</code>`);
  return lines.join("\n");
}

/* ---------- the bot ---------- */

export function startTelegram(opts: TelegramOptions): () => void {
  const f = opts.fetchFn ?? fetch;
  const log = opts.log ?? console.log;
  solUsd(); // so the first message already has dollars
  const data = opts.data ?? {};
  const call = async (method: string, body: unknown) => {
    const r = await f(`${API}/bot${opts.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(40_000) });
    return (await r.json()) as { ok: boolean; result?: unknown; description?: string };
  };
  const send = (chat: number, text: string, keyboard?: Keyboard, extra: Record<string, unknown> = {}) =>
    call("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}), ...extra }).catch(() => null);
  const north = async <T>(path: string): Promise<T | null> => {
    if (!opts.northUrl) return null;
    try {
      const r = await f(`${opts.northUrl}${path}`, { signal: AbortSignal.timeout(8_000) });
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  };

  let stopped = false;
  let offset = 0;
  let botName = "";
  const watchers = async () => (await opts.store.get<Record<string, number[]>>("tg:watchers")) ?? {};

  /* ----- actions shared by commands and buttons ----- */

  const welcome = async (chat: number, name?: string) => {
    const text = welcomeText();
    const caption = name ? text.replace(T("<b>Welcome to ZOOAI AGENCY.</b>"), T("<b>Hi {name}, welcome to ZOOAI AGENCY.</b>", { name: esc(name) })) : text;
    const photo = await call("sendPhoto", { chat_id: chat, photo: WELCOME_IMAGE, caption, parse_mode: "HTML", reply_markup: { inline_keyboard: menu() } }).catch(() => null);
    if (!photo?.ok) await send(chat, caption, menu());
  };

  const xray = async (chat: number, mint: string) => {
    await call("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => null);
    if (!opts.northUrl) return void send(chat, T("The chain reader is not reachable right now. Try again in a minute."));
    try {
      // Asked alongside and never waited for long: the x-ray is the answer, the links are a footnote.
      const claimsP = opts.marshUrl
        ? f(`${opts.marshUrl}/v1/claims/${mint}`, { signal: AbortSignal.timeout(9_000) }).then((r) => (r.ok ? (r.json() as Promise<Claims>) : null)).catch(() => null)
        : Promise.resolve(null);
      const r = await f(`${opts.northUrl}/v1/xray/${mint}`, { signal: AbortSignal.timeout(12_000) });
      if (r.status === 404) {
        // Not a token the stream saw: perhaps it is a creator's wallet.
        const d = await north<CreatorRecord>(`/v1/chain/creator/${mint}`);
        if (d) return void send(chat, devMessage(d));
        return void send(chat, T("Not a launch the stream saw in the last two days (pump.fun, LaunchLab, Meteora, Raydium)."));
      }
      if (r.status === 429) return void send(chat, T("Too many x-rays right now. Try again in a minute."));
      if (!r.ok) throw new Error(String(r.status));
      const x = (await r.json()) as XRayReply;
      const claims = await Promise.race([claimsP, new Promise<null>((done) => setTimeout(() => done(null), 4_000))]);
      return void send(chat, xrayMessage(x, claims), [
        // Mini app buttons only work in a private chat; a group gets the site.
        [chat > 0 ? { text: T("Open the map"), web_app: { url: `${APP_URL}?mint=${mint}` } } : { text: T("Open the map"), url: `${APP_URL}?mint=${mint}` }],
        terminals(mint),
        [{ text: T("Watch it"), callback_data: `watch:${mint}` }],
      ]);
      // Once the dev has sold, follow the money: a second message, only when the trail leads somewhere the zoo knows.
      if ((x.check.facts?.creatorSoldPct ?? 0) >= TRAIL_SOLD_PCT) void followTrail(chat, mint, x.symbol);
      return;
    } catch {
      return void send(chat, T("The chain reader is not reachable right now. Try again in a minute."));
    }
  };

  const followTrail = async (chat: number, mint: string, symbol: string) => {
    try {
      const r = await f(`${opts.northUrl}/v1/chain/outflows/${mint}`, { signal: AbortSignal.timeout(45_000) });
      const rep = r.ok ? ((await r.json()) as { trail?: Trail | null }) : null;
      if (rep?.trail) await send(chat, trailMessage(symbol, rep.trail), [[{ text: T("Open the money map"), url: `${SITE}/xray?mint=${mint}` }]]);
    } catch {
      // No trail is not worth a message.
    }
  };

  const dev = async (chat: number, wallet: string) => {
    const r = await north<CreatorRecord>(`/v1/chain/creator/${wallet}`);
    if (!r) return void send(chat, T("No pump.fun launches from this wallet in the last 48 hours that our stream saw."));
    return void send(chat, devMessage(r));
  };

  const rugs = async (chat: number) => {
    const body = await north<{ moments: PulseEvent[] }>("/v1/chain/moments?kind=dump&limit=8");
    const list = body?.moments ?? [];
    if (!list.length) return void send(chat, T("No creator dumps on the record right now."));
    const lines = [T("<b>Latest creator dumps on pump.fun</b>"), T("<i>read straight from Solana, each with its transaction</i>"), ""];
    for (const e of list) lines.push(`• <b>$${esc(e.symbol)}</b> · ${esc(TC(e.text))}${e.tx ? ` · <a href="https://solscan.io/tx/${e.tx}">tx</a>` : ""}`);
    return void send(chat, lines.join("\n"), [[{ text: T("Refresh"), callback_data: "rugs" }, { text: T("Watch it live"), url: `${SITE}/feed` }]]);
  };

  const clean = async (chat: number) => {
    const body = await north<{ launches: CleanLaunch[] }>("/v1/chain/clean?limit=6");
    const list = body?.launches ?? [];
    const lines = [
      T("<b>No red flags so far</b>"),
      T("<i>10-180 min old, creator has not sold, not a serial wallet, 25+ buyers, no 5 wallets holding most of it. Not a call, not advice: most still die.</i>"),
      "",
    ];
    if (!list.length) lines.push(T("Nothing passes right now. On pump.fun that is a normal hour."));
    for (const c of list) lines.push(`• <b>$${esc(c.symbol)}</b> · ${T("{a} min · {b} buyers · top 5 {p}", { a: c.ageMin, b: c.buyersMore ? `${c.buyers}+` : c.buyers, p: pct(c.top5Share) })}\n<code>${c.mint}</code>`);
    const keyboard: Keyboard = list.slice(0, 6).map((c) => [{ text: T("X-Ray ${s}", { s: c.symbol }), callback_data: `xray:${c.mint}` }]);
    const pinged = ((await opts.store.get<number[]>("tg:radar")) ?? []).includes(chat);
    keyboard.push([{ text: T("Refresh"), callback_data: "clean" }, pinged ? { text: T("Stop radar pings"), callback_data: "radar:off" } : { text: T("Ping me when one turns"), callback_data: "radar:on" }]);
    return void send(chat, lines.join("\n"), keyboard);
  };

  /** Holders can have the radar come to them: a ping the moment a coin that passed turns. */
  const radarPings = async (chat: number, on: boolean) => {
    const list = new Set((await opts.store.get<number[]>("tg:radar")) ?? []);
    if (on && !(await isHolderChat(chat))) return void send(chat, T("Radar pings are a holder perk: hold {h}+ $ZOOAGENCY and /link your wallet, then /radar on.", { h: HOLDER_MIN.toLocaleString("en-US") }));
    if (on) list.add(chat);
    else list.delete(chat);
    await opts.store.set("tg:radar", [...list]);
    return void send(chat, on ? T("Radar pings on. Coins with no red flags are re-checked every minute; the moment one turns, the dev sells, bundles leave, the pool drains, you hear first. /radar off to stop.") : T("Radar pings off."));
  };

  const leaderboard = async (chat: number) => {
    const b = await data.board?.().catch(() => null);
    if (!b) return void send(chat, T("The leaderboard is resting. Try again in a minute."));
    const lines = [T("<b>Every agent, one honest scale</b>"), T("<i>balanced accuracy; a rank needs {n} graded calls with dead and living tokens among them. The odds model is the bar to beat.</i>", { n: b.minGraded }), ""];
    const ranked = b.rows.filter((r) => r.ranked);
    if (!ranked.length) lines.push(T("Nobody is ranked yet. Living tokens are rare, so it fills slowly. That is the point."), "");
    for (const [i, r] of ranked.slice(0, 8).entries()) lines.push(`${i + 1}. <b>${esc(r.name)}</b> · ${pct(r.score)} · ${T("{n} graded", { n: r.graded })}`);
    const next = b.rows.filter((r) => !r.ranked && r.graded).slice(0, 5);
    if (next.length) lines.push(T("<b>On the way:</b>"), ...next.map((r) => `• ${esc(r.name)} · ${pct(r.score)} · ${T("{n} graded", { n: r.graded })}`));
    return void send(chat, lines.join("\n"), [[{ text: T("Full leaderboard"), url: `${SITE}/contests#leaderboard` }]]);
  };

  const token = (chat: number) =>
    send(
      chat,
      ["<b>$ZOOAGENCY</b>", "", T("Launched through ClawPump, graduated to PumpSwap."), T("Holders who sign in on the site with a wallet holding {h}+ get higher x-ray limits, play the humans' contest and get alerts first (/link).", { h: HOLDER_MIN.toLocaleString("en-US") }), "", `<code>${TOKEN_CA}</code>`].join("\n"),
      [[{ text: T("Chart"), url: `https://dexscreener.com/solana/${TOKEN_CA}` }, { text: T("Website"), url: SITE }]],
    );

  const watch = async (chat: number, mint: string, on: boolean) => {
    const res = await setWatch(opts.store, chat, mint, on);
    if (!res.ok) return void send(chat, T("Up to {n} tokens per chat. Stop watching one first. /list shows them.", { n: WATCH_MAX }));
    return void send(
      chat,
      on ? T("Watching <code>{m}</code>.\nYou will hear the moment its creator dumps, it graduates, or someone buys big.", { m: mint }) : T("Stopped watching <code>{m}</code>.", { m: mint }),
      on ? [[{ text: T("Stop watching"), callback_data: `unwatch:${mint}` }]] : undefined,
    );
  };

  const list = async (chat: number) => {
    const mine = Object.entries(await watchers()).filter(([, chats]) => chats.includes(chat)).map(([m]) => m);
    if (!mine.length) return void send(chat, T("Nothing under watch yet. Send /watch with a token address."));
    return void send(chat, [T("<b>Under watch</b>"), "", ...mine.map((m) => `<code>${m}</code>`)].join("\n"), mine.map((m) => [{ text: T("Stop {m}", { m: short(m) }), callback_data: `unwatch:${m}` }]));
  };

  const prompt = (chat: number, what: "dev" | "xray") =>
    send(chat, T(what === "dev" ? "Send me the creator's wallet address." : "Send me a token to x-ray: pump.fun, LaunchLab or Meteora."), undefined, {
      reply_markup: { force_reply: true, input_field_placeholder: T(what === "dev" ? "wallet address" : "token address or link") },
    });

  const switchLang = async (chat: number) => {
    // The language this chat is being answered in, saved or taken from the Telegram client.
    const next: BotLang = botLang() === "zh" ? "en" : "zh";
    await setChatLang(opts.store, chat, next);
    return inLang(next, () => send(chat, T("Language: English. /lang switches back."), menu()));
  };

  /* ----- routing ----- */

  // In groups: who asked when, and when the bot last spoke there.
  const askedAt = new Map<string, number>();
  const spokeAt = new Map<number, number>();
  const groupReply = async (msg: Message, cmd: string, address: string | undefined) => {
    const chat = msg.chat.id;
    if (cmd === "/id") return void send(chat, `This chat's id: <code>${chat}</code>`);
    if ((cmd !== "/xray" && cmd !== "/dev") || !address) return;
    const now = Date.now();
    const key = `${chat}:${msg.from?.id ?? 0}`;
    // Over the limit the bot stays quiet: a reply saying "wait" would be the spam it is avoiding.
    if (now - (askedAt.get(key) ?? 0) < GROUP_USER_GAP_MS || now - (spokeAt.get(chat) ?? 0) < GROUP_GAP_MS) return;
    askedAt.set(key, now);
    spokeAt.set(chat, now);
    if (askedAt.size > 5_000) for (const [k, at] of askedAt) if (now - at > GROUP_USER_GAP_MS) askedAt.delete(k);
    const reply = { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } };
    const full = (start: string): Keyboard => [
      [{ text: T("Full report"), url: `https://t.me/${botName}?start=${start}` }, { text: "X-Ray ↗", url: `${SITE}/xray?${cmd === "/dev" ? "wallet" : "mint"}=${address}` }],
      ...(cmd === "/dev" ? [] : [terminals(address)]),
    ];
    if (cmd === "/dev") {
      const r = await north<CreatorRecord>(`/v1/chain/creator/${address}`);
      if (!r) return void send(chat, T("No launches from this wallet in the last two days."), undefined, reply);
      const line = r.recent[0] ? launchLine(r.recent[0]) : "";
      return void send(chat, [`<b>${T("Dev {w}", { w: short(r.wallet) })}</b> · ${creatorLine(r)}`, line ? `${T("last:")} $${esc(r.recent[0]!.symbol)} · ${line}` : ""].filter(Boolean).join("\n"), full(`d-${address}`), reply);
    }
    const x = await north<XRayReply>(`/v1/xray/${address}`);
    if (!x) return void send(chat, T("Not a launch the stream saw in the last two days (pump.fun, LaunchLab, Meteora, Raydium)."), undefined, reply);
    const c = x.check;
    const icon = c.verdict === "avoid" ? "🔴" : c.verdict === "pass" ? "🟢" : "⚪️";
    const label = { avoid: "AVOID", caution: "CAUTION", pass: "NO RED FLAGS", unknown: "NOT ON THE STREAM" }[c.verdict];
    const caution = c.verdict === "caution";
    const { story, worse, common } = caution ? splitReasons(c.reasons) : { story: [], worse: c.reasons, common: [] };
    const said = story.length || worse.length ? [...worse, ...story].slice(0, 2).map((r) => `• ${esc(TC(r))}`) : common.length ? [`${T("<b>Common on coins with buyers:</b>")} ${common.join(", ")}`] : [];
    const thin = thinLine(c);
    const lines = [`${icon} <b>$${esc(x.symbol)}</b>${caution ? "" : ` · <b>${T(label)}</b>`}`, ...(c.odds ? [oddsLine(c.odds)] : []), ...(thin ? [thin] : []), ...said, ...(caution ? [T("Verdict: {v}", { v: T(label) })] : [])];
    return void send(chat, lines.join("\n"), full(`x-${address}`), reply);
  };

  const onMessage = async (msg: Message) => {
    const text = msg.text?.trim();
    if (!text) return;
    const chat = msg.chat.id;
    const isPrivate = msg.chat.type === "private";
    const [head = "", ...rest] = text.split(/\s+/);
    const cmd = head.startsWith("/") ? head.toLowerCase().replace(`@${botName.toLowerCase()}`, "") : "";
    const arg = rest.join(" ");
    const body = cmd ? arg : text;
    // Solana only: a 0x address is BNB Chain or Base, read no more.
    const evm = EVM.test(body);
    const address = evm ? undefined : body.match(MINT)?.[0];
    // A group gets the short x-ray and dev check only, rate limited; the rest of the bot lives in private.
    if (!isPrivate) return groupReply(msg, cmd, address);
    if (evm) return void send(chat, T("Solana only: BNB Chain and Base are no longer read. Paste a Solana token or wallet address."));

    // An answer to "send me the creator's wallet".
    if (!cmd && /creator's wallet|开发者钱包/.test(msg.reply_to_message?.text ?? "") && address) return dev(chat, address);
    if (!cmd && /to x-ray|透视/.test(msg.reply_to_message?.text ?? "") && address) return xray(chat, address);

    switch (cmd) {
      case "/start":
        // t.me/<bot>?start=link-<code> from the site links the chat in one tap.
        if (arg.startsWith("link-")) return link(chat, arg.slice(5));
        // t.me/<bot>?start=w-<mint> from an x-ray on the site: watch that token in one tap.
        if (arg.startsWith("w-") && MINT_ONLY.test(arg.slice(2))) return watch(chat, arg.slice(2), true);
        // "Full report" from a group: the whole x-ray or dev record, here in private.
        if (arg.startsWith("x-") && MINT_ONLY.test(arg.slice(2))) return xray(chat, arg.slice(2));
        if (arg.startsWith("d-") && MINT_ONLY.test(arg.slice(2))) return dev(chat, arg.slice(2));
        return welcome(chat, msg.from?.first_name);
      case "/menu":
        return void send(chat, T("What next?"), menu());
      case "/help":
        return void send(chat, helpText(), menu());
      case "/id":
        // For operators: the number to put in ZOO_ALERT_CHAT so the zoo's own alerts land here.
        return void send(chat, `This chat's id: <code>${chat}</code>`);
      case "/xray":
      // /ask was the beaver's; it is an x-ray now, so an old habit still gets an answer.
      case "/ask":
        return address ? xray(chat, address) : prompt(chat, "xray");
      case "/dev":
        return address ? dev(chat, address) : prompt(chat, "dev");
      case "/rugs":
        return rugs(chat);
      case "/radar":
      case "/clean":
        return arg === "on" || arg === "off" ? radarPings(chat, arg === "on") : clean(chat);
      case "/leaderboard":
        return leaderboard(chat);
      case "/token":
        return void token(chat);
      case "/watch":
      case "/unwatch":
        return address ? watch(chat, address, cmd === "/watch") : void send(chat, `Send ${cmd} with a token address.`);
      case "/list":
        return list(chat);
      case "/link":
        return link(chat, arg);
      case "/unlink":
        await opts.store.delete(`tg:wallet:${chat}`);
        holderOf.delete(chat);
        return void send(chat, T("Unlinked. Alerts now arrive with everyone else's."));
      case "/lang":
        return switchLang(chat);
      default:
        // In a private chat, a pasted address gets the x-ray (a creator's wallet gets its record).
        if (isPrivate && address) return xray(chat, address);
        if (isPrivate) return void send(chat, T("Paste a Solana token address or a pump.fun link, or pick from the menu."), menu());
    }
  };

  const onButton = async (q: NonNullable<Update["callback_query"]>) => {
    await call("answerCallbackQuery", { callback_query_id: q.id }).catch(() => null);
    const chat = q.message?.chat.id;
    const data = q.data ?? "";
    if (!chat) return;
    const [kind, value = ""] = data.split(":");
    switch (kind) {
      case "lang":
        return switchLang(chat);
      case "menu":
        return void send(chat, T("What next?"), menu());
      case "prompt":
        return prompt(chat, value === "dev" ? "dev" : "xray");
      // "ask:" buttons on messages sent before 2026-11-20 open the x-ray.
      case "xray":
      case "ask":
        return MINT_ONLY.test(value) ? xray(chat, value) : undefined;
      case "radar":
        return radarPings(chat, value === "on");
      case "watch":
        return MINT_ONLY.test(value) ? watch(chat, value, true) : undefined;
      case "unwatch":
        return MINT_ONLY.test(value) ? watch(chat, value, false) : undefined;
      case "rugs":
        return rugs(chat);
      case "clean":
        return clean(chat);
      case "leaderboard":
        return leaderboard(chat);
    }
  };

  const setup = async () => {
    const me = await call("getMe", {}).catch(() => null);
    botName = (me?.result as { username?: string } | undefined)?.username ?? "";
    // The whole menu in private chats, only the x-ray and the dev check in groups; Chinese clients see it in Chinese.
    const zh = (list: typeof COMMANDS) => inLang("zh", () => list.map((c) => ({ ...c, description: T(c.description) })));
    for (const [scope, list] of [[{ type: "default" }, COMMANDS], [{ type: "all_private_chats" }, COMMANDS], [{ type: "all_group_chats" }, GROUP_COMMANDS]] as const) {
      await call("setMyCommands", { commands: list, scope }).catch(() => null);
      await call("setMyCommands", { commands: zh(list as typeof COMMANDS), scope, language_code: "zh" }).catch(() => null);
    }
    await call("setChatMenuButton", { menu_button: { type: "web_app", text: "X-Ray", web_app: { url: APP_URL } } }).catch(() => null);
    await call("setMyShortDescription", { short_description: "See who you're buying from: the dev's wallets, the snipers and who paid for them, for any Solana token. Free." }).catch(() => null);
    await call("setMyDescription", {
      description:
        "ZOOAI AGENCY reads every launch on pump.fun, Raydium LaunchLab and Meteora straight from Solana.\n\nX-Ray any token: who bought in the first 5 seconds, and who they are\nCheck a dev's wallet: launches, dumps, how fast\nAlerts when a creator dumps a token you watch\nFresh launches that passed the basic checks\n\nPaste a token address to start.",
    }).catch(() => null);
    log(`[telegram] bot @${botName || "?"} listening`);
  };

  const poll = async () => {
    await setup();
    while (!stopped) {
      try {
        const r = await call("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
        for (const u of (r.result as Update[] | undefined) ?? []) {
          offset = u.update_id + 1;
          const chatId = u.message?.chat.id ?? u.callback_query?.message?.chat.id;
          const from = u.message?.from ?? u.callback_query?.from;
          const l = chatId === undefined ? "en" : await chatLang(opts.store, chatId, from?.language_code);
          const job = inLang(l, () => (u.message ? onMessage(u.message) : u.callback_query ? onButton(u.callback_query) : null));
          await job?.catch((e) => log(`[telegram] ${(e as Error).message}`));
        }
        if (!r.ok) await new Promise((res) => setTimeout(res, 5_000));
      } catch {
        await new Promise((res) => setTimeout(res, 5_000));
      }
    }
  };

  /* ----- holders first ----- */

  const holderOf = new Map<number, { holder: boolean; at: number }>();
  const checkHolder = opts.isHolder ?? ((w: string) => holds(w, f));
  const isHolderChat = async (chat: number, now = Date.now()) => {
    const cached = holderOf.get(chat);
    if (cached && now - cached.at < 30 * 60_000) return cached.holder;
    const wallet = await opts.store.get<string>(`tg:wallet:${chat}`);
    const holder = wallet ? await checkHolder(wallet).catch(() => cached?.holder ?? false) : false;
    holderOf.set(chat, { holder, at: now });
    return holder;
  };
  const link = async (chat: number, code: string) => {
    if (!code.trim()) {
      return void send(chat, T("Sign in with your wallet at {site}/play, tap \"Get alerts first\", and send me the code: /link ABC123", { site: SITE }));
    }
    const wallet = await redeemCode(opts.store, chat, code);
    if (!wallet) return void send(chat, T("That code is unknown or expired. Make a new one on the site; codes last 15 minutes."));
    holderOf.delete(chat);
    const holder = await isHolderChat(chat);
    await send(
      chat,
      holder
        ? T("Linked. You hold {h}+ $ZOOAGENCY: alerts on tokens you /watch reach you {m} minutes before everyone else.", { h: HOLDER_MIN.toLocaleString("en-US"), m: HOLDER_HEAD_START_MS / 60_000 })
        : T("Linked, but this wallet holds less than {h} $ZOOAGENCY, so alerts arrive with everyone else's. Top up and they come first, no need to link again.", { h: HOLDER_MIN.toLocaleString("en-US") }),
    );
  };
  // Alerts for everyone else wait here until the holders' head start is over, kept in the store so a deploy does not drop them.
  const later: PlannedAlert[] = [];
  const saveLater = () => Promise.resolve(opts.store.set("tg:later", later)).catch(() => undefined);
  const restored = Promise.resolve(opts.store.get<PlannedAlert[]>("tg:later"))
    .then((saved) => {
      // An alert that should have gone out over an hour ago is no longer news.
      const fresh = (saved ?? []).filter((a) => a && Date.now() - a.at < 60 * 60_000);
      later.push(...fresh);
      later.sort((a, b) => a.at - b.at);
      if (fresh.length) log(`[telegram] ${fresh.length} delayed alerts restored`);
    })
    .catch(() => undefined);

  // Alerts: follow north's pulse and tell every chat that watches the token, holders first.
  let cursor = -1;
  const alerts = async () => {
    if (stopped || !opts.northUrl) return;
    const body = await north<{ events: PulseEvent[] }>(`/v1/chain/pulse?after=${Math.max(0, cursor)}`);
    if (!body) return;
    const first = cursor < 0;
    if (body.events.length) cursor = body.events[body.events.length - 1]!.seq;
    else if (first) cursor = 0;
    if (first) return;
    const planned = await planAlerts(body.events, await watchers(), (chat) => isHolderChat(chat), Date.now(), (chat) => chatLang(opts.store, chat));
    if (!planned.length) return;
    later.push(...planned);
    later.sort((a, b) => a.at - b.at);
    if (planned.some((a) => a.at > Date.now())) await saveLater();
  };
  const flush = async () => {
    const now = Date.now();
    let sent = 0;
    while (later.length && later[0]!.at <= now) {
      const a = later.shift()!;
      sent += 1;
      await send(a.chat, a.text, [[{ text: "X-Ray it", callback_data: `xray:${a.mint}` }]]);
    }
    if (sent) await saveLater();
  };

  // The radar: every coin that passed the clean list is re-checked every minute until it turns or ages out.
  // armed: the full check has read the coin as pass at least once. Only an armed coin can "turn": the clean list is
  // looser than the check, so a coin can enter it already at caution, and pinging that would be no news.
  const radar = new Map<string, { symbol: string; since: number; armed: boolean }>();
  let radarAt = 0;
  const radarTick = async () => {
    if (stopped || !opts.northUrl || Date.now() - radarAt < 60_000) return;
    radarAt = Date.now();
    const subs = (await opts.store.get<number[]>("tg:radar")) ?? [];
    const fresh = await north<{ launches: CleanLaunch[] }>("/v1/chain/clean?limit=30");
    for (const c of fresh?.launches ?? []) if (!radar.has(c.mint)) radar.set(c.mint, { symbol: c.symbol, since: Date.now(), armed: false });
    for (const [mint, t] of radar) {
      // A coin that never read pass in half an hour is not one the radar watches.
      if (Date.now() - t.since > 6 * 3_600_000 || (!t.armed && Date.now() - t.since > 30 * 60_000)) {
        radar.delete(mint);
        continue;
      }
      const c = await north<{ verdict: string; reasons: string[] }>(`/v1/check/${mint}`);
      if (!c || c.verdict === "unknown") continue;
      if (c.verdict === "pass") {
        t.armed = true;
        continue;
      }
      if (!t.armed) continue;
      radar.delete(mint);
      if (!subs.length) continue;
      const bad = c.verdict === "avoid";
      for (const chat of subs) {
        const l = await chatLang(opts.store, chat);
        const text = inLang(l, () => `${bad ? "🔴" : "🟠"} <b>$${esc(t.symbol)}</b> ${T("turned: {v}", { v: T(bad ? "AVOID" : "CAUTION") })}\n• ${esc(TC(c.reasons[0] ?? ""))}\n<code>${mint}</code>`);
        await send(chat, text, [[{ text: T("X-ray it"), url: `${APP_URL}?mint=${mint}` }]]);
      }
    }
  };

  void poll();
  const timer = setInterval(() => void restored.then(alerts).then(flush).then(radarTick), 10_000);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
