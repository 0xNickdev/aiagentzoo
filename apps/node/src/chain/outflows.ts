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
/** A second-hop wallet holding at least this much of the money is followed a third time. */
export const HOP_AGAIN_SOL = 1;
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
  /** The cabal this wallet belongs to, when the zoo has linked it to others. */
  cabal?: number;
}

export interface Outflow extends Destination {
  to: string;
  sol: number;
  /** The traced wallets that sent it, the dev first. */
  from: string[];
  /** When the first of these transfers left, ms. */
  firstAt: number;
  /** One hop further, for a wallet with no name: where it sent the most SOL on, and how many devs the zoo knows pay into it. */
  then?: Onward | null;
  collectsFrom?: number;
  /** An exchange reached through a deposit address: the wallet itself is the user's deposit address. */
  via?: "deposit";
}

/** A wallet the SOL went on to; a nameless one with enough in it is followed one hop more (the third from the dev). */
export type Onward = Destination & { to: string; sol: number; collectsFrom?: number; then?: (Destination & { to: string; sol: number }) | null };

/** Below this much SOL out, a trail is mostly a serial dev's float: no summary. */
export const TRAIL_MIN_SOL = 5;

/** Where the money ended up, three hops deep, counted from what the zoo already knows. Transfers, never owners. */
export interface Trail {
  funderBack: boolean;
  /** Distinct wallets that launch coins, with their launches and dumps added up. */
  devs: number;
  launches: number;
  dumped: number;
  kols: string[];
  /** Wallets that pay other devs, and the most devs one of them paid. */
  paymasters: number;
  paidDevs: number;
  cabals: number[];
}

export function trailOf(flows: Outflow[], totalSol: number): Trail | null {
  if (totalSol < TRAIL_MIN_SOL) return null;
  type Reached = Destination & { to: string };
  const all: Reached[] = flows.filter((f) => f.kind !== "operation").flatMap((f) => [f, f.then, f.then?.then].filter((d) => !!d) as Reached[]);
  const uniq = (kind: OutflowKind) => [...new Map(all.filter((d) => d.kind === kind).map((d) => [d.to, d])).values()];
  const devs = uniq("dev");
  const pay = uniq("paymaster");
  const t: Trail = {
    funderBack: uniq("funder").length > 0,
    devs: devs.length,
    launches: devs.reduce((a, d) => a + (d.launches ?? 0), 0),
    dumped: devs.reduce((a, d) => a + (d.dumped ?? 0), 0),
    kols: uniq("kol").map((k) => k.label ?? `${k.to.slice(0, 4)}…${k.to.slice(-4)}`),
    paymasters: pay.length,
    paidDevs: Math.max(0, ...pay.map((d) => d.devs ?? 0)),
    cabals: [...new Set(all.map((d) => d.cabal).filter((c): c is number => c != null))],
  };
  return t.funderBack || t.devs || t.kols.length || t.paymasters || t.cabals.length ? t : null;
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
  /** Where the money ended up, when enough went out and the zoo knows any of it. */
  trail: Trail | null;
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
  // Helius allows about seven enhanced calls a second on this key: wait for a slot, and back off when it says too many.
  for (let attempt = 0; attempt < 4; attempt++) {
    await slot();
    try {
      const r = await f(u, { signal: AbortSignal.timeout(6_000) });
      if (r.status === 429) {
        await new Promise((ok) => setTimeout(ok, 400 * (attempt + 1) + Math.random() * 300));
        continue;
      }
      const body = (await r.json()) as EnhancedTx[] | { error?: string };
      if (!Array.isArray(body)) return null;
      // Helius filters after it reads a page, so a page that is nearly full may still have more behind it.
      return { txs: body, ...(body.length >= 90 ? { next: body[body.length - 1]?.signature } : {}) };
    } catch {
      return null;
    } finally {
      release();
    }
  }
  return null;
}

/** At most a few enhanced calls in flight at once, across every trace. */
const MAX_IN_FLIGHT = 2;
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

/** Reads one page of a wallet after `since`: the biggest transfer on, and the known devs paying in. */
async function onwardOf(wallet: string, since: number, name: (to: string) => Destination, isDev: (w: string) => boolean, f: typeof fetch) {
  const page = await pageOf(wallet, since, since + WINDOW_MS, undefined, f);
  if (!page) return null;
  const on = new Map<string, number>();
  const devsIn = new Set<string>();
  for (const tx of page.txs) {
    const at = (tx.timestamp ?? 0) * 1000;
    for (const t of tx.nativeTransfers ?? []) {
      const sol = (t.amount ?? 0) / LAMPORTS;
      if (sol < MIN_SOL) continue;
      if (t.toUserAccount === wallet && t.fromUserAccount && isDev(t.fromUserAccount)) devsIn.add(t.fromUserAccount);
      if (t.fromUserAccount === wallet && t.toUserAccount && t.toUserAccount !== wallet && at >= since) on.set(t.toUserAccount, (on.get(t.toUserAccount) ?? 0) + sol);
    }
  }
  const [to, sol] = [...on.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return { devsIn: devsIn.size, next: to && sol !== undefined ? { to, sol: Math.round(sol * 1000) / 1000, ...name(to) } : null };
}

/** One hop more from a nameless destination: where it sent the most SOL on. */
async function hop(flow: Outflow, name: (to: string) => Destination, isDev: (w: string) => boolean, f: typeof fetch): Promise<void> {
  const read = await onwardOf(flow.to, flow.firstAt, name, isDev, f);
  if (!read) return;
  flow.collectsFrom = read.devsIn;
  flow.then = read.next;
  // Swept on to an exchange's hot wallet: the first wallet was a deposit address at that exchange.
  if (read.next?.kind === "exchange" && flow.kind === "wallet") Object.assign(flow, { kind: "exchange", label: read.next.label, via: "deposit" as const });
}

/** The third hop from the dev: a nameless wallet that passed the money on is followed once more, where an operator's bank often sits. */
async function hopAgain(flow: Outflow, name: (to: string) => Destination, isDev: (w: string) => boolean, f: typeof fetch): Promise<void> {
  const then = flow.then;
  if (!then) return;
  const read = await onwardOf(then.to, flow.firstAt, name, isDev, f);
  if (!read) return;
  then.collectsFrom = read.devsIn;
  then.then = read.next;
  if (read.next?.kind === "exchange" && then.kind === "wallet") Object.assign(then, { kind: "exchange", label: read.next.label, via: "deposit" as const });
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
  // And the biggest of those that landed on another nameless wallet, once more: at most three more pages.
  await Promise.all(flows.filter((o) => o.then?.kind === "wallet" && o.then.sol >= HOP_AGAIN_SOL).slice(0, 3).map((o) => hopAgain(o, name, isDev, f)));
  const report: OutflowReport = {
    mint,
    windowHours: WINDOW_MS / 3_600_000,
    windowEnd: end,
    botsSkipped: skipped,
    wallets: wallets.map((w, i) => ({ ...w, outSol: round([...sent[i]!.out.values()].reduce((n, o) => n + o.sol, 0)), reached: sent[i]!.reached, read: sent[i]!.read })),
    // Money moved between the operation's own wallets is not money gone: it stays out of the total.
    flows: flows.slice(0, 40),
    totalSol: round(flows.filter((o) => o.kind !== "operation").reduce((n, o) => n + o.sol, 0)),
    trail: null,
    tracedAt: now,
  };
  report.trail = trailOf(report.flows, report.totalSol);
  // The dev's own history unread is a failed trace, not an empty one: the next asker tries again.
  if (sent[0]?.read) cache.set(mint, { at: now, report });
  if (cache.size > 2_000) for (const [k, v] of cache) if (now - v.at > cacheMs(v.report)) cache.delete(k);
  return report;
}
