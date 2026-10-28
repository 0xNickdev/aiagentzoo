/**
 * Where the SOL went after the dump. For a launch's dev and the first-seconds wallets that sold, read the plain SOL
 * transfers out of each wallet in the day after the launch, and add them up by where they landed: an exchange, the
 * wallet that paid the dev, a wallet that launches coins itself, one that funds other devs, or a wallet with no record.
 *
 * Needs Helius (the enhanced transactions API parses native transfers and filters by type and time, so it reads only
 * the day after the launch however busy the wallet). On demand, cached per token, one trace at a time per token.
 */

const RPC = process.env.SOLANA_RPC_URL ?? "";
const KEY = /api-key=([^&]+)/.exec(RPC)?.[1] ?? "";
export const outflowsEnabled = () => KEY !== "";

const LAMPORTS = 1_000_000_000;
/** Below this a transfer is rent, a tip or spam, not proceeds moving on. */
const MIN_SOL = 0.1;
/** How long after the launch a transfer out still counts as this launch's money moving on. */
export const WINDOW_MS = 24 * 3_600_000;
/** While the day after the launch still runs, a trace goes stale quickly. */
const CACHE_MS = 10 * 60_000;

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
  /** Where the window closes, ms: the launch plus a day, or the moment of the trace while the day is still running. */
  windowEnd: number;
  /** First-seconds wallets left out as bots: they trade nonstop, and what they send on is their float, not this launch. */
  botsSkipped: number;
  /** Each wallet read: its role, what it sent out in the window, and whether its history reached back to the launch. */
  /** `reached`: the whole window was read; `read`: at least its start was (false is a failed read). */
  wallets: Array<{ wallet: string; role: string; outSol: number; reached: boolean; read: boolean }>;
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

/**
 * One page of a wallet's plain transfers inside a time window, oldest first: Helius jumps straight to the window, so a
 * busy wallet costs no more than a quiet one. Null when the call failed or Helius gave up searching (a bot whose
 * history is all swaps); `next` carries on past a full page.
 */
async function pageOf(address: string, from: number, to: number, after: string | undefined, f: typeof fetch): Promise<{ txs: EnhancedTx[]; next?: string } | null> {
  const u = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${KEY}&limit=100&type=TRANSFER&sort-order=asc&gte-time=${Math.floor(from / 1000)}&lte-time=${Math.ceil(to / 1000)}${after ? `&after-signature=${after}` : ""}`;
  // Helius allows a few enhanced calls a second: wait for a slot, and back off when it says too many.
  for (let attempt = 0; attempt < 3; attempt++) {
    await slot();
    try {
      const r = await f(u, { signal: AbortSignal.timeout(6_000) });
      if (r.status === 429) {
        await new Promise((ok) => setTimeout(ok, 600 * (attempt + 1)));
        continue;
      }
      const body = (await r.json()) as EnhancedTx[] | { error?: string };
      if (!Array.isArray(body)) return null;
      return { txs: body, ...(body.length >= 100 ? { next: body[body.length - 1]?.signature } : {}) };
    } catch {
      return null;
    } finally {
      release();
    }
  }
  return null;
}

/** At most a few enhanced calls in flight at once, across every trace. */
const MAX_IN_FLIGHT = 3;
let inFlight = 0;
const waiting: Array<() => void> = [];
const slot = () => (inFlight < MAX_IN_FLIGHT ? (inFlight++, Promise.resolve()) : new Promise<void>((ok) => waiting.push(() => (inFlight++, ok()))));
const release = () => {
  inFlight--;
  waiting.shift()?.();
};

/** SOL that left `wallet` by plain transfer between `from` and `to` (ms), summed per destination. */
async function sentBy(wallet: string, from: number, to: number, maxPages: number, f: typeof fetch) {
  const out = new Map<string, { sol: number; firstAt: number }>();
  let after: string | undefined;
  let reached = false;
  let read = false;
  for (let p = 0; p < maxPages; p++) {
    const page = await pageOf(wallet, from, to, after, f);
    if (!page) break;
    read = true;
    for (const tx of page.txs) {
      const at = (tx.timestamp ?? 0) * 1000;
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
    if (!page.next) {
      reached = true;
      break;
    }
    after = page.next;
  }
  return { out, reached, read };
}

/** Reads one page of a nameless destination: the biggest transfer on after the money arrived, and the known devs paying in. */
async function hop(flow: Outflow, name: (to: string) => Destination, isDev: (w: string) => boolean, f: typeof fetch): Promise<void> {
  const page = await pageOf(flow.to, flow.firstAt, flow.firstAt + WINDOW_MS, undefined, f);
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
const running = new Map<string, Promise<OutflowReport | null>>();

/** The trace already done for a token, or null. */
export const cachedOutflows = (mint: string, now = Date.now()) => {
  const hit = cache.get(mint);
  return hit && now - hit.at < cacheMs(hit.report) ? hit.report : null;
};
/** Once the day after the launch is over nothing new can enter the window: the trace keeps for hours, not minutes. */
const cacheMs = (r: OutflowReport) => (r.windowEnd < r.tracedAt ? 12 * 3_600_000 : CACHE_MS);

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
  skipped = 0,
): Promise<OutflowReport | null> {
  if (!outflowsEnabled()) return null;
  const hit = cachedOutflows(mint, now);
  if (hit) return hit;
  // Two people opening the same map at once share one trace.
  const busy = running.get(mint);
  if (busy) return busy;
  const job = trace(mint, createdAt, wallets, name, isDev, f, now, skipped).finally(() => running.delete(mint));
  running.set(mint, job);
  return job;
}

async function trace(
  mint: string,
  createdAt: number,
  wallets: Array<{ wallet: string; role: string }>,
  name: (to: string) => Destination,
  isDev: (wallet: string) => boolean,
  f: typeof fetch,
  now: number,
  skipped: number,
): Promise<OutflowReport> {
  const end = Math.min(now, createdAt + WINDOW_MS);
  const sent = await Promise.all(wallets.map((w, i) => sentBy(w.wallet, createdAt, end, i === 0 ? 5 : 2, f)));
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
    windowEnd: end,
    botsSkipped: skipped,
    wallets: wallets.map((w, i) => ({ ...w, outSol: round([...sent[i]!.out.values()].reduce((n, o) => n + o.sol, 0)), reached: sent[i]!.reached, read: sent[i]!.read })),
    // Money moved between the operation's own wallets is not money gone: it stays out of the total.
    flows: flows.slice(0, 40),
    totalSol: round(flows.filter((o) => o.kind !== "operation").reduce((n, o) => n + o.sol, 0)),
    tracedAt: now,
  };
  // The dev's own history unread is a failed trace, not an empty one: the next asker tries again.
  if (sent[0]?.read) cache.set(mint, { at: now, report });
  if (cache.size > 2_000) for (const [k, v] of cache) if (now - v.at > cacheMs(v.report)) cache.delete(k);
  return report;
}
