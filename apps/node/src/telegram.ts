import type { StateStore } from "@aiagentzoo/sdk";
import type { Ask, AskDesk } from "./ask.ts";
import type { PulseEvent } from "./chain/pump.ts";

/**
 * The beaver in Telegram. /ask <token> in any chat answers there, with the evidence and a link to the card;
 * /watch <token> sends an alert the moment the chain shows its creator dumping, its graduation, or a big buy.
 * Long polling, no webhook, so it runs anywhere the node runs. Starts only with TELEGRAM_BOT_TOKEN set.
 */

const API = "https://api.telegram.org";
const MINT = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
const WATCH_MAX = 5;
const SITE = "https://zooaiagency.com";

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${Math.round(x * 100)}%`);

interface Update {
  update_id: number;
  message?: { chat: { id: number; type: string }; from?: { id: number }; text?: string };
}

export interface TelegramOptions {
  token: string;
  desk: AskDesk;
  store: StateStore;
  northUrl?: string;
  log?: (m: string) => void;
  fetchFn?: typeof fetch;
}

/** The answer as a Telegram message: verdict, reason, the telling facts, the link. */
export function askMessage(a: Ask): string {
  const label = a.verdict.toUpperCase();
  const icon = a.verdict === "suspicious" ? "🔴" : a.verdict === "promising" ? "🟢" : "⚪️";
  const lines = [`${icon} <b>$${esc(a.symbol)}</b> · <b>${label}</b> · ${Math.round(a.confidence * 100)}%`, "", esc(a.why), ""];
  const c = a.facts.chain;
  const r = a.facts.creator;
  const m = a.facts.market;
  if (c?.creatorSold !== null && c?.creatorSold !== undefined) lines.push(`• creator sold ${pct(c.creatorSold)}`);
  if (r) lines.push(`• creator: ${r.launches48h} launches in 48h, dumped ${r.dumped}${r.medianDumpMin !== null ? `, median ${r.medianDumpMin} min` : ""}`);
  if (c?.top5Share !== null && c?.top5Share !== undefined) lines.push(`• top 5 buyers: ${pct(c.top5Share)} of the buying`);
  if (m) lines.push(`• liquidity $${Math.round(m.liquidityUsd ?? 0).toLocaleString("en-US")} · buys/sells 24h ${m.buys24h}/${m.sells24h}`);
  if (a.facts.hasSocials === false) lines.push("• no socials");
  lines.push("", a.already ? "Already dead when asked: shown, not scored." : "Graded against reality in 24h, right or wrong.");
  lines.push(`<a href="${SITE}/ask#${a.id}">card and record</a> · not financial advice`);
  return lines.join("\n");
}

export function alertMessage(e: PulseEvent): string {
  const icon = e.kind === "dump" ? "🚨" : e.kind === "graduated" ? "🎓" : e.kind === "whale" ? "🐋" : "⚠️";
  const tx = e.tx ? ` · <a href="https://solscan.io/tx/${e.tx}">tx</a>` : "";
  return `${icon} <b>$${esc(e.symbol)}</b>: ${esc(e.text)}${tx}\n<code>${e.mint}</code>`;
}

const HELP = [
  "🦫 <b>The beaver from ZOOAI AGENCY</b>",
  "",
  "/ask &lt;token or pump.fun link&gt; - is it a rug? The beaver judges it from the market and the chain, and is graded against reality tomorrow.",
  `/watch &lt;token&gt; - an alert when its creator dumps, it graduates, or someone buys big (up to ${WATCH_MAX}).`,
  "/unwatch &lt;token&gt; · /list",
  "",
  `Every answer is signed on a public log: ${SITE}`,
].join("\n");

export function startTelegram(opts: TelegramOptions): () => void {
  const f = opts.fetchFn ?? fetch;
  const log = opts.log ?? console.log;
  const call = async (method: string, body: unknown) => {
    const r = await f(`${API}/bot${opts.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(40_000) });
    return (await r.json()) as { ok: boolean; result?: unknown; description?: string };
  };
  const send = (chat: number, text: string) => call("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }).catch(() => null);

  let stopped = false;
  let offset = 0;
  let botName = "";

  const watchers = async () => (await opts.store.get<Record<string, number[]>>("tg:watchers")) ?? {};

  const handle = async (u: Update) => {
    const msg = u.message;
    const text = msg?.text?.trim();
    if (!msg || !text) return;
    const chat = msg.chat.id;
    const [head = "", ...rest] = text.split(/\s+/);
    const cmd = head.toLowerCase().replace(`@${botName.toLowerCase()}`, "");
    const arg = rest.join(" ");
    const mint = (arg || (msg.chat.type === "private" ? text : "")).match(MINT)?.[0];

    if (cmd === "/start" || cmd === "/help") return void send(chat, HELP);

    if (cmd === "/ask" || (msg.chat.type === "private" && !cmd.startsWith("/") && mint)) {
      if (!mint) return void send(chat, "Send /ask with a token address or a pump.fun link.");
      const result = await opts.desk.ask(mint, `tg:${msg.from?.id ?? chat}`);
      return void send(chat, result.ok ? askMessage(result.ask) : `🦫 ${esc(result.reason)}`);
    }

    if (cmd === "/watch" || cmd === "/unwatch") {
      if (!mint) return void send(chat, `Send ${cmd} with a token address.`);
      const all = await watchers();
      const list = new Set(all[mint] ?? []);
      const mine = Object.entries(all).filter(([, chats]) => chats.includes(chat)).length;
      if (cmd === "/watch") {
        if (!list.has(chat) && mine >= WATCH_MAX) return void send(chat, `Up to ${WATCH_MAX} tokens per chat. /unwatch one first.`);
        list.add(chat);
      } else list.delete(chat);
      if (list.size) all[mint] = [...list];
      else delete all[mint];
      await opts.store.set("tg:watchers", all);
      return void send(chat, cmd === "/watch" ? `👀 Watching <code>${mint}</code>. You will hear when its creator dumps, it graduates, or someone buys big.` : "Stopped watching.");
    }

    if (cmd === "/list") {
      const mine = Object.entries(await watchers()).filter(([, chats]) => chats.includes(chat)).map(([m]) => `<code>${m}</code>`);
      return void send(chat, mine.length ? `Watching:\n${mine.join("\n")}` : "Nothing under watch. /watch &lt;token&gt;");
    }
  };

  const poll = async () => {
    const me = await call("getMe", {}).catch(() => null);
    botName = (me?.result as { username?: string } | undefined)?.username ?? "";
    log(`[telegram] bot @${botName || "?"} listening`);
    while (!stopped) {
      try {
        const r = await call("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
        for (const u of (r.result as Update[] | undefined) ?? []) {
          offset = u.update_id + 1;
          await handle(u).catch((e) => log(`[telegram] ${(e as Error).message}`));
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
    try {
      const r = await f(`${opts.northUrl}/v1/chain/pulse?after=${Math.max(0, cursor)}`, { signal: AbortSignal.timeout(8_000) });
      const body = (await r.json()) as { events: PulseEvent[] };
      const first = cursor < 0;
      if (body.events.length) cursor = body.events[body.events.length - 1]!.seq;
      else if (first) cursor = 0;
      if (first) return;
      const all = await watchers();
      for (const e of body.events) {
        if (e.kind === "launch") continue;
        for (const chat of all[e.mint] ?? []) await send(chat, alertMessage(e));
      }
    } catch {
      /* the next tick tries again */
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
