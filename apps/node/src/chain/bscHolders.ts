import type { HolderReport } from "./holders.ts";
import { DEFAULT_RPC, jsonRpc, TOKEN_MANAGER2, type Rpc } from "./bsc.ts";

/**
 * Who holds a four.meme token right now. BNB Chain has no "largest accounts" call, so the zoo starts from what it saw:
 * every wallet that bought on the curve, with what it still had after its own sells (the position book). Those
 * wallets, the creator and the curve contract are then asked for their balance on chain in one batch, so a bag moved
 * by plain transfer shows up as the creator holding nothing. Wallets that only ever received a transfer are not seen.
 */

const CACHE_MS = 5 * 60_000;
/** How many of the book's biggest positions are verified on chain per read. */
const VERIFY = 40;
const BALANCE_OF = "0x70a08231";
const TOTAL_SUPPLY = "0x18160ddd";
const WEI = 1e18;

const cache = new Map<string, { at: number; report: HolderReport | null }>();

/** What each wallet bought minus what it sold back, per token, from the trades the feed saw. */
export class PositionBook {
  private readonly tokens = new Map<string, { at: number; wallets: Map<string, number> }>();

  note(token: string, wallet: string, tokens: number, isBuy: boolean, now = Date.now()): void {
    let t = this.tokens.get(token);
    if (!t) {
      t = { at: now, wallets: new Map() };
      this.tokens.set(token, t);
    }
    t.at = now;
    t.wallets.set(wallet, (t.wallets.get(wallet) ?? 0) + (isBuy ? tokens : -tokens));
  }

  /** The wallets with the biggest positions, most first; empty when the feed never saw the token trade. */
  top(token: string, n = VERIFY): string[] {
    const t = this.tokens.get(token);
    if (!t) return [];
    return [...t.wallets.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([w]) => w);
  }

  /** A plain transfer between wallets: the sender's position falls, the receiver's grows. Curve and pool legs are not plain. */
  move(token: string, from: string, to: string, tokens: number, now = Date.now()): void {
    this.note(token, from, tokens, false, now);
    this.note(token, to, tokens, true, now);
  }

  has(token: string): boolean {
    return this.tokens.has(token);
  }

  size(): number {
    return this.tokens.size;
  }

  /** Tokens not traded for two days are let go, with the tape. */
  prune(now = Date.now(), keepMs = 48 * 3_600_000): void {
    for (const [k, t] of this.tokens) if (now - t.at > keepMs) this.tokens.delete(k);
  }
}

const pad = (address: string) => address.slice(2).toLowerCase().padStart(64, "0");
const toNumber = (hex: string | undefined | null) => (hex && /^0x[0-9a-fA-F]*$/.test(hex) && hex.length > 2 ? Number(BigInt(hex)) / WEI : 0);

/** One batch of eth_call: each entry's result, null where the node answered with an error. */
export async function batchCall(calls: Array<{ to: string; data: string }>, rpc: Rpc = jsonRpc, url = DEFAULT_RPC): Promise<Array<string | null>> {
  if (!calls.length) return [];
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, method: "eth_call", params: [c, "latest"] }))),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`eth_call batch: ${r.status}`);
  const body = (await r.json()) as Array<{ id: number; result?: string; error?: unknown }>;
  if (!Array.isArray(body)) throw new Error("eth_call batch: not a batch answer");
  const byId = new Map(body.map((x) => [x.id, x.error ? null : (x.result ?? null)]));
  void rpc;
  return calls.map((_, i) => byId.get(i + 1) ?? null);
}

export async function bscHolderReport(
  token: string,
  creator: string | null,
  candidates: string[],
  opts: { now?: number; url?: string; call?: typeof batchCall } = {},
): Promise<HolderReport | null> {
  const now = opts.now ?? Date.now();
  const hit = cache.get(token);
  if (hit && now - hit.at < CACHE_MS) return hit.report;
  const call = opts.call ?? batchCall;
  const wallets = [...new Set([...(creator ? [creator.toLowerCase()] : []), ...candidates.map((w) => w.toLowerCase())])].filter((w) => w !== TOKEN_MANAGER2);
  const calls = [
    { to: token, data: TOTAL_SUPPLY },
    { to: token, data: `${BALANCE_OF}${pad(TOKEN_MANAGER2)}` },
    ...wallets.map((w) => ({ to: token, data: `${BALANCE_OF}${pad(w)}` })),
  ];
  let answers: Array<string | null>;
  try {
    answers = await call(calls, jsonRpc, opts.url ?? DEFAULT_RPC);
  } catch {
    return null;
  }
  const total = toNumber(answers[0]);
  if (!total) {
    cache.set(token, { at: now, report: null });
    return null;
  }
  const program = toNumber(answers[1]);
  const held = wallets.map((w, i) => [w, toNumber(answers[i + 2])] as const).filter(([, v]) => v > 0);
  const ranked = held.map(([, v]) => v).sort((a, b) => b - a);
  const creatorShare = creator ? (held.find(([w]) => w === creator.toLowerCase())?.[1] ?? 0) / total : null;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const report: HolderReport = {
    top10Share: round(ranked.slice(0, 10).reduce((a, b) => a + b, 0) / total),
    topShare: round((ranked[0] ?? 0) / total),
    programShare: round(program / total),
    creator: creator ? creator.toLowerCase() : null,
    creatorShare: creatorShare === null ? null : round(creatorShare),
  };
  cache.set(token, { at: now, report });
  if (cache.size > 5_000) for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k);
  return report;
}

/** The one book per node process, written by the feed, read by the holders report. */
export const bscBook = new PositionBook();
