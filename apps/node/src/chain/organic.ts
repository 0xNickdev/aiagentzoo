/**
 * The organic label on a radar signal: rule-based, read from the minute-20 reading the radar already has. A label
 * only, it never hides a signal. Thresholds come from the 28 Nov research (2,646 pump.fun coins with cap >= 100 SOL,
 * 24-28 Nov; 41 organic, 2,473 pump), quantiles per class at minute 20:
 *
 *   SOL per buyer      pump p20/p50/p80 0.48/0.78/1.04   organic 0.85/1.00/2.01   (AUC 0.75)
 *   net SOL in-out     pump 0.2/14/85                    organic 19/85/89         (AUC 0.73)
 *   sells per buy      pump 0.70/0.84/0.95               organic 0.61/0.72/0.84   (AUC 0.29: high = pump)
 *   sell ramp 5 -> 20  sells/buy at 20 minus at 5; pump median +0.11, organic +0.04 (AUC 0.29)
 *   first 30 holding   pump 0/0.07/0.24                  organic 0.03/0.17/0.42   (AUC 0.64)
 *   creator fees SOL   pump 0.2/1.2/3.0                  organic 1.2/3.0/37       (AUC 0.73)
 *   first-30 wallets   owner's call, untested: half or more seasoned = organic sign, half or more brand new = pump
 *                      sign (seasoned/fresh defined in wallet-quality.ts)
 *
 * Each feature counts +1 (looks organic), -1 (looks pumped) or 0. Sum >= 2 is "organic", <= -2 "looks pumped",
 * else "mixed". Organic is 1-3% of these coins, so even "organic" is a lean, not a promise.
 */

export type OrganicTag = "organic" | "mixed" | "pumped";
export interface Organic {
  tag: OrganicTag;
  /** Two or three plain-word lines, strongest first. */
  lines: string[];
  score: number;
}

export interface OrganicInput {
  buyers: number | null;
  buys: number | null;
  sells: number | null;
  solIn: number | null;
  solOut?: number | null;
  creatorFeesSol?: number | null;
  /** Buys and sells at minute five, for the sell ramp. */
  buys5?: number | null;
  sells5?: number | null;
  /** Of the first 30 buyers, how many still hold at minute twenty, and how many there were. */
  held30?: { held: number; of: number } | null;
  /** How seasoned the first 30 buyers were (wallet-quality.ts). */
  wallets?: { of: number; fresh: number; seasoned: number } | null;
}

export const ORGANIC = {
  solPerBuyerGood: 1.0,
  solPerBuyerBad: 0.5,
  netGood: 20,
  netBad: 1,
  sellBuyGood: 0.7,
  sellBuyBad: 0.95,
  rampBad: 0.15,
  held30Good: 0.4,
  held30Bad: 0.05,
  feesGood: 3,
  seasonedShare: 0.5,
  freshShare: 0.5,
} as const;

const s1 = (v: number) => (v >= 10 ? Math.round(v).toString() : v >= 0.1 ? v.toFixed(1) : v.toFixed(2));
const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** The label, or null when the reading has too little to say (no buyers). */
export function organicOf(x: OrganicInput): Organic | null {
  if (!num(x.buyers) || x.buyers <= 0 || !num(x.solIn)) return null;
  const parts: Array<{ v: -1 | 0 | 1; w: number; line: string }> = [];
  const per = x.solIn / x.buyers;
  if (per >= ORGANIC.solPerBuyerGood) parts.push({ v: 1, w: 3, line: `${x.buyers} buyers at ${s1(per)} SOL each on average` });
  else if (per < ORGANIC.solPerBuyerBad) parts.push({ v: -1, w: 3, line: `${x.buyers} buyers at ${s1(per)} SOL each, looks botted` });
  else parts.push({ v: 0, w: 0, line: `${x.buyers} buyers at ${s1(per)} SOL each on average` });
  if (num(x.solOut)) {
    const net = x.solIn - x.solOut;
    if (net >= ORGANIC.netGood) parts.push({ v: 1, w: 2.5, line: `net +${s1(net)} SOL still flowing in` });
    else if (net <= ORGANIC.netBad) parts.push({ v: -1, w: 2.5, line: net < 0 ? `net ${s1(net)} SOL, more sold than bought` : "net SOL flat, sells ate the buys" });
  }
  if (num(x.buys) && x.buys > 0 && num(x.sells)) {
    const sb = x.sells / x.buys;
    const sb5 = num(x.buys5) && x.buys5 > 0 && num(x.sells5) ? x.sells5 / x.buys5 : null;
    if (sb >= ORGANIC.sellBuyBad || (sb5 != null && sb - sb5 >= ORGANIC.rampBad && sb >= 0.8)) parts.push({ v: -1, w: 2, line: "sells caught up with buys after minute 5" });
    else if (sb <= ORGANIC.sellBuyGood) parts.push({ v: 1, w: 1.5, line: `${Math.round(sb * 100)} sells per 100 buys, buyers not leaving` });
  }
  if (x.held30 && x.held30.of >= 10) {
    const share = x.held30.held / x.held30.of;
    if (share >= ORGANIC.held30Good) parts.push({ v: 1, w: 2, line: `${x.held30.held} of the first ${x.held30.of} buyers still hold` });
    else if (share <= ORGANIC.held30Bad) parts.push({ v: -1, w: 2, line: x.held30.held ? `only ${x.held30.held} of the first ${x.held30.of} buyers still hold` : `none of the first ${x.held30.of} buyers still hold` });
  }
  if (x.wallets && x.wallets.of >= 10) {
    const w = x.wallets;
    if (w.seasoned / w.of >= ORGANIC.seasonedShare) parts.push({ v: 1, w: 2, line: `${w.seasoned} of the first ${w.of} buyers are seasoned wallets (traded 50+ coins)` });
    else if (w.fresh / w.of >= ORGANIC.freshShare) parts.push({ v: -1, w: 2, line: `${w.fresh} of the first ${w.of} buyers are brand new wallets` });
  }
  if (num(x.creatorFeesSol) && x.creatorFeesSol >= ORGANIC.feesGood) parts.push({ v: 1, w: 1, line: `creator fees ${s1(x.creatorFeesSol)} SOL` });
  const score = parts.reduce((a, p) => a + p.v, 0);
  const tag: OrganicTag = score >= 2 ? "organic" : score <= -2 ? "pumped" : "mixed";
  // Lines that agree with the tag first, the strongest of them; a mixed label shows both sides.
  const sign = tag === "organic" ? 1 : tag === "pumped" ? -1 : 0;
  const ranked = parts.filter((p) => p.v !== 0 || parts.length === 1).sort((a, b) => (sign ? Number(b.v === sign) - Number(a.v === sign) : 0) || b.w - a.w);
  const lines = (ranked.length ? ranked : parts).slice(0, 3).map((p) => p.line);
  return { tag, lines, score };
}
