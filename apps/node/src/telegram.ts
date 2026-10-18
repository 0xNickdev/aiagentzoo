import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { StateStore } from "@aiagentzoo/sdk";
import type { Ask, AskDesk } from "./ask.ts";
import type { CleanLaunch, CreatorRecord, PulseEvent } from "./chain/pump.ts";
import type { BoardRow } from "./stats.ts";
import { HOLDER_MIN, isHolder as holds } from "./holders.ts";
import { type BotLang, botLang, chatLang, inLang, setChatLang, T, TC } from "./tg-i18n.ts";

/**
 * The beaver in Telegram: the zoo where traders already are. A welcome with a picture and buttons, a three-step
 * tour, /ask in any chat, a creator's record, live rugs and clean launches from the chain, alerts on watched tokens,
 * the nursery, the leaderboard and the brief. Long polling, so it runs wherever the node runs; it sets its own
 * commands and description on start. Starts only with TELEGRAM_BOT_TOKEN set.
 */

const API = "https://api.telegram.org";
const MINT = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
const WATCH_MAX = 5;
const SITE = "https://zooaiagency.com";
const TOKEN_CA = "2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B";
/** Generated art for the welcome; the bot falls back to text if it is missing. */
const WELCOME_IMAGE = `${SITE}/telegram/welcome.jpg`;
/** The mini app: the zoo in liquid glass, inside Telegram. */
export const APP_URL = `${SITE}/app`;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${Math.round(x * 100)}%`);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };
type Keyboard = Button[][];

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

/** What the canyon can tell the bot beyond the beaver's answers. */
export interface TelegramData {
  board?: () => Promise<{ minGraded: number; rows: BoardRow[] }>;
  stats?: () => Promise<{ tokensTonight?: number; callsTonight?: number; playbookVersion?: number }>;
  evolution?: () => Promise<{
    generation: number;
    nextGenerationInNights: number;
    creatures: Array<{ name: string; temperament: string; diedNight: string | null; lifetimeSkill: number | null; graded: number }>;
    chronicle: Array<{ kind: string; text: string }>;
  } | null>;
  latestBrief?: () => Promise<{ id: string; night: string; launches?: number; graduated?: number; wentToZero?: number } | null>;
  koi?: () => Promise<{
    tonight: Array<{ mint: string; symbol: string; why: string; whyZh?: string }>;
    tally: { picks: number; graded: number; alive: number; dead: number; nights: number };
    perNight: number;
  } | null>;
}

export interface TelegramOptions {
  token: string;
  desk: AskDesk;
  store: StateStore;
  northUrl?: string;
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
  "Behind it, a zoo of AI agents reads pump.fun, Raydium LaunchLab and Meteora straight from Solana and gets graded by reality the next day. In public.",
  "",
  "<b>What I can do for you:</b>",
  "· X-Ray any token: who bought in the first 5 seconds, and who they are",
  "· Judge any token: rug or not, with the evidence",
  "· Check a dev's wallet: how many tokens it launched, how many it dumped, how fast",
  "· Alert you the moment a creator dumps a token you watch",
  "· Show fresh launches that passed the basic checks",
  "",
  "Open the zoo for the full experience, or paste a token address right here.",
];
export const welcomeText = () => WELCOME_LINES.map((l) => T(l)).join("\n");

const TOUR_LINES = [
  [
    "<b>1/3 · The raven reads the chain</b>",
    "",
    "Most bots ask an API what is new. Our raven listens to Solana itself: every launch, every buy, every sell on pump.fun, LaunchLab and Meteora.",
    "",
    "So it knows what a chart never shows: the creator already sold their bag, this wallet launched 80 tokens today, five wallets did all the buying.",
  ],
  [
    "<b>2/3 · The beaver judges, reality grades</b>",
    "",
    "Ask about any token and the beaver gives a verdict: suspicious, watch, or promising, with the reason.",
    "",
    "Tomorrow its answer is checked against what the token actually did. Right or wrong, it stays on the record, signed on a public log.",
  ],
  [
    "<b>3/3 · Judges that evolve</b>",
    "",
    "In the nursery eight judges with fixed rules sit the same exam every night. Every three nights the weakest dies and the best two breed a child with one mutation aimed at their mistakes.",
    "",
    "Nobody hand-picks the winner. The leaderboard ranks every agent on one honest scale: calling everything a rug scores 50%, not 100%.",
  ],
];
const tourPage = (i: number) => TOUR_LINES[i]!.map((l) => T(l)).join("\n");

const HELP_LINES = () => [
  "<b>Commands</b>",
  "",
  "/xray &lt;token&gt; · who bought in the first 5 seconds, and who they are",
  "/ask &lt;token&gt; · is it a rug? the beaver judges it",
  "/dev &lt;wallet&gt; · a creator's last 48h: launches, dumps, how fast",
  "/rugs · the latest creator dumps, with transactions",
  "/clean · fresh launches that passed the basic checks",
  T("/watch &lt;token&gt; · alert on dumps, drained pools, graduation, big buys (up to {n})", { n: WATCH_MAX }),
  T("/link &lt;code&gt; · holders of {h}+ $ZOOAGENCY get alerts {m} minutes first", { h: HOLDER_MIN.toLocaleString("en-US"), m: HOLDER_HEAD_START_MS / 60_000 }),
  "/unwatch &lt;token&gt; · /list",
  "/live · pump.fun right now: launches and trades a minute",
  "/nursery · the evolving judges",
  "/leaderboard · every agent on one honest scale",
  "/brief · last night's Morning Brief",
  "/token · $ZOOAGENCY",
  "/tour · how the zoo works",
  "",
  "/lang · English / 中文",
  "",
  "In a private chat just paste an address. Not financial advice.",
];
const helpText = () => HELP_LINES().map((l) => T(l)).join("\n");

export const COMMANDS = [
  { command: "app", description: "Open the zoo" },
  { command: "xray", description: "Who you are buying from: insiders, crews, funders" },
  { command: "ask", description: "Is it a rug? The beaver judges any token" },
  { command: "dev", description: "A creator wallet's launches and dumps" },
  { command: "rugs", description: "Latest creator dumps, with transactions" },
  { command: "clean", description: "Fresh launches that passed the basic checks" },
  { command: "watch", description: "Alert when a token's creator dumps" },
  { command: "unwatch", description: "Stop watching a token" },
  { command: "list", description: "Tokens you watch" },
  { command: "link", description: "Holders: get alerts first" },
  { command: "live", description: "pump.fun right now" },
  { command: "nursery", description: "The evolving judges" },
  { command: "koi", description: "锦鲤: tonight's rare survivors" },
  { command: "leaderboard", description: "Every agent on one honest scale" },
  { command: "brief", description: "Last night's Morning Brief" },
  { command: "token", description: "$ZOOAGENCY" },
  { command: "tour", description: "How the zoo works" },
  { command: "help", description: "All commands" },
];

const menu = (): Keyboard => [
  [{ text: T("Open the zoo"), web_app: { url: APP_URL } }],
  [
    { text: T("X-Ray a token"), callback_data: "prompt:xray" },
    { text: T("Ask the beaver"), callback_data: "prompt:ask" },
  ],
  [{ text: T("Check a dev"), callback_data: "prompt:dev" }],
  [
    { text: T("Live rugs"), callback_data: "rugs" },
    { text: T("Clean launches"), callback_data: "clean" },
  ],
  [
    { text: T("Nursery"), callback_data: "nursery" },
    { text: T("Leaderboard"), callback_data: "leaderboard" },
  ],
  [
    { text: T("How it works"), callback_data: "tour:0" },
    { text: T("Website"), url: SITE },
  ],
  [{ text: T("English / 中文"), callback_data: "lang" }],
];

const tourKeyboard = (i: number): Keyboard => [
  [
    ...(i > 0 ? [{ text: T("← Back"), callback_data: `tour:${i - 1}` }] : []),
    i < TOUR_LINES.length - 1 ? { text: T("Next →"), callback_data: `tour:${i + 1}` } : { text: T("Try it: open the zoo"), web_app: { url: APP_URL } },
  ],
  [{ text: T("Menu"), callback_data: "menu" }],
];

/* ---------- formatting ---------- */

/** What /v1/xray answers, as much of it as the bot shows. */
export interface XRayReply {
  mint: string;
  symbol: string;
  check: {
    verdict: "avoid" | "caution" | "pass" | "unknown";
    reasons: string[];
    notes: string[];
    facts: { ageMin: number; venue?: string; earlyWallets: number | null; earlyHeldPct: number | null; churnPct: number | null; bumps: number | null; creatorCrew: number | null; ringWallets: number | null; serialSnipers: number | null; mayhem?: boolean } | null;
  };
  early: Array<{ bought: number }>;
  funding: { funder: string | null; funderIsHot: boolean; siblings: unknown[]; siblingLaunches48h: number; siblingDumped48h: number } | null;
}

/** The x-ray as a Telegram message: the verdict with every reason, then the first seconds, the money, the churn. */
export function xrayMessage(x: XRayReply): string {
  const c = x.check;
  const f = c.facts;
  const icon = c.verdict === "avoid" ? "🔴" : c.verdict === "pass" ? "🟢" : "⚪️";
  const label = { avoid: "AVOID", caution: "CAUTION", pass: "NO RED FLAGS", unknown: "NOT ON THE STREAM" }[c.verdict];
  const venue = { launchlab: "Raydium LaunchLab", dbc: "Meteora" }[f?.venue ?? ""] ?? "pump.fun";
  const lines = [`${icon} <b>$${esc(x.symbol)}</b> · <b>${T(label)}</b> · ${venue}`, ""];
  for (const r of c.reasons.slice(0, 6)) lines.push(`• ${esc(TC(r))}`);
  if (c.reasons.length) lines.push("");
  if (f) {
    const took = x.early.reduce((n, e) => n + e.bought, 0);
    lines.push(T("<b>First 5 seconds:</b> {n} wallets took {t}, still hold {h}", { n: f.earlyWallets ?? 0, t: pct(took), h: `${f.earlyHeldPct ?? 0}%` }));
    lines.push(T("creator's crew {c} · sniper ring {r} · serial snipers {s}", { c: f.creatorCrew ?? 0, r: f.ringWallets ?? 0, s: f.serialSnipers ?? 0 }));
    lines.push(T("<b>Volume:</b> at least {p}% churn · {b} bump bot trades", { p: f.churnPct ?? 0, b: f.bumps ?? 0 }));
  }
  const fu = x.funding;
  if (!fu) lines.push(T("<b>Who paid for the creator:</b> not traced yet, queued"));
  else if (!fu.funder) lines.push(T("<b>Who paid for the creator:</b> no funding transfer found"));
  else if (fu.funderIsHot) lines.push(T("<b>Who paid for the creator:</b> an exchange, ties no one together"));
  else lines.push(T("<b>Who paid for the creator:</b> <code>{w}</code> · funded {n} other creators, {d} dumps in 48h", { w: `${fu.funder.slice(0, 4)}…${fu.funder.slice(-4)}`, n: fu.siblings.length, d: fu.siblingDumped48h }));
  if (c.notes.length) lines.push("", `<i>${esc(c.notes.map(TC).join(" · "))}</i>`);
  return lines.join("\n");
}

function creatorLine(r: CreatorRecord): string {
  return T("{n} launches in 48h, dumped {d}", { n: r.launches48h, d: r.dumped }) + (r.medianDumpMin !== null ? T(", median {m} min", { m: r.medianDumpMin }) : "");
}

/** The answer as a Telegram message: verdict, reason, the telling facts, the link. */
export function askMessage(a: Ask): string {
  const icon = a.verdict === "suspicious" ? "🔴" : a.verdict === "promising" ? "🟢" : "⚪️";
  const lines = [`${icon} <b>$${esc(a.symbol)}</b> · <b>${T(a.verdict.toUpperCase())}</b> · ${Math.round(a.confidence * 100)}%`, "", esc(botLang() === "zh" && a.whyZh ? a.whyZh : a.why), ""];
  const c = a.facts.chain;
  const r = a.facts.creator;
  const m = a.facts.market;
  if (c?.creatorSold !== null && c?.creatorSold !== undefined) lines.push(T("• creator sold {p}", { p: pct(c.creatorSold) }));
  if (r) lines.push(T("• creator: {c}", { c: creatorLine(r) }));
  const h = a.facts.holders;
  if (h) lines.push(T("• top 10 wallets hold {p}", { p: pct(h.top10Share) }) + (h.creatorShare !== null ? T(" · dev holds {p}", { p: pct(h.creatorShare) }) : ""));
  const b = a.facts.bundle;
  if (b && b.wallets >= 2) lines.push(T("• bundle: {w} wallets took {p} of supply in the launch block", { w: b.wallets, p: pct(b.share) }) + (b.linked >= 2 ? T(", {n} funded by one wallet", { n: b.linked }) : ""));
  if (c?.top5Share !== null && c?.top5Share !== undefined) lines.push(T("• top 5 buyers: {p} of the buying", { p: pct(c.top5Share) }));
  if (m) lines.push(T("• liquidity ${l} · buys/sells 24h {b}/{s}", { l: Math.round(m.liquidityUsd ?? 0).toLocaleString("en-US"), b: m.buys24h, s: m.sells24h }));
  if (a.facts.hasSocials === false) lines.push(T("• no socials"));
  lines.push("", T(a.already ? "<i>Already dead when asked: shown, not scored.</i>" : "<i>Graded against reality in 24h, right or wrong.</i>"));
  return lines.join("\n");
}

function askKeyboard(a: Ask): Keyboard {
  return [
    [
      { text: T("Watch it"), callback_data: `watch:${a.mint}` },
      { text: T("Card & record"), url: `${SITE}/ask#${a.id}` },
    ],
    [{ text: T("Chart"), url: a.facts.url ?? `https://dexscreener.com/solana/${a.mint}` }],
  ];
}

export function alertMessage(e: PulseEvent): string {
  const icon = e.kind === "dump" || e.kind === "drained" ? "🔴" : e.kind === "graduated" ? "🟢" : "⚪️";
  const tx = e.tx ? ` · <a href="https://solscan.io/tx/${e.tx}">tx</a>` : "";
  return `${icon} <b>$${esc(e.symbol)}</b>: ${esc(TC(e.text))}${tx}\n<code>${e.mint}</code>`;
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
  for (const t of r.recent.slice(0, 8)) {
    lines.push(`${t.dumpedAfterMin !== null ? "🔴" : t.graduated ? "🟢" : "⚪️"} $${esc(t.symbol)} · ${t.dumpedAfterMin !== null ? T("dumped after {m} min", { m: t.dumpedAfterMin }) : T(t.graduated ? "graduated" : "creator holding")}`);
  }
  lines.push("", `<code>${r.wallet}</code>`);
  return lines.join("\n");
}

/* ---------- the bot ---------- */

export function startTelegram(opts: TelegramOptions): () => void {
  const f = opts.fetchFn ?? fetch;
  const log = opts.log ?? console.log;
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

  const ask = async (chat: number, who: string, mint: string) => {
    await call("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => null);
    const result = await opts.desk.ask(mint, who);
    if (result.ok) return void send(chat, askMessage(result.ask), askKeyboard(result.ask));
    // Not a traded token: perhaps it is a creator's wallet.
    if (result.status === 404) {
      const dev = await north<CreatorRecord>(`/v1/chain/creator/${mint}`);
      if (dev) return void send(chat, devMessage(dev), [[{ text: T("Open on the site"), url: `${SITE}/ask` }]]);
    }
    return void send(chat, `${esc(result.reason)}`);
  };

  const xray = async (chat: number, mint: string) => {
    await call("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => null);
    if (!opts.northUrl) return void send(chat, T("The chain reader is not reachable right now. Try again in a minute."));
    try {
      const r = await f(`${opts.northUrl}/v1/xray/${mint}`, { signal: AbortSignal.timeout(12_000) });
      if (r.status === 404) return void send(chat, T("Not a launch the stream saw in the last two days (pump.fun, LaunchLab, Meteora)."), [[{ text: T("Ask the beaver instead"), callback_data: `ask:${mint}` }]]);
      if (r.status === 429) return void send(chat, T("Too many x-rays right now. Try again in a minute."));
      if (!r.ok) throw new Error(String(r.status));
      const x = (await r.json()) as XRayReply;
      return void send(chat, xrayMessage(x), [
        // Mini app buttons only work in a private chat; a group gets the site.
        [chat > 0 ? { text: T("Open the map"), web_app: { url: `${APP_URL}?mint=${mint}` } } : { text: T("Open the map"), url: `${SITE}/xray?mint=${mint}` }],
        [
          { text: T("Watch it"), callback_data: `watch:${mint}` },
          { text: T("Ask the beaver"), callback_data: `ask:${mint}` },
        ],
      ]);
    } catch {
      return void send(chat, T("The chain reader is not reachable right now. Try again in a minute."));
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
    return void send(chat, lines.join("\n"), [[{ text: T("Refresh"), callback_data: "rugs" }, { text: T("Watch it live"), url: `${SITE}/live` }]]);
  };

  const clean = async (chat: number) => {
    const body = await north<{ launches: CleanLaunch[] }>("/v1/chain/clean?limit=6");
    const list = body?.launches ?? [];
    const lines = [
      T("<b>Passed the basic checks</b>"),
      T("<i>10-180 min old, creator has not sold, not a serial wallet, 25+ buyers, no 5 wallets holding most of it. Not a call, not advice: most still die.</i>"),
      "",
    ];
    if (!list.length) lines.push(T("Nothing passes right now. On pump.fun that is a normal hour."));
    for (const c of list) lines.push(`• <b>$${esc(c.symbol)}</b> · ${T("{a} min · {b} buyers · top 5 {p}", { a: c.ageMin, b: c.buyersMore ? `${c.buyers}+` : c.buyers, p: pct(c.top5Share) })}\n<code>${c.mint}</code>`);
    const keyboard: Keyboard = list.slice(0, 6).map((c) => [{ text: T("Ask about ${s}", { s: c.symbol }), callback_data: `ask:${c.mint}` }]);
    keyboard.push([{ text: T("Refresh"), callback_data: "clean" }]);
    return void send(chat, lines.join("\n"), keyboard);
  };

  const live = async (chat: number) => {
    const [pulse, stats] = await Promise.all([north<{ live: boolean; perMinute: { launches: number; trades: number } }>("/v1/chain/pulse?after=999999999"), data.stats?.().catch(() => null)]);
    const lines = [T("<b>pump.fun right now</b>"), ""];
    if (pulse) lines.push(`${pulse.live ? "🟢" : "⚪️"} ${T("{l} launches and {t} trades in the last minute", { l: pulse.perMinute.launches, t: pulse.perMinute.trades.toLocaleString("en-US") })}`);
    if (stats?.tokensTonight !== undefined) lines.push(T("tonight the pack watched {t} tokens and made {c} calls", { t: stats.tokensTonight.toLocaleString("en-US"), c: stats.callsTonight ?? 0 }));
    return void send(chat, lines.join("\n"), [[{ text: T("Open the live map"), url: `${SITE}/live` }]]);
  };

  /** 锦鲤: the hunter of survivors, its record against the market and tonight's picks. */
  const koi = async (chat: number) => {
    const k = await data.koi?.().catch(() => null);
    if (!k) return void send(chat, T("The koi is resting. Try again in a minute."));
    const t = k.tally;
    const lines = [T("<b>锦鲤 the koi</b> · hunter of survivors"), "", T("On pump.fun about 1 in 270 tokens is still alive a day later. The koi only looks for those."), ""];
    lines.push(t.graded
      ? T("Its record: {a} of {g} picks alive a day later ({p}).", { a: t.alive, g: t.graded, p: pct(t.alive / t.graded) })
      : T("No graded picks yet: the first ones are checked the night after it makes them."));
    lines.push("");
    if (k.tonight.length) {
      lines.push(T("<b>Tonight's picks</b> ({n} of {max})", { n: k.tonight.length, max: k.perNight }));
      for (const p of k.tonight) lines.push(`• <b>$${esc(p.symbol)}</b> <code>${p.mint}</code>\n  ${esc(botLang() === "zh" && p.whyZh ? p.whyZh : p.why)}`);
    } else lines.push(T("No picks yet tonight. Most nights the honest answer is \"none\"."));
    lines.push("", T("<i>A pick is not advice. It is graded tomorrow, in public.</i>"));
    return void send(chat, lines.join("\n"), menu());
  };
  const nursery = async (chat: number) => {
    const evo = await data.evolution?.().catch(() => null);
    if (!evo) return void send(chat, T("The nursery is resting. Try again in a minute."));
    const alive = evo.creatures.filter((c) => !c.diedNight).sort((a, b) => (b.lifetimeSkill ?? 0) - (a.lifetimeSkill ?? 0));
    const lines = [T("<b>The nursery</b> · turn {g} · next in {n} nights", { g: evo.generation, n: evo.nextGenerationInNights }), ""];
    for (const c of alive) lines.push(`• <b>${esc(c.name)}</b>, ${esc(c.temperament)} · ${c.graded ? T("{p} over {n}", { p: pct(c.lifetimeSkill), n: c.graded }) : T("no grades yet")}`);
    const last = evo.chronicle.find((e) => e.kind !== "scored");
    if (last) lines.push("", `<i>${esc(last.text)}</i>`);
    return void send(chat, lines.join("\n"), [[{ text: T("Open the nursery"), url: `${SITE}/evolution` }]]);
  };

  const leaderboard = async (chat: number) => {
    const b = await data.board?.().catch(() => null);
    if (!b) return void send(chat, T("The leaderboard is resting. Try again in a minute."));
    const lines = [T("<b>Every agent, one honest scale</b>"), T("<i>balanced accuracy; a rank needs {n} graded calls with dead and living tokens among them</i>", { n: b.minGraded }), ""];
    const ranked = b.rows.filter((r) => r.ranked);
    if (!ranked.length) lines.push(T("Nobody is ranked yet. Living tokens are rare, so it fills slowly. That is the point."), "");
    for (const [i, r] of ranked.slice(0, 8).entries()) lines.push(`${i + 1}. <b>${esc(r.name)}</b> · ${pct(r.score)} · ${T("{n} graded", { n: r.graded })}`);
    const next = b.rows.filter((r) => !r.ranked && !r.died && r.graded).slice(0, 5);
    if (next.length) lines.push(T("<b>On the way:</b>"), ...next.map((r) => `• ${esc(r.name)} · ${pct(r.score)} · ${T("{n} graded", { n: r.graded })}`));
    return void send(chat, lines.join("\n"), [[{ text: T("Full leaderboard"), url: `${SITE}/agents#leaderboard` }]]);
  };

  const brief = async (chat: number) => {
    const b = await data.latestBrief?.().catch(() => null);
    if (!b) return void send(chat, T("The next Morning Brief comes out at 07:00 UTC."));
    const parts = [
      b.launches !== undefined ? T("{n} fresh launches", { n: b.launches.toLocaleString("en-US") }) : null,
      b.graduated !== undefined ? T("{n} graduated", { n: b.graduated }) : null,
      b.wentToZero !== undefined ? T("{n} went to zero", { n: b.wentToZero }) : null,
    ].filter(Boolean);
    return void send(chat, [T("<b>Morning Brief · night of {n}</b>", { n: b.night }), "", parts.join(" · "), "", T("<i>Written by the tortoise, no human in the loop, signed on the public log.</i>")].join("\n"), [
      [{ text: T("Read the brief"), url: `${SITE}/brief` }],
    ]);
  };

  const token = (chat: number) =>
    send(
      chat,
      ["<b>$ZOOAGENCY</b>", "", T("Launched through ClawPump, graduated to PumpSwap."), T("Holders who sign in on the site with a wallet holding {h}+ ask the beaver 30 times an hour, watch 10 tokens and get alerts first (/link).", { h: HOLDER_MIN.toLocaleString("en-US") }), "", `<code>${TOKEN_CA}</code>`].join("\n"),
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

  const prompt = (chat: number, what: "ask" | "dev" | "xray") =>
    send(chat, T(what === "dev" ? "Send me the creator's wallet address." : what === "xray" ? "Send me a token to x-ray: pump.fun, LaunchLab or Meteora." : "Send me a token address or a pump.fun link."), undefined, {
      reply_markup: { force_reply: true, input_field_placeholder: T(what === "dev" ? "wallet address" : "token address or link") },
    });

  const switchLang = async (chat: number) => {
    // The language this chat is being answered in, saved or taken from the Telegram client.
    const next: BotLang = botLang() === "zh" ? "en" : "zh";
    await setChatLang(opts.store, chat, next);
    return inLang(next, () => send(chat, T("Language: English. /lang switches back."), menu()));
  };

  /* ----- routing ----- */

  const onMessage = async (msg: Message) => {
    const text = msg.text?.trim();
    if (!text) return;
    const chat = msg.chat.id;
    const isPrivate = msg.chat.type === "private";
    const [head = "", ...rest] = text.split(/\s+/);
    const cmd = head.startsWith("/") ? head.toLowerCase().replace(`@${botName.toLowerCase()}`, "") : "";
    const arg = rest.join(" ");
    const address = (cmd ? arg : text).match(MINT)?.[0];
    const who = `tg:${msg.from?.id ?? chat}`;

    // An answer to "send me the creator's wallet".
    if (!cmd && /creator's wallet|开发者钱包/.test(msg.reply_to_message?.text ?? "") && address) return dev(chat, address);
    if (!cmd && /to x-ray|透视/.test(msg.reply_to_message?.text ?? "") && address) return xray(chat, address);

    switch (cmd) {
      case "/start":
        // t.me/<bot>?start=link-<code> from the site links the chat in one tap.
        if (arg.startsWith("link-")) return link(chat, arg.slice(5));
        // t.me/<bot>?start=w-<mint> from an x-ray on the site: watch that token in one tap.
        if (arg.startsWith("w-") && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(arg.slice(2))) return watch(chat, arg.slice(2), true);
        return welcome(chat, msg.from?.first_name);
      case "/app":
        return void send(chat, "The zoo in liquid glass: ask the beaver, live rugs, clean launches, the nursery.", [[{ text: "Open the zoo", web_app: { url: APP_URL } }]]);
      case "/menu":
        return void send(chat, T("What next?"), menu());
      case "/help":
        return void send(chat, helpText(), menu());
      case "/id":
        // For operators: the number to put in ZOO_ALERT_CHAT so the zoo's own alerts land here.
        return void send(chat, `This chat's id: <code>${chat}</code>`);
      case "/tour":
        return void send(chat, tourPage(0), tourKeyboard(0));
      case "/xray":
        return address ? xray(chat, address) : prompt(chat, "xray");
      case "/ask":
        return address ? ask(chat, who, address) : prompt(chat, "ask");
      case "/dev":
        return address ? dev(chat, address) : prompt(chat, "dev");
      case "/rugs":
        return rugs(chat);
      case "/clean":
        return clean(chat);
      case "/live":
        return live(chat);
      case "/nursery":
        return nursery(chat);
      case "/koi":
        return koi(chat);
      case "/leaderboard":
        return leaderboard(chat);
      case "/brief":
        return brief(chat);
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
        // In a private chat, a pasted address is a question.
        if (isPrivate && address) return ask(chat, who, address);
        if (isPrivate) return void send(chat, T("Paste a token address or a pump.fun link, or pick from the menu."), menu());
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
      case "tour": {
        const i = Math.max(0, Math.min(TOUR_LINES.length - 1, Number(value) || 0));
        // Turn the page in place when the tour is already on screen.
        const edited = q.message?.text?.includes("/3 ·")
          ? await call("editMessageText", { chat_id: chat, message_id: q.message.message_id, text: tourPage(i), parse_mode: "HTML", reply_markup: { inline_keyboard: tourKeyboard(i) } }).catch(() => null)
          : null;
        if (!edited?.ok) await send(chat, tourPage(i), tourKeyboard(i));
        return;
      }
      case "prompt":
        return prompt(chat, value === "dev" ? "dev" : value === "xray" ? "xray" : "ask");
      case "ask":
        return MINT.test(value) ? ask(chat, `tg:${q.from.id}`, value) : undefined;
      case "watch":
        return MINT.test(value) ? watch(chat, value, true) : undefined;
      case "unwatch":
        return MINT.test(value) ? watch(chat, value, false) : undefined;
      case "rugs":
        return rugs(chat);
      case "clean":
        return clean(chat);
      case "nursery":
        return nursery(chat);
      case "leaderboard":
        return leaderboard(chat);
    }
  };

  const setup = async () => {
    const me = await call("getMe", {}).catch(() => null);
    botName = (me?.result as { username?: string } | undefined)?.username ?? "";
    await call("setMyCommands", { commands: COMMANDS }).catch(() => null);
    // Chinese clients see the menu in Chinese.
    await call("setMyCommands", { commands: inLang("zh", () => COMMANDS.map((c) => ({ ...c, description: T(c.description) }))), language_code: "zh" }).catch(() => null);
    await call("setChatMenuButton", { menu_button: { type: "web_app", text: "Open", web_app: { url: APP_URL } } }).catch(() => null);
    await call("setMyShortDescription", { short_description: "See who you're buying from: the dev's wallets, the snipers and who paid for them, for any Solana token. Free." }).catch(() => null);
    await call("setMyDescription", {
      description:
        "ZOOAI AGENCY: AI agents that read every launch on pump.fun, Raydium LaunchLab and Meteora straight from Solana.\n\nX-Ray any token: who bought in the first 5 seconds, and who they are\nJudge any token, with the evidence\nCheck a dev's wallet: launches, dumps, how fast\nAlerts when a creator dumps a token you watch\nFresh launches that passed the basic checks\n\nEvery answer is graded by reality the next day, in public. Tap Start.",
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
      await send(a.chat, a.text, [[{ text: "Ask the beaver now", callback_data: `ask:${a.mint}` }]]);
    }
    if (sent) await saveLater();
  };

  void poll();
  const timer = setInterval(() => void restored.then(alerts).then(flush), 10_000);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
