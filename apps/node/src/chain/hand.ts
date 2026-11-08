/**
 * One hand in many wallets. A bundle tool can spread one buyer's money over a dozen fresh wallets and space their buys
 * out over minutes, so no block holds four of them and none is in the first five seconds: the tape sees a crowd. Their
 * money still came from somewhere. For the biggest buyers we follow the SOL back, wallet to wallet, up to four hops,
 * and stop at an exchange (its customers are strangers to each other). Wallets that share any wallet up that chain
 * were paid by one owner.
 */
import { exchangeOf, launcherOf } from "./exchanges.ts";
import { fundersEnabled, readFunder, readTopUp, type FunderRead } from "./funders.ts";

/**
 * The 24 biggest buyers: the first 12 followed 4 hops back, the next 12 two (a hand spread thin still sits among them).
 * Each also has its top-up just before the buy read, followed one more hop.
 */
export const HAND = { hops: 4, wallets: 24, deep: 12, shallowHops: 2, topUpHops: 2, cautionWallets: 4, cautionTook: 0.2, avoidWallets: 6, avoidHeld: 0.3 } as const;
export type HandBuyer = { wallet: string; took: number; held: number; at?: number };

export interface HandGroup {
  /** The wallet they all trace back to. */
  root: string;
  wallets: string[];
  /** The most hops between a buyer and the root. */
  hops: number;
  /** What these wallets took at most, and hold now, as shares of the supply. */
  took: number;
  held: number;
  /** The root is the dev's own wallet. */
  dev: boolean;
}
export interface HandReport {
  checked: number;
  /** Of those, the buyers whose funder could be read at all. */
  traced: number;
  /**
   * Why the rest were not: no funding in their history, a failed read, a history too deep to reach its start. `upstream`
   * counts traced buyers whose trail broke further up, on a funder's funder, with a failed or too deep read.
   */
  missed?: { none: number; rpc: number; long: number; upstream: number };
  /** The first failed reads, as the RPC gave them. */
  errors?: string[];
  /** Some failed read up a trail was the RPC refusing: asking again soon can fill it. */
  upstreamRpc?: boolean;
  /** The trace outlasted the request: nothing was judged this time, it finishes in the background for the next check. */
  late?: boolean;
  group: HandGroup | null;
}

type Funder = (wallet: string) => Promise<string | null | FunderRead>;
type TopUp = (wallet: string, at: number) => Promise<string | null | FunderRead>;
const read = (x: string | null | FunderRead): FunderRead => (x === null ? { funder: null, why: "none" } : typeof x === "string" ? { funder: x, why: "found" } : x);
const funders = new Map<string, FunderRead>();
/** Funders do not change: a wallet's first money in is read once. A failed read is not kept, so it is asked again. */
const cachedFunder: Funder = async (w) => {
  const hit = funders.get(w);
  if (hit) return hit;
  const f = await readFunder(w, fetch);
  if (f.why !== "rpc") funders.set(w, f);
  if (funders.size > 50_000) funders.delete(funders.keys().next().value!);
  return f;
};

const topUps = new Map<string, FunderRead>();
const cachedTopUp: TopUp = async (w, at) => {
  const k = `${w}:${at}`;
  const hit = topUps.get(k);
  if (hit) return hit;
  const f = await readTopUp(w, at, fetch);
  if (f.why !== "rpc") topUps.set(k, f);
  if (topUps.size > 50_000) topUps.delete(topUps.keys().next().value!);
  return f;
};
const noTopUp: TopUp = async () => null;

/** The wallets up a buyer's funding, nearest first, stopping before an exchange or a launch service. */
export async function chainOf(wallet: string, funder: Funder, hops: number = HAND.hops): Promise<string[]> {
  const out: string[] = [];
  let at = wallet;
  for (let i = 0; i < hops; i++) {
    const f = read(await funder(at)).funder;
    if (!f || f === wallet || out.includes(f) || exchangeOf(f) || launcherOf(f)) break;
    out.push(f);
    at = f;
  }
  return out;
}

/** The largest set of buyers that share a wallet up their funding. */
export async function traceHand(buyers: HandBuyer[], creator: string | null, funder: Funder = cachedFunder, topUp: TopUp = funder === cachedFunder ? cachedTopUp : noTopUp): Promise<HandReport> {
  const sample = buyers.slice(0, HAND.wallets);
  const own0 = new Set(sample.map((b) => b.wallet));
  const traced = new Set<string>();
  const why = new Map<string, FunderRead["why"]>();
  const errors: string[] = [];
  const counted: Funder = async (w) => {
    const f = read(await funder(w));
    if (own0.has(w)) f.funder ? traced.add(w) : why.set(w, f.why);
    if (f.err && errors.length < 3 && !errors.includes(f.err)) errors.push(f.err);
    return f;
  };
  // A read that fails further up a buyer's trail ends it early, and a funder above could be the one they share.
  const upstream = new Set<string>();
  const upstreamRpc = new Set<string>();
  const trail = (buyer: string): Funder => async (w) => {
    const f = read(await counted(w));
    if (w !== buyer && !f.funder && f.why !== "none") (upstream.add(buyer), f.why === "rpc" && upstreamRpc.add(buyer));
    return f;
  };
  // Each buyer's trail: its first money in, followed back, and who topped it up just before it bought, one hop more.
  // Entries are [wallet, hops from the buyer].
  const trailOf = async (b: HandBuyer, i: number): Promise<Array<[string, number]>> => {
    const first = await chainOf(b.wallet, trail(b.wallet), i < HAND.deep ? HAND.hops : HAND.shallowHops);
    const out: Array<[string, number]> = first.map((a, h) => [a, h + 1]);
    if (b.at == null) return out;
    const t = read(await topUp(b.wallet, b.at));
    if (t.err && errors.length < 3 && !errors.includes(t.err)) errors.push(t.err);
    if (!t.funder) {
      if (t.why !== "none") (upstream.add(b.wallet), t.why === "rpc" && upstreamRpc.add(b.wallet));
      return out;
    }
    if (t.funder === b.wallet || exchangeOf(t.funder) || launcherOf(t.funder)) return out;
    // A wallet with no first funding to follow is traced after all when it was topped up.
    if (why.get(b.wallet) === "none") (why.delete(b.wallet), traced.add(b.wallet));
    const up = [t.funder, ...(await chainOf(t.funder, trail(b.wallet), HAND.topUpHops - 1))];
    for (const [h, a] of up.entries()) if (!out.some(([x]) => x === a)) out.push([a, h + 1]);
    return out;
  };
  const chains: Array<Array<[string, number]>> = [];
  // A few at a time: each hop is RPC reads.
  for (let i = 0; i < sample.length; i += 3) chains.push(...(await Promise.all(sample.slice(i, i + 3).map((b, j) => trailOf(b, i + j)))));
  // Buyers that share any wallet up their funding are one owner, and so is everyone those share with: a union of chains.
  const parent = sample.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const own = new Map(sample.map((b, i) => [b.wallet, i]));
  const seenAt = new Map<string, Array<{ i: number; hops: number }>>();
  chains.forEach((c, i) => {
    for (const [a, h] of c) seenAt.set(a, [...(seenAt.get(a) ?? []), { i, hops: h }]);
    // A buyer that paid another buyer.
    for (const [a] of c) if (own.has(a)) parent[find(own.get(a)!)] = find(i);
  });
  for (const hits of seenAt.values()) for (const x of hits.slice(1)) parent[find(x.i)] = find(hits[0]!.i);
  const comps = new Map<number, number[]>();
  sample.forEach((_, i) => comps.set(find(i), [...(comps.get(find(i)) ?? []), i]));
  let best: HandGroup | null = null;
  for (const idx of comps.values()) {
    if (idx.length < 2) continue;
    const members = idx.map((i) => sample[i]!);
    // The root named is the wallet most of them reach, nearest first.
    let root = "";
    let reach = 0;
    let hops = 0;
    for (const [a, hits] of seenAt) {
      const n = new Set(hits.filter((x) => idx.includes(x.i)).map((x) => x.i)).size;
      const far = Math.max(...hits.filter((x) => idx.includes(x.i)).map((x) => x.hops));
      if (n > reach || (n === reach && far < hops)) (root = a), (reach = n), (hops = far);
    }
    const g: HandGroup = {
      root,
      wallets: members.map((m) => m.wallet),
      hops: Math.max(hops, 1),
      took: Math.round(members.reduce((n, m) => n + m.took, 0) * 1000) / 1000,
      held: Math.round(members.reduce((n, m) => n + m.held, 0) * 1000) / 1000,
      dev: !!creator && idx.some((i) => chains[i]!.some(([a]) => a === creator)),
    };
    if (!best || g.wallets.length > best.wallets.length) best = g;
  }
  return { checked: sample.length, traced: traced.size, missed: { none: [...why.values()].filter((x) => x === "none").length, rpc: [...why.values()].filter((x) => x === "rpc").length, long: [...why.values()].filter((x) => x === "long").length, upstream: upstream.size }, ...(upstreamRpc.size ? { upstreamRpc: true } : {}), ...(errors.length ? { errors } : {}), group: best };
}

const reports = new Map<string, { at: number; p: Promise<HandReport | null> }>();
const CACHE_MS = 10 * 60_000;
/**
 * The hand behind a coin's biggest buyers, kept ten minutes. A trace that outlasts the request keeps going, so the
 * next check has it.
 */
export function handOf(mint: string, buyers: HandBuyer[], creator: string | null, now = Date.now()): Promise<HandReport | null> {
  if (!fundersEnabled() || buyers.length < HAND.cautionWallets) return Promise.resolve(null);
  const hit = reports.get(mint);
  if (hit && now - hit.at < CACHE_MS) return hit.p;
  const p = traceHand(buyers, creator).catch(() => null);
  reports.set(mint, { at: now, p });
  // A trace with failed reads is kept a minute, not ten: the next X-Ray asks again, and what was read stays cached.
  void p.then((r) => {
    if ((r?.missed?.rpc || r?.upstreamRpc) && reports.get(mint)?.p === p) reports.set(mint, { at: now - CACHE_MS + 60_000, p });
  });
  if (reports.size > 2_000) for (const [k, v] of reports) if (now - v.at > CACHE_MS) reports.delete(k);
  return p;
}

/** The reason a hand gives, if it is big enough to be one: avoid when it still sits on the supply. */
export function handWarning(r: HandReport | null | undefined): { text: string; avoid: boolean } | null {
  const g = r?.group;
  if (!g || g.wallets.length < HAND.cautionWallets || g.took < HAND.cautionTook) return null;
  const pct = (x: number) => Math.round(x * 100);
  const from = g.dev ? "the dev's own wallet" : g.hops === 1 ? "one wallet" : `one wallet up to ${g.hops} hops back`;
  const text = `${g.wallets.length} of its ${r!.checked} biggest buyers were paid from ${from} and took ${pct(g.took)}% of the supply; they still hold ${pct(g.held)}%`;
  return { text, avoid: g.wallets.length >= HAND.avoidWallets && g.held >= HAND.avoidHeld };
}

/** handOf, given at most `ms`: a trace still running then comes back as `late` rather than as no answer. */
export async function handWithin(mint: string, buyers: HandBuyer[], creator: string | null, ms = 5_000): Promise<HandReport | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((r) => (timer = setTimeout(() => r("late"), ms)));
  const r = await Promise.race([handOf(mint, buyers, creator), late]);
  clearTimeout(timer);
  return r === "late" ? { checked: Math.min(buyers.length, HAND.wallets), traced: 0, late: true, group: null } : r;
}

/**
 * What the trace says when it flags nothing: that it ran complete and found no hand, or that it could not read some
 * buyers, so a clean answer is not a clean bill. Said, not scored.
 */
export function handNote(r: HandReport | null | undefined): string | null {
  if (!r || handWarning(r)) return null;
  if (r.late) return "the money trail of its biggest buyers took too long to read this time, so the one-wallet check is not in this answer: check again in a minute";
  const rpc = r.missed?.rpc ?? 0;
  const long = r.missed?.long ?? 0;
  const up = r.missed?.upstream ?? 0;
  if (rpc || r.upstreamRpc) return `the funding of ${rpc + long + up} of its ${r.checked} biggest buyers could not be read this time, so the one-wallet check is incomplete: check again in a minute`;
  if (long || up) return `the funding of ${long + up} of its ${r.checked} biggest buyers is too far back in a long history to read, so the one-wallet check is incomplete`;
  const none = r.missed?.none ?? 0;
  return `the money of its ${r.checked} biggest buyers was traced up to ${HAND.hops} hops back: no one wallet paid enough of them to flag${none ? ` (${none} had no funding to follow)` : ""}`;
}
