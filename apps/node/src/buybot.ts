import type { StateStore } from "@aiagentzoo/sdk";
import type { FollowedSwap } from "./chain/pump.ts";
import { balanceOf, TOKEN_MINT } from "./holders.ts";

/**
 * The buy bot in the holders' group: every buy of $ZOOAGENCY above a floor, posted by the zoo's own Telegram bot.
 * North follows the token's pool on the stream; this reads its trades, asks the chain what the buyer holds now
 * and posts one message per buy. No ads, no trending, no buttons for others.
 */

const API = "https://api.telegram.org";
const SITE = "https://zooaiagency.com";
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
/** At most this many buys posted one by one per round; the rest are summed in one line. */
const PER_ROUND = 6;

export interface BuyBotOptions {
  token: string;
  chat: number;
  /** A forum topic to post in, if the group has one for buys. */
  thread?: number;
  northUrl: string;
  store: StateStore;
  /** The smallest buy posted, in SOL. */
  minSol?: number;
  /** A picture over every post; plain text without it. */
  image?: string;
  symbol?: string;
  mint?: string;
  log?: (m: string) => void;
  fetchFn?: typeof fetch;
}

export interface BuyFacts {
  swap: FollowedSwap;
  symbol: string;
  mint: string;
  /** Whole tokens the buyer holds after the buy, when the chain answered. */
  balance: number | null;
  solUsd: number | null;
  supply: number | null;
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** 6140000 -> 6.14M, 16900 -> 16.9K. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  const [d, u] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  const v = n / d;
  return `${v >= 100 || u === "" ? Math.round(v) : Number(v.toFixed(v >= 10 ? 1 : 2))}${u}`;
}

const usd = (n: number) => (n >= 1000 ? `$${compact(n)}` : `$${n.toFixed(2)}`);

/** New holder, or how much the buyer holds now. */
export function holderLine(tokens: number, balance: number | null, supply: number | null): string | null {
  if (balance === null || balance < tokens * 0.98) return null; // the chain has not caught up with the buy yet
  if (balance <= tokens * 1.02) return "new holder";
  const share = supply ? ` (${((balance / supply) * 100).toFixed(balance / supply >= 0.01 ? 1 : 2)}%)` : "";
  return `holds ${compact(balance)}${share}, +${Math.round((tokens / (balance - tokens)) * 100)}%`;
}

/** A row of bills as long as the buy: one per 0.1 SOL, at most 40. */
export function bills(sol: number): string {
  return "💵".repeat(Math.max(1, Math.min(40, Math.round(sol * 10))));
}

/** 0.0000180583 -> $0.0000180583: six significant digits, never in exponent form. */
const priceUsd = (n: number) => `$${n.toFixed(Math.max(2, 5 - Math.floor(Math.log10(n))))}`;

export function buyMessage(f: BuyFacts): string {
  const s = f.swap;
  const price = s.tokens > 0 ? s.sol / s.tokens : 0;
  const cap = f.supply && f.solUsd ? price * f.supply * f.solUsd : null;
  const holder = holderLine(s.tokens, f.balance, f.supply);
  const wallet = `<a href="${SITE}/xray?wallet=${s.user}">${short(s.user)}</a>`;
  return [
    `<b>$${esc(f.symbol)} Buy!</b>`,
    bills(s.sol),
    "",
    `💲 <b>${s.sol.toFixed(s.sol >= 10 ? 1 : 2)} SOL</b>${f.solUsd ? ` (${usd(s.sol * f.solUsd)})` : ""}`,
    `🪙 ${compact(s.tokens)} ${esc(f.symbol)}`,
    `👀 ${wallet}${s.tx ? ` | <a href="https://solscan.io/tx/${s.tx}">Txn</a>` : ""}`,
    ...(holder ? [holder === "new holder" ? "🆕 New holder!" : `👜 ${holder[0]!.toUpperCase()}${holder.slice(1)}`] : []),
    ...(f.solUsd && price ? [`📊 Price ${priceUsd(price * f.solUsd)}`] : []),
    ...(cap ? [`📈 Market Cap ${usd(cap)}`] : []),
  ].join("\n");
}

export function startBuyBot(opts: BuyBotOptions): () => void {
  const f = opts.fetchFn ?? fetch;
  const log = opts.log ?? console.log;
  const mint = opts.mint ?? TOKEN_MINT;
  const symbol = opts.symbol ?? "ZOOAGENCY";
  const minSol = opts.minSol ?? 1;
  const keyboard = [[{ text: `Buy $${symbol}`, url: `https://jup.ag/swap/SOL-${mint}` }, { text: "Chart", url: `https://dexscreener.com/solana/${mint}` }]];

  const tg = async (method: string, body: Record<string, unknown>) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await f(`${API}/bot${opts.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      const out = (await r.json()) as { ok: boolean; description?: string; parameters?: { retry_after?: number } };
      if (out.ok) return out;
      // Telegram asks for a pause when a group gets many posts at once.
      const wait = out.parameters?.retry_after;
      if (!wait) throw new Error(out.description ?? `telegram ${method} failed`);
      await new Promise((res) => setTimeout(res, (wait + 1) * 1000));
    }
    throw new Error(`telegram ${method}: still limited`);
  };
  const post = async (text: string) => {
    const base = { chat_id: opts.chat, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard }, ...(opts.thread ? { message_thread_id: opts.thread } : {}) };
    if (opts.image) {
      try {
        return await tg("sendPhoto", { ...base, photo: opts.image, caption: text });
      } catch (error) {
        log(`[buybot] picture failed, posting text: ${(error as Error).message}`);
      }
    }
    return tg("sendMessage", { ...base, text, link_preview_options: { is_disabled: true } });
  };

  // SOL in dollars and the token's supply (burns shrink it), both kept a while.
  let sol = { at: 0, usd: null as number | null };
  const solUsd = async () => {
    if (Date.now() - sol.at < 60_000) return sol.usd;
    try {
      const r = await f("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT", { signal: AbortSignal.timeout(5_000) });
      const v = Number(((await r.json()) as { price?: string }).price);
      sol = { at: Date.now(), usd: Number.isFinite(v) && v > 0 ? v : sol.usd };
    } catch {
      sol = { ...sol, at: Date.now() - 30_000 };
    }
    return sol.usd;
  };
  let supplyAt = 0;
  let supplyNow: number | null = null;
  const supply = async () => {
    if (Date.now() - supplyAt < 10 * 60_000) return supplyNow;
    supplyAt = Date.now();
    try {
      const r = await f(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint] }), signal: AbortSignal.timeout(8_000) });
      const v = ((await r.json()) as { result?: { value?: { uiAmount?: number } } }).result?.value?.uiAmount;
      if (v) supplyNow = v;
    } catch {
      /* keep the last one */
    }
    return supplyNow;
  };

  let stopped = false;
  let busy = false;
  let cursor: number | null = null;
  const round = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      if (cursor === null) cursor = (await opts.store.get<number>("buybot:after")) ?? -1;
      const r = await f(`${opts.northUrl}/v1/chain/swaps/${mint}?after=${Math.max(0, cursor)}`, { signal: AbortSignal.timeout(8_000) });
      if (!r.ok) return;
      const body = (await r.json()) as { swaps: FollowedSwap[] };
      if (!body.swaps.length) return;
      const first = cursor < 0;
      cursor = body.swaps[body.swaps.length - 1]!.seq;
      await opts.store.set("buybot:after", cursor);
      // A first start posts nothing old: it only marks where it begins.
      if (first) return;
      const buys = body.swaps.filter((s) => s.isBuy && s.sol >= minSol);
      const [usdNow, supplyNow] = await Promise.all([solUsd(), supply()]);
      for (const swap of buys.slice(0, PER_ROUND)) {
        const balance = await balanceOf(swap.user, f, Date.now(), true);
        const text = buyMessage({ swap, symbol, mint, balance, solUsd: usdNow, supply: supplyNow });
        await post(text).catch((e) => log(`[buybot] post failed: ${(e as Error).message}`));
      }
      const rest = buys.slice(PER_ROUND);
      if (rest.length) {
        const total = rest.reduce((n, s) => n + s.sol, 0);
        await post(`<b>+${rest.length} more buys</b>, ${total.toFixed(2)} SOL in all`).catch(() => null);
      }
    } catch (error) {
      log(`[buybot] ${(error as Error).message?.slice(0, 200)}`);
    } finally {
      busy = false;
    }
  };
  log(`[buybot] posting buys of $${symbol} from ${minSol} SOL to chat ${opts.chat}${opts.thread ? ` topic ${opts.thread}` : ""}`);
  const timer = setInterval(() => void round(), 8_000);
  timer.unref?.();
  void round();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
