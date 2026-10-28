import type { Odds } from "./odds.ts";
import { curveCapOf, CURVE_DEAD_SOL, POOL_DEAD_SOL } from "../agents/judgement.ts";
import type { HolderReport } from "./holders.ts";
import type { LineageView } from "./lineage.ts";
import { deployerOf } from "./exchanges.ts";
import type { AccountRecord } from "./socials.ts";
import type { ChainFacts, CreatorRecord } from "./pump.ts";

/**
 * A pre-trade check for agents: one fast, model-free verdict on a pump.fun token from what the tape saw on chain.
 * avoid and caution say why in plain words; pass means none of the checks fired, not that the token is good.
 */
export type CheckVerdict = "avoid" | "caution" | "pass" | "unknown";

export const CHECK_VERSION = 6;
/** A PumpSwap pool opens with about this much SOL when a pump.fun token graduates. */
export const GRAD_POOL_SOL = 85;
/** Dev gone, holders carry it: what a token must show before its dev's record stops being the reason to avoid it. */
export const DEV_GONE = { soldPct: 0.99, poolGrowth: 2, top10: 0.3, topWallet: 0.1, bundlersHeld: 0.2, ageMin: 120, crewBack: 0.05 } as const;
/** A dev who sells early but whose coins still run: enough priced launches, most past $20K. */
export const RUNNER_DEV = { minLaunches: 5, reached20k: 0.5 } as const;
/** Avoid reasons a runner dev's record may soften: their selling, their dump history, a bundle at launch. Nothing else. */
const SOFT_AVOID = [/^the creator sold \d+% of their own bag$/, /^this creator dumped \d+ of their \d+ launches/, /wallets bought \d+% of the supply in the launch block/];
const usdShort = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);
export const runnerReason = (p: NonNullable<CreatorRecord["pattern"]>) =>
  `this dev sells early, yet ${Math.round(p.reached20k! * 100)}% of their last ${p.launches} launches went past $20K${p.peakCapUsd ? ` (usual peak ${usdShort(p.peakCapUsd)})` : ""}: selling fast is their pattern, so the risk is getting out in time, not a rug`;
export const DEV_GONE_REASON = "the dev who launched it dumps their launches and already sold everything; it runs on its holders now, so the risk is the market, not the dev";
/** Under this age a token has had no time to show anything but its creator's history: the check says so. */
export const EARLY_MIN = 10;

/** The verdict as a number, 0..100, from the weight of every reason that stood: the same bands as the verdict. */
export type RiskScore = number | null;

export interface TokenCheck {
  version: number;
  mint: string;
  /** Which chain the address was read on: a 0x address is BNB Chain or Base, and the shape alone cannot say. */
  chain: Chain;
  symbol: string | null;
  verdict: CheckVerdict;
  /**
   * Risk 0..100. pass sits at 0..24, caution at 25..59, avoid at 60..100: inside a band the reasons' weights decide.
   * null when the tape never saw the token. A number to sort and colour by; the reasons stay the answer.
   */
  score: RiskScore;
  /** true on pass; null when the tape never saw the token, so the caller decides with its other tools. */
  proceed: boolean | null;
  /** Why the verdict, in plain words: every avoid reason first, then every caution reason. */
  reasons: string[];
  /** Worth knowing, never a reason to refuse: "too early to tell", "holders not checked". */
  notes: string[];
  /**
   * pump.fun launches only: the odds the first five minutes give, fitted on what launches like it went on to do. The
   * run odds rank launches far better than the verdict does; the verdict says who is behind it.
   */
  odds?: Odds | null;
  facts: {
    ageMin: number;
    buyers: number;
    buys: number;
    sells: number;
    creatorSoldPct: number | null;
    creatorLaunches24h: number;
    creatorDumped48h: number | null;
    creatorMedianDumpMin: number | null;
    bundleWallets: number | null;
    bundleSharePct: number | null;
    /** Wallets that bought in bundles of four or more in one block at any point of its life; what they hold now and held at most. */
    bundlers: number;
    bundlersHeldPct: number | null;
    bundlersPeakPct: number | null;
    bundledSol: number | null;
    /** Older than the bundle reader: bundles counted only from this time (ms). */
    bundlesSince: number | null;
    top5BuyingPct: number | null;
    graduated: boolean;
    /** The token it trades against when not SOL; then curveSol is null. */
    quote: string | null;
    mayhem: boolean;
    /** Where it was launched: pump.fun, Raydium LaunchLab or Meteora's bonding curve. */
    venue: "pump.fun" | "launchlab" | "dbc" | "fourmeme" | "flap" | "clanker";
    /** The platform on that launchpad when known, e.g. "stonk" (StonkFun on LaunchLab). */
    platform?: string;
    curveSol: number | null;
    poolSol: number | null;
    /** Wallets that bought in the first 5 seconds, and the share of the supply they still hold (curve trades). */
    earlyWallets: number | null;
    earlyHeldPct: number | null;
    /** At least this share of the trading is wallets selling back what they bought. */
    churnPct: number | null;
    /** Buy-and-sell in one transaction: bump bots. */
    bumps: number | null;
    /** First-second wallets that keep sniping this creator's launches, that snipe together, that snipe everything. */
    creatorCrew: number | null;
    ringWallets: number | null;
    serialSnipers: number | null;
    /** What the creator's crew and ring wallets still hold, of the supply. */
    crewHeldPct: number | null;
    /** The dev sold everything and left; the coin graduated, its pool doubled and its holders are spread out: the risk is the market now. */
    devGone: boolean;
    /** A dev who sells early but whose coins mostly ran past $20K: their selling was softened to caution. */
    runnerDev: boolean;
  } | null;
  /** Who paid for the creator, and what else that wallet paid for. Absent when the node has no RPC. */
  funding?: { funder: string | null; funderIsHot: boolean; funderLabel?: string | null; funderService?: string | null; otherCreators: number; theirLaunches48h: number; theirDumps48h: number } | null;
  /** Only with ?holders=1: who holds it right now, from Solana RPC. */
  holders?: { top10Pct: number; topWalletPct: number; creatorHoldsPct: number | null; programPct?: number } | null;
  /** How fresh the chain stream behind this answer is. */
  stream: { live: boolean; lastEventSecAgo: number | null };
  checkedAt: number;
  more: string;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 100));

/**
 * What each reason weighs, 0..40: a creator dumping their own bag or their own crew in the first seconds weighs most;
 * thin trading weighs least. The score is the sum inside the verdict's band, so a verdict and its score never disagree.
 */
export const WEIGHT = {
  creatorSold: 40,
  creatorSelling: 15,
  dumper: 30,
  launchSpam: 25,
  launches: 10,
  funderRing: 25,
  launchBundle: 25,
  bundlersAvoid: 25,
  bundlersCaution: 15,
  socialsAvoid: 20,
  socialsCaution: 10,
  earlyAvoid: 20,
  earlyCaution: 10,
  crew: 30,
  ring: 15,
  serial: 10,
  poolDead: 30,
  curveDead: 30,
  top5: 8,
  noBuyers: 5,
  fewBuyers: 5,
  sellsOutnumber: 8,
  wash: 10,
  bumps: 5,
  topWalletAvoid: 30,
  topWalletCaution: 15,
  top10: 15,
  bagMoved: 15,
  crewBack: 35,
  devDumps: 30,
  devDumpsCaution: 15,
} as const;

/** The score for a verdict from its reasons' weights: avoid 60..100, caution 25..59, pass 0..24. */
export function scoreOf(verdict: CheckVerdict, weights: number[], opts: { early?: boolean } = {}): RiskScore {
  const raw = weights.reduce((n, w) => n + w, 0);
  if (verdict === "unknown") return null;
  if (verdict === "avoid") return Math.min(100, 60 + Math.round(Math.min(40, Math.max(0, raw - 25) * 0.5 + 10)));
  if (verdict === "caution") return Math.min(59, 25 + Math.round(Math.min(34, raw)));
  return opts.early ? 10 : 0;
}

export type Chain = "solana" | "bsc" | "base";
/**
 * Which chain an address belongs to. Base58 is Solana. 0x and forty hex digits is an EVM address, BNB Chain or Base:
 * the shape cannot tell them apart, so the caller says which when it knows (the tape that has the token, the venue the
 * long memory kept, a `?chain=` on the request); BNB Chain otherwise, the first EVM chain the zoo read.
 */
export const chainOf = (address: string, evm: "bsc" | "base" = "bsc"): Chain => (/^0x[0-9a-fA-F]{40}$/.test(address) ? evm : "solana");
export const isEvm = (address: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(address);
export const CHAIN_NAME: Record<Chain, string> = { solana: "Solana", bsc: "BNB Chain", base: "Base" };
const NO_RECORD: Record<Chain, string> = {
  solana: "not a launch from pump.fun, Raydium LaunchLab or Meteora in the last two days, so there is no chain record to check",
  bsc: "not a launch from four.meme or Flap in the last two days, so there is no chain record to check",
  base: "not a Clanker launch on Base in the last two days, so there is no chain record to check",
};

export interface CheckInput {
  symbol: string;
  facts: ChainFacts;
  creatorRecord: CreatorRecord | null;
}

export function checkToken(
  mint: string,
  found: CheckInput | null,
  opts: { now?: number; stream?: TokenCheck["stream"]; holders?: HolderReport | null; lineage?: LineageView | null; socials?: AccountRecord[]; chain?: Chain } = {},
): TokenCheck {
  const now = opts.now ?? Date.now();
  const stream = opts.stream ?? { live: true, lastEventSecAgo: null };
  const chain = opts.chain ?? chainOf(mint);
  const base = { version: CHECK_VERSION, mint, chain, checkedAt: now, more: "https://zooaiagency.com/skill.md", stream };
  if (!found) {
    return {
      ...base,
      symbol: null,
      verdict: "unknown",
      score: null,
      proceed: null,
      reasons: [NO_RECORD[chain]],
      notes: stream.live ? [] : ["the chain stream is down right now: a fresh launch may be missing for that reason"],
      facts: null,
    };
  }
  const f = found.facts;
  const c = found.creatorRecord;
  const avoid: string[] = [];
  const caution: string[] = [];
  const notes: string[] = [];
  const weight = new Map<string, number>();
  const flag = (list: string[], text: string, w: number) => {
    list.push(text);
    weight.set(text, w);
  };
  const early = f.ageMin < EARLY_MIN;

  // The creator selling their own bag is the pump.fun rug.
  if (f.creatorSold !== null && f.creatorSold >= 0.5) flag(avoid, `the creator sold ${pct(Math.min(1, f.creatorSold))}% of their own bag`, WEIGHT.creatorSold);
  else if (f.creatorSold !== null && f.creatorSold > 0.1) flag(caution, `the creator has sold ${pct(f.creatorSold)}% of their own bag`, WEIGHT.creatorSelling);

  // A launchpad's own deployer wallet creates every coin on that platform: hundreds a day, none of them its own. Named
  // when known, else read from the shape: thirty or more launches a day, none dumped, some graduated.
  const deployer = deployerOf(c?.wallet) ?? (f.creatorLaunches24h >= 30 && c && c.dumped === 0 && c.graduated >= 2 ? "a launchpad" : null);
  // Their history, from every launch of theirs the tape saw in two days.
  if (deployer) {
    notes.push(`the creator wallet is ${deployer === "a launchpad" ? "a launchpad's deployer" : `${deployer}'s deployer`}: it creates every coin launched there (${f.creatorLaunches24h} in 24 hours), so its launch count is the platform's, not a dev's`);
  } else if (c && c.dumped >= 3 && c.dumped / Math.max(1, c.launches48h) >= 0.5) {
    const speed = c.medianDumpMin === null ? "" : `, usually ${c.medianDumpMin} min after launch`;
    flag(avoid, `this creator dumped ${c.dumped} of their ${c.launches48h} launches in 48 hours${speed}`, WEIGHT.dumper);
  } else if (f.creatorLaunches24h >= 30) {
    // Nobody building a coin launches thirty a day: it is a ticker farm, and a buyer is often the only buyer.
    flag(avoid, `this wallet launched ${f.creatorLaunches24h} tokens in 24 hours: launch spam, not a project`, WEIGHT.launchSpam);
  } else if (f.creatorLaunches24h >= 3) {
    flag(caution, `the creator launched ${f.creatorLaunches24h} tokens in the last 24 hours`, WEIGHT.launches);
  }

  // Who paid for the creator: a fresh wallet funded by the same hand as a row of ruggers is that rugger again.
  const lin = opts.lineage;
  if (lin && lin.funder && !lin.funderIsHot && lin.siblings.length) {
    const n = lin.siblings.length;
    const they = `the wallet that funded this creator also funded ${n} other launcher${n === 1 ? "" : "s"}`;
    if (lin.siblingDumped48h >= 3 && lin.siblingDumped48h / Math.max(1, lin.siblingLaunches48h) >= 0.5) {
      flag(avoid, `${they}; they dumped ${lin.siblingDumped48h} of their ${lin.siblingLaunches48h} launches in 48 hours`, WEIGHT.funderRing);
    } else notes.push(`${they} the zoo has traced`);
  } else if (opts.lineage === null) notes.push("who funded the creator is not traced yet: it is queued");

  // Wallets other than the creator buying in the launch block. On its own that is no red flag: launches bundled like
  // this ran four times as often as the rest (34,183 pump.fun launches, 2026-10-28). It is one once the bundle has sold
  // what it took to whoever bought after it.
  if (f.bundleWallets !== null && f.bundleShare !== null && f.bundleWallets >= 3 && f.bundleShare >= 0.15) {
    const said = `${f.bundleWallets} wallets bought ${pct(f.bundleShare)}% of the supply in the launch block`;
    if (f.bundleKept != null && f.bundleKept < 1 / 3) flag(caution, `${said} and have sold ${Math.round((1 - f.bundleKept) * 100)}% of it`, WEIGHT.launchBundle);
    else notes.push(f.bundleKept != null ? `${said}; they still hold ${pct(f.bundleKept)}% of it` : said);
  }

  // Bundles later in its life: blocks where four or more wallets bought at once, together holding much of the supply.
  // Buyers like that are one hand dressed as a crowd. Mayhem Mode's own bot trades in bursts, so it is left out there.
  if ((f.bundlers ?? 0) >= 10 && (f.bundlersPeak ?? 0) >= 0.3 && !f.mayhem) {
    const said = `${f.bundlers} wallets bought it in bundles (four or more in one block) and held up to ${pct(f.bundlersPeak ?? 0)}% of the supply together; they still hold ${pct(f.bundlersHeld ?? 0)}%`;
    if ((f.bundlersHeld ?? 0) >= 0.4) flag(avoid, said, WEIGHT.bundlersAvoid);
    else flag(caution, said, WEIGHT.bundlersCaution);
  }

  // The account the token advertises, reused on other launches whose devs sold within minutes: the same hands.
  for (const a of opts.socials ?? []) {
    if (a.fastDumps < 2) continue;
    const said = `the ${a.social.kind === "telegram" ? "Telegram group" : a.social.kind === "x-community" ? "X community" : "X account"} this token links to (${a.social.label}) is also on ${a.launches} other launch${a.launches === 1 ? "" : "es"} from the last 48 hours; their dev sold within 5 minutes on ${a.fastDumps}`;
    if (a.fastDumps >= 3) flag(avoid, said, WEIGHT.socialsAvoid);
    else flag(caution, said, WEIGHT.socialsCaution);
  }

  // Wallets in before anyone could see the token, still sitting on a big share: they decide when it dies.
  if (f.earlyWallets !== undefined && f.earlyHeld !== undefined && f.earlyWallets >= 2) {
    const who = `${f.earlyWallets} wallets that bought in the first 5 seconds still hold ${pct(f.earlyHeld)}% of the supply`;
    // In Mayhem Mode pump.fun's own bot trades from the first second, so an early crowd may be partly that bot.
    if (f.earlyWallets >= 3 && f.earlyHeld >= 0.5 && !f.mayhem) flag(avoid, who, WEIGHT.earlyAvoid);
    else if (f.earlyHeld >= 0.25) flag(caution, who, WEIGHT.earlyCaution);
  }

  // Who those first-second wallets are, from every launch the tape saw them snipe in two days.
  // A launchpad's deployer "launches" every coin on the platform, so wallets that snipe many of them are platform-wide
  // snipers, not the creator's crew; the serial-sniper line below covers them.
  if ((f.creatorCrew ?? 0) >= 2 && !deployer) {
    flag(avoid, `${f.creatorCrew} of the wallets in the first 5 seconds keep sniping this creator's other launches: they are the creator's own wallets`, WEIGHT.crew);
  }
  if ((f.ringWallets ?? 0) >= 3) flag(caution, `${f.ringWallets} of the first-second wallets have sniped launches together before: one operator`, WEIGHT.ring);
  else if ((f.serialSnipers ?? 0) >= 3) flag(caution, `${f.serialSnipers} serial snipers got in first: wallets that buy launches in the first seconds to sell to whoever comes next`, WEIGHT.serial);

  if (f.graduated) {
    if (f.poolSol !== null && f.poolSol < POOL_DEAD_SOL) flag(avoid, `graduated, but the pool is down to ${f.poolSol.toFixed(2)} SOL`, WEIGHT.poolDead);
  } else if (f.ageMin >= 360 && !f.quote) {
    const real = f.curveSol ?? (f.buys === 0 ? 0 : null);
    if (real !== null && curveCapOf(real) < CURVE_DEAD_SOL) flag(avoid, `${Math.round(f.ageMin / 60)} hours old and the curve is back where it opened: nobody is holding it`, WEIGHT.curveDead);
  }

  if (f.mayhem) notes.push("launched in Mayhem Mode: two billion supply, and pump.fun's own bot trades it for the first 24 hours, so its volume is partly that bot");

  if (early) {
    // Minutes in, a handful of buyers is normal; only the creator's own record can speak yet.
    // Said once the verdict is known: "no red flags yet" next to an avoid would contradict it.
  } else {
    if (f.top5Share !== null && f.top5Share > 0.5) flag(caution, `the top 5 buyers took ${pct(f.top5Share)}% of all buying`, WEIGHT.top5);
    if (f.buyers === 0) flag(caution, "nobody has bought it", WEIGHT.noBuyers);
    else if (f.buyers < 10) flag(caution, f.buyers === 1 ? "only 1 wallet has bought it" : `only ${f.buyers} wallets have bought it`, WEIGHT.fewBuyers);
    if (f.sells > f.buys * 2 && f.sells >= 10) flag(caution, `sells outnumber buys ${f.sells} to ${f.buys}`, WEIGHT.sellsOutnumber);
    if (f.washShare !== undefined && f.washShare >= 0.3 && !f.mayhem) flag(caution, `at least ${pct(f.washShare)}% of the trading is wallets selling back what they just bought: volume, not holders`, WEIGHT.wash);
    if (f.bumps !== undefined && f.bumps >= 3 && !f.mayhem) flag(caution, `a bot bought and sold it in the same transaction ${f.bumps} times to keep it on the front page`, WEIGHT.bumps);
  }

  // Who holds it now catches what trades cannot: a creator who moved the bag to other wallets instead of selling.
  let holders: TokenCheck["holders"];
  if (opts.holders !== undefined) {
    const h = opts.holders;
    // Shares of the supply to one decimal: a coin where everyone sold back shows 0.3%, not a misleading 0%.
    const pct1 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);
    holders = h ? { top10Pct: pct1(h.top10Share)!, topWalletPct: pct1(h.topShare)!, creatorHoldsPct: pct1(h.creatorShare), programPct: pct1(h.programShare)! } : null;
    if (!h) notes.push(`holders could not be read from ${CHAIN_NAME[chain]} right now`);
    else {
      // Half the supply in one wallet: whoever holds it decides when the price goes to zero.
      if (h.topShare >= 0.5) flag(avoid, `one wallet holds ${pct(h.topShare)}% of the supply`, WEIGHT.topWalletAvoid);
      else if (h.topShare >= 0.2) flag(caution, `one wallet holds ${pct(h.topShare)}% of the supply`, WEIGHT.topWalletCaution);
      else if (h.top10Share >= 0.5) flag(caution, `the 10 largest wallets hold ${pct(h.top10Share)}% of the supply`, WEIGHT.top10);
      const bought = f.creatorSold !== null;
      if (bought && (f.creatorSold ?? 0) < 0.5 && h.creatorShare !== null && h.creatorShare < 0.001) {
        flag(caution, "the creator no longer holds any of it, but never sold on the curve: the bag moved to other wallets", WEIGHT.bagMoved);
      }
    }
  }

  // Dev gone, holders carry it: a serial dumper's coin they fully left, that graduated and grew on its own. Their record
  // still shows, but it no longer decides: whoever holds it now does. Only when the holders were read.
  const devGone = devGoneOf(f, opts.holders);
  if (devGone) {
    if ((f.crewHeld ?? 0) >= DEV_GONE.crewBack) {
      const said = `the dev sold to shake out the snipers and came back through their own wallets: wallets that snipe their launches hold ${pct(f.crewHeld)}% of the supply`;
      avoid.unshift(said);
      weight.set(said, WEIGHT.crewBack);
    } else {
      // Softened to caution: those reasons weigh half of what they did.
      for (const r of avoid) weight.set(r, Math.round((weight.get(r) ?? 0) / 2));
      caution.unshift(DEV_GONE_REASON, ...avoid.splice(0));
    }
  }
  // A runner dev: sells early or launches with a bundle, yet most of their coins still went past $20K. Their selling is
  // their pattern, not a rug, so only those reasons give way, to caution, never further.
  const pat = c?.pattern;
  const runner = !devGone && avoid.length > 0 && !!pat && pat.launches >= RUNNER_DEV.minLaunches && (pat.reached20k ?? 0) >= RUNNER_DEV.reached20k && avoid.every((r) => SOFT_AVOID.some((re) => re.test(r)));
  if (runner) {
    for (const r of avoid) weight.set(r, Math.round((weight.get(r) ?? 0) / 2));
    caution.unshift(runnerReason(pat!), ...avoid.splice(0));
  }
  const verdict: CheckVerdict = avoid.length ? "avoid" : caution.length ? "caution" : "pass";
  const score = scoreOf(verdict, [...avoid, ...caution].map((r) => weight.get(r) ?? 0), { early });
  if (early) {
    const age = Math.max(0, Math.round(f.ageMin));
    const when = age < 1 ? "just launched" : `only ${age} min old`;
    notes.unshift(verdict === "pass" ? `${when}: no red flags yet, so check again before adding` : `${when}: more can show up, check again before adding`);
  }
  if (verdict === "pass") notes.push("pass means no creator dump, bundle, creator's crew, sniper hold, serial launcher or dead curve was seen on chain; it is not a call that the price goes up");
  if (!stream.live) notes.push("the chain stream is down right now: this answer may be stale");
  return {
    ...base,
    symbol: found.symbol,
    verdict,
    score,
    proceed: verdict === "pass",
    reasons: [...avoid, ...caution],
    notes,
    facts: {
      ageMin: Math.round(f.ageMin),
      buyers: f.buyers,
      buys: f.buys,
      sells: f.sells,
      creatorSoldPct: pct(f.creatorSold === null ? null : Math.min(1, f.creatorSold)),
      creatorLaunches24h: f.creatorLaunches24h,
      creatorDumped48h: c ? c.dumped : null,
      creatorMedianDumpMin: c ? c.medianDumpMin : null,
      bundleWallets: f.bundleWallets,
      bundleSharePct: pct(f.bundleShare),
      bundlers: f.bundlers ?? 0,
      bundlersHeldPct: pct(f.bundlersHeld ?? null),
      bundlersPeakPct: pct(f.bundlersPeak ?? null),
      bundledSol: f.bundledSol ?? null,
      bundlesSince: f.bundlesSince ?? null,
      top5BuyingPct: pct(f.top5Share),
      graduated: f.graduated,
      quote: f.quote ?? null,
      mayhem: Boolean(f.mayhem),
      venue: f.venue ?? "pump.fun",
      ...(f.platform ? { platform: f.platform } : {}),
      curveSol: f.curveSol,
      poolSol: f.poolSol,
      earlyWallets: f.earlyWallets ?? null,
      earlyHeldPct: pct(f.earlyHeld),
      churnPct: pct(f.washShare),
      bumps: f.bumps ?? null,
      creatorCrew: f.creatorCrew ?? null,
      ringWallets: f.ringWallets ?? null,
      serialSnipers: f.serialSnipers ?? null,
      crewHeldPct: pct(f.crewHeld),
      devGone: devGone && (f.crewHeld ?? 0) < DEV_GONE.crewBack,
      runnerDev: runner,
    },
    ...(holders !== undefined ? { holders } : {}),
    ...(lin !== undefined
      ? { funding: lin ? { funder: lin.funder, funderIsHot: lin.funderIsHot, funderLabel: lin.funderLabel ?? null, funderService: lin.funderService ?? null, otherCreators: lin.siblings.length, theirLaunches48h: lin.siblingLaunches48h, theirDumps48h: lin.siblingDumped48h } : null }
      : {}),
  };
}

/**
 * The dev has left and the holders carry it: the creator sold all they bought, it graduated, its pool holds at least twice
 * what it opened with and never drained, it is two hours old, and the holders read now are spread out with the bundlers mostly gone.
 * Unknown holders never qualify.
 */
export function devGoneOf(f: ChainFacts, h: HolderReport | null | undefined): boolean {
  if (!h) return false;
  if (f.creatorSold === null || f.creatorSold < DEV_GONE.soldPct) return false;
  if (h.creatorShare !== null && h.creatorShare >= 0.001) return false;
  if (!f.graduated || f.quote || f.drained) return false;
  // What it opened with: the curve's last reading at graduation, never taken as less than a pool's usual 85 SOL.
  if (f.poolSol === null || f.poolSol < Math.max(GRAD_POOL_SOL, f.curveSol ?? 0) * DEV_GONE.poolGrowth) return false;
  if (h.top10Share >= DEV_GONE.top10 || h.topShare >= DEV_GONE.topWallet) return false;
  if ((f.bundlersHeld ?? 0) >= DEV_GONE.bundlersHeld) return false;
  if (f.earlyHeld !== undefined && f.earlyHeld >= 0.5) return false;
  return f.ageMin >= DEV_GONE.ageMin;
}

/** A sliding one-minute window per caller: cheap protection for a public endpoint agents may call in a loop. */
export class RateGate {
  private readonly hits = new Map<string, number[]>();
  private readonly perMinute: number;
  constructor(perMinute: number) {
    this.perMinute = perMinute;
  }
  /** Milliseconds to wait, 0 when the call may go ahead (and is counted). */
  take(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(key, recent);
      return 60_000 - (now - recent[0]!);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < 60_000)) this.hits.delete(k);
    return 0;
  }
}

/**
 * A token the stream never saw (launched before its window): what happened at launch is not on record, so there is
 * no pass. What can still be read is who holds it now and the dev's record in the long memory; either can make it
 * avoid or caution, and when neither does the verdict stays unknown, said plainly.
 */
export function outsideCheck(
  mint: string,
  o: { symbol: string | null; createdAt: number; holders: HolderReport | null | undefined; dev: { launches: number; dumped: number } | null },
  opts: { now?: number; stream?: TokenCheck["stream"]; chain?: Chain } = {},
): TokenCheck {
  const now = opts.now ?? Date.now();
  const stream = opts.stream ?? { live: true, lastEventSecAgo: null };
  const chain = opts.chain ?? chainOf(mint);
  const avoid: string[] = [];
  const caution: string[] = [];
  const weights: number[] = [];
  const day = new Date(o.createdAt).toISOString().slice(0, 10);
  const notes = [`launched ${day}, before the stream's window: what happened at launch is not on record, only who holds it now and the dev's record`];
  const h = o.holders;
  const pct1 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);
  if (!h) notes.push(`holders could not be read from ${CHAIN_NAME[chain]} right now`);
  else if (h.topShare >= 0.5) (avoid.push(`one wallet holds ${pct(h.topShare)}% of the supply`), weights.push(WEIGHT.topWalletAvoid));
  else if (h.topShare >= 0.2) (caution.push(`one wallet holds ${pct(h.topShare)}% of the supply`), weights.push(WEIGHT.topWalletCaution));
  else if (h.top10Share >= 0.5) (caution.push(`the 10 largest wallets hold ${pct(h.top10Share)}% of the supply`), weights.push(WEIGHT.top10));
  const d = o.dev;
  if (d && d.launches >= 3 && d.dumped / d.launches >= 0.6) (avoid.push(`its dev dumped ${d.dumped} of ${d.launches} launches the zoo has kept`), weights.push(WEIGHT.devDumps));
  else if (d && d.dumped >= 2) (caution.push(`its dev dumped ${d.dumped} of ${d.launches} launches the zoo has kept`), weights.push(WEIGHT.devDumpsCaution));
  const verdict: CheckVerdict = avoid.length ? "avoid" : caution.length ? "caution" : "unknown";
  return {
    version: CHECK_VERSION,
    mint,
    chain,
    checkedAt: now,
    more: "https://zooaiagency.com/skill.md",
    stream,
    symbol: o.symbol,
    verdict,
    score: scoreOf(verdict, weights),
    proceed: verdict === "avoid" ? false : null,
    reasons: [...avoid, ...caution],
    notes,
    facts: null,
    ...(h !== undefined ? { holders: h ? { top10Pct: pct1(h.top10Share)!, topWalletPct: pct1(h.topShare)!, creatorHoldsPct: pct1(h.creatorShare), programPct: pct1(h.programShare)! } : null } : {}),
  };
}
