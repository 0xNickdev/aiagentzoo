/**
 * One hand in many wallets. A bundle tool can spread one buyer's money over a dozen fresh wallets and space their buys
 * out over minutes, so no block holds four of them and none is in the first five seconds: the tape sees a crowd. Their
 * money still came from somewhere. For the biggest buyers we follow the SOL back, wallet to wallet, up to four hops,
 * and stop at an exchange (its customers are strangers to each other). Wallets that share any wallet up that chain
 * were paid by one owner.
 */
import { exchangeOf, launcherOf } from "./exchanges.ts";
import { funderOf as readFunder, fundersEnabled } from "./funders.ts";

export const HAND = { hops: 4, wallets: 12, cautionWallets: 4, cautionTook: 0.2, avoidWallets: 6, avoidHeld: 0.3 } as const;

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
  group: HandGroup | null;
}

type Funder = (wallet: string) => Promise<string | null>;
const funders = new Map<string, string | null>();
/** Funders do not change: a wallet's first money in is read once. */
const cachedFunder: Funder = async (w) => {
  if (funders.has(w)) return funders.get(w)!;
  const f = await readFunder(w, fetch);
  funders.set(w, f);
  if (funders.size > 50_000) funders.delete(funders.keys().next().value!);
  return f;
};

/** The wallets up a buyer's funding, nearest first, stopping before an exchange or a launch service. */
export async function chainOf(wallet: string, funder: Funder, hops: number = HAND.hops): Promise<string[]> {
  const out: string[] = [];
  let at = wallet;
  for (let i = 0; i < hops; i++) {
    const f = await funder(at);
    if (!f || f === wallet || out.includes(f) || exchangeOf(f) || launcherOf(f)) break;
    out.push(f);
    at = f;
  }
  return out;
}

/** The largest set of buyers that share a wallet up their funding. */
export async function traceHand(buyers: Array<{ wallet: string; took: number; held: number }>, creator: string | null, funder: Funder = cachedFunder): Promise<HandReport> {
  const sample = buyers.slice(0, HAND.wallets);
  const own0 = new Set(sample.map((b) => b.wallet));
  const read = new Set<string>();
  const counted: Funder = async (w) => {
    const f = await funder(w);
    if (f && own0.has(w)) read.add(w);
    return f;
  };
  const chains: string[][] = [];
  // A few at a time: each hop is RPC reads.
  for (let i = 0; i < sample.length; i += 4) chains.push(...(await Promise.all(sample.slice(i, i + 4).map((b) => chainOf(b.wallet, counted)))));
  // Buyers that share any wallet up their funding are one owner, and so is everyone those share with: a union of chains.
  const parent = sample.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const own = new Map(sample.map((b, i) => [b.wallet, i]));
  const seenAt = new Map<string, Array<{ i: number; hops: number }>>();
  chains.forEach((c, i) => {
    c.forEach((a, h) => seenAt.set(a, [...(seenAt.get(a) ?? []), { i, hops: h + 1 }]));
    // A buyer that paid another buyer.
    for (const a of c) if (own.has(a)) parent[find(own.get(a)!)] = find(i);
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
      dev: !!creator && idx.some((i) => chains[i]!.includes(creator)),
    };
    if (!best || g.wallets.length > best.wallets.length) best = g;
  }
  return { checked: sample.length, traced: read.size, group: best };
}

const reports = new Map<string, { at: number; p: Promise<HandReport | null> }>();
const CACHE_MS = 10 * 60_000;
/**
 * The hand behind a coin's biggest buyers, kept ten minutes. A trace that outlasts the request keeps going, so the
 * next check has it.
 */
export function handOf(mint: string, buyers: Array<{ wallet: string; took: number; held: number }>, creator: string | null, now = Date.now()): Promise<HandReport | null> {
  if (!fundersEnabled() || buyers.length < HAND.cautionWallets) return Promise.resolve(null);
  const hit = reports.get(mint);
  if (hit && now - hit.at < CACHE_MS) return hit.p;
  const p = traceHand(buyers, creator).catch(() => null);
  reports.set(mint, { at: now, p });
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
