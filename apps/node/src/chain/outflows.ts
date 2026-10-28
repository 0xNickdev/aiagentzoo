/**
 * Where the SOL went after the dump. For a launch's dev and the first-seconds wallets that sold, read the plain SOL
 * transfers out of each wallet in the day after the launch, and add them up by where they landed: an exchange, the
 * wallet that paid the dev, a wallet that launches coins itself, one that funds other devs, or a wallet with no record.
 *
 * Needs Helius (the enhanced transactions API parses native transfers and filters by type). On demand only, a few
 * pages a wallet, cached per token, so a lookup costs what one X-Ray tab costs.
 */

const RPC = process.env.SOLANA_RPC_URL ?? "";
const KEY = /api-key=([^&]+)/.exec(RPC)?.[1] ?? "";
export const outflowsEnabled = () => KEY !== "";

const LAMPORTS = 1_000_000_000;
/** Below this a transfer is rent, a tip or spam, not proceeds moving on. */
const MIN_SOL = 0.1;
/** How long after the launch a transfer out still counts as this launch's money moving on. */
export const WINDOW_MS = 24 * 3_600_000;
const CACHE_MS = 30 * 60_000;

export type OutflowKind = "exchange" | "funder" | "operation" | "dev" | "paymaster" | "kol" | "wallet";

export interface Destination {
  kind: OutflowKind;
  /** The exchange, the KOL's name, or null. */
  label: string | null;
  /** For a wallet that launches coins itself: its kept record. */
  launches?: number;
  dumped?: number;
  /** For a wallet that funds devs: how many the zoo saw it pay. */
  devs?: number;
}

export interface Outflow extends Destination {
  to: string;
  sol: number;
  /** The traced wallets that sent it, the dev first. */
  from: string[];
  /** When the first of these transfers left, ms. */
  firstAt: number;
  /** One hop further, for a wallet with no name: where it sent the most SOL on, and how many devs the zoo knows pay into it. */
  then?: (Destination & { to: string; sol: number }) | null;
  collectsFrom?: number;
  /** An exchange reached through a deposit address: the wallet itself is the user's deposit address. */
  via?: "deposit";
}

export interface OutflowReport {
  mint: string;
  windowHours: number;
  /** Each wallet read: its role, what it sent out in the window, and whether its history reached back to the launch. */
  wallets: Array<{ wallet: string; role: string; outSol: number; reached: boolean }>;
  flows: Outflow[];
  totalSol: number;
  tracedAt: number;
}

interface EnhancedTx {
  signature?: string;
  timestamp?: number;
  type?: string;
  nativeTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; amount?: number }>;
}

/** One page of a wallet's transfers, newest first; `next` carries on when Helius stopped short of a full page. */
async function pageOf(address: string, before: string | undefined, f: typeof fetch): Promise<{ txs: EnhancedTx[]; next?: string } | null> {
  const u = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${KEY}&limit=100&type=TRANSFER${before ? `&before=${before}` : ""}`;
  try {
    const r = await f(u, { signal: AbortSignal.timeout(12_000) });
    const body = (await r.json()) as EnhancedTx[] | { error?: string };
    if (Array.isArray(body)) return { txs: body, next: body[body.length - 1]?.signature };
    // "Failed to find events within the search period. To continue search, query the API again with the `before` parameter set to <sig>."
    const more = /`before` parameter set to ([1-9A-HJ-NP-Za-km-z]{60,90})/.exec(body.error ?? "")?.[1];
    return more ? { txs: [], next: more } : null;
  } catch {
    return null;
  }
}

/** SOL that left `wallet` by plain transfer between `from` and `to` (ms), summed per destination. */
async function sentBy(wallet: string, from: number, to: number, maxPages: number, f: typeof fetch) {
  const out = new Map<string, { sol: number; firstAt: number }>();
  let before: string | undefined;
  let reached = false;
  for (let p = 0; p < maxPages; p++) {
    const page = await pageOf(wallet, before, f);
    if (!page) break;
    for (const tx of page.txs) {
      const at = (tx.timestamp ?? 0) * 1000;
      if (at < from) {
        reached = true;
        break;
      }
      if (at > to) continue;
      for (const t of tx.nativeTransfers ?? []) {
        if (t.fromUserAccount !== wallet || !t.toUserAccount || t.toUserAccount === wallet) continue;
        const sol = (t.amount ?? 0) / LAMPORTS;
        if (sol < MIN_SOL) continue;
        const o = out.get(t.toUserAccount) ?? { sol: 0, firstAt: at };
        o.sol += sol;
        o.firstAt = Math.min(o.firstAt, at);
        out.set(t.toUserAccount, o);
      }
    }
    if (reached || !page.next) {
      reached ||= !page.next;
      break;
    }
    before = page.next;
  }
  return { out, reached };
}

/** Reads one page of a nameless destination: the biggest transfer on after the money arrived, and the known devs paying in. */
async function hop(flow: Outflow, name: (to: string) => Destination, isDev: (w: string) => boolean, f: typeof fetch): Promise<void> {
  const page = await pageOf(flow.to, undefined, f);
  if (!page) return;
  const on = new Map<string, number>();
  const devsIn = new Set<string>();
  for (const tx of page.txs) {
    const at = (tx.timestamp ?? 0) * 1000;
    for (const t of tx.nativeTransfers ?? []) {
      const sol = (t.amount ?? 0) / LAMPORTS;
      if (sol < MIN_SOL) continue;
      if (t.toUserAccount === flow.to && t.fromUserAccount && isDev(t.fromUserAccount)) devsIn.add(t.fromUserAccount);
      if (t.fromUserAccount === flow.to && t.toUserAccount && t.toUserAccount !== flow.to && at >= flow.firstAt) on.set(t.toUserAccount, (on.get(t.toUserAccount) ?? 0) + sol);
    }
  }
  flow.collectsFrom = devsIn.size;
  const [to, sol] = [...on.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!to || sol === undefined) {
    flow.then = null;
    return;
  }
  const next = name(to);
  flow.then = { to, sol: Math.round(sol * 1000) / 1000, ...next };
  // Swept on to an exchange's hot wallet: the first wallet was a deposit address at that exchange.
  if (next.kind === "exchange" && flow.kind === "wallet") Object.assign(flow, { kind: "exchange", label: next.label, via: "deposit" as const });
}

const cache = new Map<string, { at: number; report: OutflowReport }>();

/**
 * Traces where the dev and its selling wallets sent SOL in the day after the launch. `wallets` lists them with their
 * role, the dev first; `name` says what each destination is from what the zoo already knows.
 */
export async function traceOutflows(
  mint: string,
  createdAt: number,
  wallets: Array<{ wallet: string; role: string }>,
  name: (to: string) => Destination,
  isDev: (wallet: string) => boolean = () => false,
  f: typeof fetch = fetch,
  now = Date.now(),
): Promise<OutflowReport | null> {
  if (!outflowsEnabled()) return null;
  const hit = cache.get(mint);
  if (hit && now - hit.at < CACHE_MS) return hit.report;
  const end = Math.min(now, createdAt + WINDOW_MS);
  const sent = await Promise.all(wallets.map((w, i) => sentBy(w.wallet, createdAt, end, i === 0 ? 4 : 2, f)));
  const inside = new Set(wallets.map((w) => w.wallet));
  const byTo = new Map<string, Outflow>();
  sent.forEach(({ out }, i) => {
    for (const [to, o] of out) {
      const flow = byTo.get(to) ?? { to, sol: 0, from: [], firstAt: o.firstAt, ...(inside.has(to) ? { kind: "operation" as const, label: null } : name(to)) };
      flow.sol += o.sol;
      flow.firstAt = Math.min(flow.firstAt, o.firstAt);
      if (!flow.from.includes(wallets[i]!.wallet)) flow.from.push(wallets[i]!.wallet);
      byTo.set(to, flow);
    }
  });
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const flows = [...byTo.values()].map((o) => ({ ...o, sol: round(o.sol) })).sort((a, b) => b.sol - a.sol);
  // The biggest nameless destinations get one hop more: a deposit address, or the operator's own bank.
  await Promise.all(flows.filter((o) => (o.kind === "wallet" || o.kind === "paymaster") && o.sol >= 0.5).slice(0, 3).map((o) => hop(o, name, isDev, f)));
  const report: OutflowReport = {
    mint,
    windowHours: WINDOW_MS / 3_600_000,
    wallets: wallets.map((w, i) => ({ ...w, outSol: round([...sent[i]!.out.values()].reduce((n, o) => n + o.sol, 0)), reached: sent[i]!.reached })),
    // Money moved between the operation's own wallets is not money gone: it stays out of the total.
    flows: flows.slice(0, 40),
    totalSol: round(flows.filter((o) => o.kind !== "operation").reduce((n, o) => n + o.sol, 0)),
    tracedAt: now,
  };
  cache.set(mint, { at: now, report });
  if (cache.size > 1_000) for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k);
  return report;
}
