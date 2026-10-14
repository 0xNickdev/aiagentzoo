import { createHmac, timingSafeEqual } from "node:crypto";
import type { StateStore } from "@aiagentzoo/sdk";
import type { Ask, AskDesk } from "./ask.ts";
import type { CleanLaunch, CreatorRecord, PulseEvent } from "./chain/pump.ts";
import type { BoardRow } from "./stats.ts";

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
  from?: { id: number; first_name?: string };
  text?: string;
  reply_to_message?: { text?: string };
}
interface Update {
  update_id: number;
  message?: Message;
  callback_query?: { id: string; from: { id: number }; data?: string; message?: Message };
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
}

export interface TelegramOptions {
  token: string;
  desk: AskDesk;
  store: StateStore;
  northUrl?: string;
  data?: TelegramData;
  log?: (m: string) => void;
  fetchFn?: typeof fetch;
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

export const WELCOME = [
  "<b>Welcome to ZOOAI AGENCY.</b>",
  "",
  "A zoo of AI agents that watch every pump.fun launch straight from Solana, call out rugs, and get graded by reality the next day. In public.",
  "",
  "<b>What I can do for you:</b>",
  "· Judge any token: rug or not, with the evidence",
  "· Check a dev's wallet: how many tokens it launched, how many it dumped, how fast",
  "· Alert you the moment a creator dumps a token you watch",
  "· Show fresh launches that passed the basic checks",
  "",
  "Open the zoo for the full experience, or paste a token address right here.",
].join("\n");

export const TOUR = [
  [
    "<b>1/3 · The raven reads the chain</b>",
    "",
    "Most bots ask an API what is new. Our raven listens to Solana itself: every pump.fun launch, every buy, every sell.",
    "",
    "So it knows what a chart never shows: the creator already sold their bag, this wallet launched 80 tokens today, five wallets did all the buying.",
  ].join("\n"),
  [
    "<b>2/3 · The beaver judges, reality grades</b>",
    "",
    "Ask about any token and the beaver gives a verdict: suspicious, watch, or promising, with the reason.",
    "",
    "Tomorrow its answer is checked against what the token actually did. Right or wrong, it stays on the record, signed on a public log.",
  ].join("\n"),
  [
    "<b>3/3 · Judges that evolve</b>",
    "",
    "In the nursery eight judges with fixed rules sit the same exam every night. Every three nights the weakest dies and the best two breed a child with one mutation aimed at their mistakes.",
    "",
    "Nobody hand-picks the winner. The leaderboard ranks every agent on one honest scale: calling everything a rug scores 50%, not 100%.",
  ].join("\n"),
];

const HELP = [
  "<b>Commands</b>",
  "",
  "/ask &lt;token&gt; · is it a rug? the beaver judges it",
  "/dev &lt;wallet&gt; · a creator's last 48h: launches, dumps, how fast",
  "/rugs · the latest creator dumps, with transactions",
  "/clean · fresh launches that passed the basic checks",
  `/watch &lt;token&gt; · alert on dumps, graduation, big buys (up to ${WATCH_MAX})`,
  "/unwatch &lt;token&gt; · /list",
  "/live · pump.fun right now: launches and trades a minute",
  "/nursery · the evolving judges",
  "/leaderboard · every agent on one honest scale",
  "/brief · last night's Morning Brief",
  "/token · $ZOOAGENCY",
  "/tour · how the zoo works",
  "",
  "In a private chat just paste an address. Not financial advice.",
].join("\n");

export const COMMANDS = [
  { command: "app", description: "Open the zoo" },
  { command: "ask", description: "Is it a rug? The beaver judges any token" },
  { command: "dev", description: "A creator wallet's launches and dumps" },
  { command: "rugs", description: "Latest creator dumps, with transactions" },
  { command: "clean", description: "Fresh launches that passed the basic checks" },
  { command: "watch", description: "Alert when a token's creator dumps" },
  { command: "unwatch", description: "Stop watching a token" },
  { command: "list", description: "Tokens you watch" },
  { command: "live", description: "pump.fun right now" },
  { command: "nursery", description: "The evolving judges" },
  { command: "leaderboard", description: "Every agent on one honest scale" },
  { command: "brief", description: "Last night's Morning Brief" },
  { command: "token", description: "$ZOOAGENCY" },
  { command: "tour", description: "How the zoo works" },
  { command: "help", description: "All commands" },
];

const MENU: Keyboard = [
  [{ text: "Open the zoo", web_app: { url: APP_URL } }],
  [
    { text: "Ask the beaver", callback_data: "prompt:ask" },
    { text: "Check a dev", callback_data: "prompt:dev" },
  ],
  [
    { text: "Live rugs", callback_data: "rugs" },
    { text: "Clean launches", callback_data: "clean" },
  ],
  [
    { text: "Nursery", callback_data: "nursery" },
    { text: "Leaderboard", callback_data: "leaderboard" },
  ],
  [
    { text: "How it works", callback_data: "tour:0" },
    { text: "Website", url: SITE },
  ],
];

const tourKeyboard = (i: number): Keyboard => [
  [
    ...(i > 0 ? [{ text: "← Back", callback_data: `tour:${i - 1}` }] : []),
    i < TOUR.length - 1 ? { text: "Next →", callback_data: `tour:${i + 1}` } : { text: "Try it: open the zoo", web_app: { url: APP_URL } },
  ],
  [{ text: "Menu", callback_data: "menu" }],
];

/* ---------- formatting ---------- */

function creatorLine(r: CreatorRecord): string {
  return `${r.launches48h} launches in 48h, dumped ${r.dumped}${r.medianDumpMin !== null ? `, median ${r.medianDumpMin} min` : ""}`;
}

/** The answer as a Telegram message: verdict, reason, the telling facts, the link. */
export function askMessage(a: Ask): string {
  const icon = a.verdict === "suspicious" ? "🔴" : a.verdict === "promising" ? "🟢" : "⚪️";
  const lines = [`${icon} <b>$${esc(a.symbol)}</b> · <b>${a.verdict.toUpperCase()}</b> · ${Math.round(a.confidence * 100)}%`, "", esc(a.why), ""];
  const c = a.facts.chain;
  const r = a.facts.creator;
  const m = a.facts.market;
  if (c?.creatorSold !== null && c?.creatorSold !== undefined) lines.push(`• creator sold ${pct(c.creatorSold)}`);
  if (r) lines.push(`• creator: ${creatorLine(r)}`);
  const b = a.facts.bundle;
  if (b && b.wallets >= 2) lines.push(`• bundle: ${b.wallets} wallets took ${pct(b.share)} of supply in the launch block${b.linked >= 2 ? `, ${b.linked} funded by one wallet` : ""}`);
  if (c?.top5Share !== null && c?.top5Share !== undefined) lines.push(`• top 5 buyers: ${pct(c.top5Share)} of the buying`);
  if (m) lines.push(`• liquidity $${Math.round(m.liquidityUsd ?? 0).toLocaleString("en-US")} · buys/sells 24h ${m.buys24h}/${m.sells24h}`);
  if (a.facts.hasSocials === false) lines.push("• no socials");
  lines.push("", a.already ? "<i>Already dead when asked: shown, not scored.</i>" : "<i>Graded against reality in 24h, right or wrong.</i>");
  return lines.join("\n");
}

function askKeyboard(a: Ask): Keyboard {
  return [
    [
      { text: "Watch it", callback_data: `watch:${a.mint}` },
      { text: "Card & record", url: `${SITE}/ask#${a.id}` },
    ],
    [{ text: "Chart", url: a.facts.url ?? `https://dexscreener.com/solana/${a.mint}` }],
  ];
}

export function alertMessage(e: PulseEvent): string {
  const icon = e.kind === "dump" ? "🔴" : e.kind === "graduated" ? "🟢" : "⚪️";
  const tx = e.tx ? ` · <a href="https://solscan.io/tx/${e.tx}">tx</a>` : "";
  return `${icon} <b>$${esc(e.symbol)}</b>: ${esc(e.text)}${tx}\n<code>${e.mint}</code>`;
}

export function devMessage(r: CreatorRecord): string {
  const serial = r.launches48h >= 3 && r.dumped >= Math.ceil(r.launches48h / 2);
  const lines = [
    `<b>Dev ${short(r.wallet)}</b>${serial ? " · 🔴 serial dumper" : ""}`,
    "",
    `<b>${creatorLine(r)}</b>`,
    `${r.launches24h} in the last 24h · ${r.graduated} graduated`,
    "",
  ];
  for (const t of r.recent.slice(0, 8)) {
    lines.push(`${t.dumpedAfterMin !== null ? "🔴" : t.graduated ? "🟢" : "⚪️"} $${esc(t.symbol)} · ${t.dumpedAfterMin !== null ? `dumped after ${t.dumpedAfterMin} min` : t.graduated ? "graduated" : "creator holding"}`);
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
    const caption = name ? WELCOME.replace("Welcome to ZOOAI AGENCY.", `Hi ${esc(name)}, welcome to ZOOAI AGENCY.`) : WELCOME;
    const photo = await call("sendPhoto", { chat_id: chat, photo: WELCOME_IMAGE, caption, parse_mode: "HTML", reply_markup: { inline_keyboard: MENU } }).catch(() => null);
    if (!photo?.ok) await send(chat, caption, MENU);
  };

  const ask = async (chat: number, who: string, mint: string) => {
    await call("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => null);
    const result = await opts.desk.ask(mint, who);
    if (result.ok) return void send(chat, askMessage(result.ask), askKeyboard(result.ask));
    // Not a traded token: perhaps it is a creator's wallet.
    if (result.status === 404) {
      const dev = await north<CreatorRecord>(`/v1/chain/creator/${mint}`);
      if (dev) return void send(chat, devMessage(dev), [[{ text: "Open on the site", url: `${SITE}/ask` }]]);
    }
    return void send(chat, `${esc(result.reason)}`);
  };

  const dev = async (chat: number, wallet: string) => {
    const r = await north<CreatorRecord>(`/v1/chain/creator/${wallet}`);
    if (!r) return void send(chat, "No pump.fun launches from this wallet in the last 48 hours that our stream saw.");
    return void send(chat, devMessage(r));
  };

  const rugs = async (chat: number) => {
    const body = await north<{ moments: PulseEvent[] }>("/v1/chain/moments?kind=dump&limit=8");
    const list = body?.moments ?? [];
    if (!list.length) return void send(chat, "No creator dumps on the record right now.");
    const lines = ["<b>Latest creator dumps on pump.fun</b>", "<i>read straight from Solana, each with its transaction</i>", ""];
    for (const e of list) lines.push(`• <b>$${esc(e.symbol)}</b> · ${esc(e.text)}${e.tx ? ` · <a href="https://solscan.io/tx/${e.tx}">tx</a>` : ""}`);
    return void send(chat, lines.join("\n"), [[{ text: "Refresh", callback_data: "rugs" }, { text: "Watch it live", url: `${SITE}/live` }]]);
  };

  const clean = async (chat: number) => {
    const body = await north<{ launches: CleanLaunch[] }>("/v1/chain/clean?limit=6");
    const list = body?.launches ?? [];
    const lines = [
      "<b>Passed the basic checks</b>",
      "<i>10-180 min old, creator has not sold, not a serial wallet, 25+ buyers, no 5 wallets holding most of it. Not a call, not advice: most still die.</i>",
      "",
    ];
    if (!list.length) lines.push("Nothing passes right now. On pump.fun that is a normal hour.");
    for (const c of list) lines.push(`• <b>$${esc(c.symbol)}</b> · ${c.ageMin} min · ${c.buyers >= 100 ? "100+" : c.buyers} buyers · top 5 ${pct(c.top5Share)}\n<code>${c.mint}</code>`);
    const keyboard: Keyboard = list.slice(0, 6).map((c) => [{ text: `Ask about $${c.symbol}`, callback_data: `ask:${c.mint}` }]);
    keyboard.push([{ text: "Refresh", callback_data: "clean" }]);
    return void send(chat, lines.join("\n"), keyboard);
  };

  const live = async (chat: number) => {
    const [pulse, stats] = await Promise.all([north<{ live: boolean; perMinute: { launches: number; trades: number } }>("/v1/chain/pulse?after=999999999"), data.stats?.().catch(() => null)]);
    const lines = ["<b>pump.fun right now</b>", ""];
    if (pulse) lines.push(`${pulse.live ? "🟢" : "⚪️"} ${pulse.perMinute.launches} launches and ${pulse.perMinute.trades.toLocaleString("en-US")} trades in the last minute`);
    if (stats?.tokensTonight !== undefined) lines.push(`tonight the pack watched ${stats.tokensTonight.toLocaleString("en-US")} tokens and made ${stats.callsTonight ?? 0} calls`);
    return void send(chat, lines.join("\n"), [[{ text: "Open the live map", url: `${SITE}/live` }]]);
  };

  const nursery = async (chat: number) => {
    const evo = await data.evolution?.().catch(() => null);
    if (!evo) return void send(chat, "The nursery is resting. Try again in a minute.");
    const alive = evo.creatures.filter((c) => !c.diedNight).sort((a, b) => (b.lifetimeSkill ?? 0) - (a.lifetimeSkill ?? 0));
    const lines = [`<b>The nursery</b> · turn ${evo.generation} · next in ${evo.nextGenerationInNights} ${evo.nextGenerationInNights === 1 ? "night" : "nights"}`, ""];
    for (const c of alive) lines.push(`• <b>${esc(c.name)}</b>, ${esc(c.temperament)} · ${c.graded ? `${pct(c.lifetimeSkill)} over ${c.graded}` : "no grades yet"}`);
    const last = evo.chronicle.find((e) => e.kind !== "scored");
    if (last) lines.push("", `<i>${esc(last.text)}</i>`);
    return void send(chat, lines.join("\n"), [[{ text: "Open the nursery", url: `${SITE}/evolution` }]]);
  };

  const leaderboard = async (chat: number) => {
    const b = await data.board?.().catch(() => null);
    if (!b) return void send(chat, "The leaderboard is resting. Try again in a minute.");
    const lines = ["<b>Every agent, one honest scale</b>", `<i>balanced accuracy; a rank needs ${b.minGraded} graded calls with dead and living tokens among them</i>`, ""];
    const ranked = b.rows.filter((r) => r.ranked);
    if (!ranked.length) lines.push("Nobody is ranked yet. Living tokens are rare, so it fills slowly. That is the point.", "");
    for (const [i, r] of ranked.slice(0, 8).entries()) lines.push(`${i + 1}. <b>${esc(r.name)}</b> · ${pct(r.score)} · ${r.graded} graded`);
    const next = b.rows.filter((r) => !r.ranked && !r.died && r.graded).slice(0, 5);
    if (next.length) lines.push("<b>On the way:</b>", ...next.map((r) => `• ${esc(r.name)} · ${pct(r.score)} · ${r.graded} graded`));
    return void send(chat, lines.join("\n"), [[{ text: "Full leaderboard", url: `${SITE}/agents#leaderboard` }]]);
  };

  const brief = async (chat: number) => {
    const b = await data.latestBrief?.().catch(() => null);
    if (!b) return void send(chat, "The next Morning Brief comes out at 07:00 UTC.");
    const parts = [
      b.launches !== undefined ? `${b.launches.toLocaleString("en-US")} fresh launches` : null,
      b.graduated !== undefined ? `${b.graduated} graduated` : null,
      b.wentToZero !== undefined ? `${b.wentToZero} went to zero` : null,
    ].filter(Boolean);
    return void send(chat, [`<b>Morning Brief · night of ${b.night}</b>`, "", parts.join(" · "), "", "<i>Written by the tortoise, no human in the loop, signed on the public log.</i>"].join("\n"), [
      [{ text: "Read the brief", url: `${SITE}/brief` }],
    ]);
  };

  const token = (chat: number) =>
    send(
      chat,
      ["<b>$ZOOAGENCY</b>", "", "Launched through ClawPump, graduated to PumpSwap.", "Holders who sign in on the site with a wallet holding 1,000,000+ ask the beaver 30 times an hour and watch 10 tokens.", "", `<code>${TOKEN_CA}</code>`].join("\n"),
      [[{ text: "Chart", url: `https://dexscreener.com/solana/${TOKEN_CA}` }, { text: "Website", url: SITE }]],
    );

  const watch = async (chat: number, mint: string, on: boolean) => {
    const res = await setWatch(opts.store, chat, mint, on);
    if (!res.ok) return void send(chat, `${res.reason} /list shows them.`);
    return void send(
      chat,
      on ? `Watching <code>${mint}</code>.\nYou will hear the moment its creator dumps, it graduates, or someone buys big.` : `Stopped watching <code>${mint}</code>.`,
      on ? [[{ text: "Stop watching", callback_data: `unwatch:${mint}` }]] : undefined,
    );
  };

  const list = async (chat: number) => {
    const mine = Object.entries(await watchers()).filter(([, chats]) => chats.includes(chat)).map(([m]) => m);
    if (!mine.length) return void send(chat, "Nothing under watch yet. Send /watch with a token address.");
    return void send(chat, ["<b>Under watch</b>", "", ...mine.map((m) => `<code>${m}</code>`)].join("\n"), mine.map((m) => [{ text: `Stop ${short(m)}`, callback_data: `unwatch:${m}` }]));
  };

  const prompt = (chat: number, what: "ask" | "dev") =>
    send(chat, what === "ask" ? "Send me a token address or a pump.fun link." : "Send me the creator's wallet address.", undefined, {
      reply_markup: { force_reply: true, input_field_placeholder: what === "ask" ? "token address or link" : "wallet address" },
    });

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
    if (!cmd && msg.reply_to_message?.text?.includes("creator's wallet") && address) return dev(chat, address);

    switch (cmd) {
      case "/start":
        return welcome(chat, msg.from?.first_name);
      case "/app":
        return void send(chat, "The zoo in liquid glass: ask the beaver, live rugs, clean launches, the nursery.", [[{ text: "Open the zoo", web_app: { url: APP_URL } }]]);
      case "/menu":
        return void send(chat, "What next?", MENU);
      case "/help":
        return void send(chat, HELP, MENU);
      case "/tour":
        return void send(chat, TOUR[0]!, tourKeyboard(0));
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
      default:
        // In a private chat, a pasted address is a question.
        if (isPrivate && address) return ask(chat, who, address);
        if (isPrivate) return void send(chat, "Paste a token address or a pump.fun link, or pick from the menu.", MENU);
    }
  };

  const onButton = async (q: NonNullable<Update["callback_query"]>) => {
    await call("answerCallbackQuery", { callback_query_id: q.id }).catch(() => null);
    const chat = q.message?.chat.id;
    const data = q.data ?? "";
    if (!chat) return;
    const [kind, value = ""] = data.split(":");
    switch (kind) {
      case "menu":
        return void send(chat, "What next?", MENU);
      case "tour": {
        const i = Math.max(0, Math.min(TOUR.length - 1, Number(value) || 0));
        // Turn the page in place when the tour is already on screen.
        const edited = q.message?.text?.includes("/3 ·")
          ? await call("editMessageText", { chat_id: chat, message_id: q.message.message_id, text: TOUR[i], parse_mode: "HTML", reply_markup: { inline_keyboard: tourKeyboard(i) } }).catch(() => null)
          : null;
        if (!edited?.ok) await send(chat, TOUR[i]!, tourKeyboard(i));
        return;
      }
      case "prompt":
        return prompt(chat, value === "dev" ? "dev" : "ask");
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
    await call("setChatMenuButton", { menu_button: { type: "web_app", text: "Open", web_app: { url: APP_URL } } }).catch(() => null);
    await call("setMyShortDescription", { short_description: "Is it a rug? AI agents read pump.fun straight from Solana and get graded by reality the next day." }).catch(() => null);
    await call("setMyDescription", {
      description:
        "ZOOAI AGENCY: AI agents that read every pump.fun launch straight from Solana.\n\nJudge any token, with the evidence\nCheck a dev's wallet: launches, dumps, how fast\nAlerts when a creator dumps a token you watch\nFresh launches that passed the basic checks\n\nEvery answer is graded by reality the next day, in public. Tap Start.",
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
          const job = u.message ? onMessage(u.message) : u.callback_query ? onButton(u.callback_query) : null;
          await job?.catch((e) => log(`[telegram] ${(e as Error).message}`));
        }
        if (!r.ok) await new Promise((res) => setTimeout(res, 5_000));
      } catch {
        await new Promise((res) => setTimeout(res, 5_000));
      }
    }
  };

  // Alerts: follow north's pulse and tell every chat that watches the token.
  let cursor = -1;
  const alerts = async () => {
    if (stopped || !opts.northUrl) return;
    const body = await north<{ events: PulseEvent[] }>(`/v1/chain/pulse?after=${Math.max(0, cursor)}`);
    if (!body) return;
    const first = cursor < 0;
    if (body.events.length) cursor = body.events[body.events.length - 1]!.seq;
    else if (first) cursor = 0;
    if (first) return;
    const all = await watchers();
    for (const e of body.events) {
      if (e.kind === "launch") continue;
      for (const chat of all[e.mint] ?? []) await send(chat, alertMessage(e), [[{ text: "Ask the beaver now", callback_data: `ask:${e.mint}` }]]);
    }
  };

  void poll();
  const timer = setInterval(() => void alerts(), 10_000);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
