import type { WalletTag } from "../WalletTags";
import type { LaunchOutcome } from "../../outcome";
import type { Habits } from "../DevHabits";

export type Verdict = "avoid" | "caution" | "pass" | "unknown";

export interface Early {
  wallet: string;
  bought: number;
  held: number;
  afterSec: number;
  exitSec: number | null;
  bundle: boolean;
  snipes48h: number;
  crew: boolean;
  ring: boolean;
  serial: boolean;
  /** Who the wallet is across every launch the zoo has seen; the node's tags. */
  tags?: WalletTag[];
  /** The cabal it belongs to, when the memory ties it to others. */
  cabal?: number | null;
  /** A known wallet's public name, e.g. pump.fun's own Mayhem bot. */
  smart?: { name?: string } | null;
}

export interface Odds {
  run: number;
  vsAverage: number;
  devDumps: number | null;
  why: Array<{ says: string; up: boolean }>;
  at: "5min" | "early";
  fit: string;
  /** The average launch's run chance, when the node sends it; 2.7% otherwise. */
  average?: number;
  settled?: { ran: true; peakSol: number; afterMin: number } | { ran: false; ageMin: number };
  devSettled?: { dumped: boolean; ageMin: number };
}

export interface ToolStat {
  key: string;
  launches: number;
  wallets: number;
  settled: number;
  dumped: number;
  common: boolean;
}

export interface Check {
  verdict: Verdict;
  /** Risk 0..100 inside the verdict's band: pass 0..24, caution 25..59, avoid 60..100. Null when never seen. */
  score?: number | null;
  /** pump.fun launches: the chance it climbs past 85 SOL after minute five, and that the dev still dumps. */
  odds?: Odds | null;
  reasons: string[];
  notes: string[];
  /** Wallets that signed a transaction together with the dev, and what they launched and dumped in two days. */
  operator?: { wallets: number; launches: number; settled: number; dumped: number } | null;
  /** How the launch transaction was built, and what the other launches built the same way did (exact and by shape). */
  tool?: (ToolStat & { shape?: ToolStat }) | null;
  /** Whether the node's chain stream is live and how long ago it last heard the chain. */
  stream?: { live: boolean; lastEventSecAgo: number };
  facts: {
    ageMin: number;
    buyers: number;
    poolBuys?: number;
    buys: number;
    sells: number;
    creatorSoldPct: number | null;
    creatorLaunches24h: number;
    creatorDumped48h: number | null;
    creatorMedianDumpMin: number | null;
    bundleWallets: number | null;
    bundleSharePct: number | null;
    bundlers?: number;
    bundlersHeldPct?: number | null;
    bundlersPeakPct?: number | null;
    bundledSol?: number | null;
    /** Creator fees paid on this coin in SOL, from pump.fun's events. */
    creatorFees?: { total: number; curve: number; pool: number; estimated?: boolean; partial?: boolean };
    bundlesSince?: number | null;
    /** Share of all buying the five largest buyers did. */
    top5BuyingPct?: number | null;
    graduated: boolean;
    poolSol?: number | null;
    curveSol?: number | null;
    mayhem?: boolean;
    venue?: "pump.fun" | "launchlab" | "dbc" | "raydium" | "cpmm" | "fourmeme" | "flap" | "clanker";
    platform?: string;
    earlyWallets: number | null;
    earlyHeldPct: number | null;
    crewHeldPct?: number | null;
    churnPct: number | null;
    bumps: number | null;
    creatorCrew: number | null;
    ringWallets: number | null;
    serialSnipers: number | null;
  } | null;
  rights?: { program: "token" | "token-2022"; mintAuthority: string | null; freezeAuthority: string | null; permanentDelegate?: string; transferHook?: string; transferFeeBps?: number; defaultFrozen?: boolean; nonTransferable?: boolean; pauseAuthority?: string };
  holders?: { top10Pct: number; topWalletPct: number; creatorHoldsPct: number | null; programPct?: number; lockedPct?: number; devLockedPct?: number; burnedPct?: number } | null;
}

export interface Funding {
  funder: string | null;
  funderIsHot: boolean;
  /** The exchange the funder is a known hot wallet of, e.g. "Binance". */
  funderLabel?: string | null;
  /** The launchpad the funder is the launcher of, e.g. "ClawPump": it pays for every creator it launches. */
  funderService?: string | null;
  siblings: Array<{ wallet: string; launches48h: number; dumped: number }>;
  siblingLaunches48h: number;
  siblingDumped48h: number;
}

export interface XRayReport {
  mint: string;
  symbol: string;
  name: string;
  creator: string;
  createdAt: number;
  check: Check;
  early: Early[];
  creatorRecord: ({ launches48h: number; launches24h?: number; dumped: number; medianDumpMin: number | null; graduated?: number; recent?: Array<{ mint: string; symbol: string; createdAt: number; firstCapUsd?: number | null } & LaunchOutcome>; /** Every launch oldest to newest, at most the last 1000: d dumped, g graduated, a alive, u under 15 min. Newer nodes only. */ timeline?: Array<"d" | "g" | "a" | "u">; /** "history": the counts run back to historySince, not 48 h; last48h then holds the two days. */ counted?: "history"; historySince?: number; last48h?: { launches: number; dumped: number } } & Habits) | null;
  /** The X account, X community or Telegram group the token links to, and its other launches. */
  socials?: Array<{ social: { url: string; label: string }; launches: number; fastDumps: number; creators?: number }>;
  /** Earlier launches under the same ticker in the node's memory, this one left out. */
  ticker?: { days: number; launches: number; devs: number; dumped: number; graduated: number; firstAt: number | null } | null;
  funding: Funding | null;
  bundle: { wallets: Array<{ wallet: string; share: number }>; funding: { groups: Array<{ funder: string; wallets: string[] }>; linked: number; checked: number } | null };
  /** Launched before the stream's window: no launch record, only who holds it now and the dev's kept record. */
  outsideStream?: boolean;
  /** Trades in a pool opened straight on PumpSwap that the node read from its own transactions; the launchpad stream never saw it. */
  pool?: { pool: string; solIn: number; trades: number; sample: { n: number; passes: number }; taken: { sol: number; at: number } | null; creatorPools: number; creatorTaken: number };
  /** Read from the long memory, as it stood when last written, not from the live tape. */
  fromHistory?: boolean;
  /** When the coin was made and its pool opened, and whether it was read from the chain on demand (launched before the stream watched). */
  birth?: { poolOpenedAt: number; mintCreatedAt: number | null; adopted: boolean; adoptedAt: number | null };
  devHistory?: { launches: number; dumped: number } | null;
  /** Posts on X naming the token, oldest first, as the extension saw them. */
  mentions?: Array<{ handle: string; url: string; postAt: number }>;
  /** What this reader may open: the tier the node served the report at, and its rate limits. */
  access?: Access;
}

export interface Access {
  tier: "free" | "pro" | (string & {});
  perMinute?: number;
  deepPerMinute?: number;
  /** When a paid pass ends, ms since epoch. */
  until?: number | null;
}
