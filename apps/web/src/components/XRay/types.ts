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
}

export interface Odds {
  run: number;
  vsAverage: number;
  devDumps: number | null;
  why: Array<{ says: string; up: boolean }>;
  at: "5min" | "early";
  fit: string;
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
    bundlesSince?: number | null;
    graduated: boolean;
    poolSol?: number | null;
    curveSol?: number | null;
    mayhem?: boolean;
    venue?: "pump.fun" | "launchlab" | "dbc" | "fourmeme" | "flap" | "clanker";
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
  creatorRecord: ({ launches48h: number; dumped: number; medianDumpMin: number | null; recent?: Array<{ mint: string; symbol: string; createdAt: number } & LaunchOutcome> } & Habits) | null;
  /** The X account, X community or Telegram group the token links to, and its other launches. */
  socials?: Array<{ social: { url: string; label: string }; launches: number; fastDumps: number }>;
  /** Earlier launches under the same ticker in the node's memory, this one left out. */
  ticker?: { days: number; launches: number; devs: number; dumped: number; graduated: number; firstAt: number | null } | null;
  funding: Funding | null;
  bundle: { wallets: Array<{ wallet: string; share: number }>; funding: { groups: Array<{ funder: string; wallets: string[] }>; linked: number; checked: number } | null };
  /** Launched before the stream's window: no launch record, only who holds it now and the dev's kept record. */
  outsideStream?: boolean;
  /** Read from the long memory, as it stood when last written, not from the live tape. */
  fromHistory?: boolean;
  devHistory?: { launches: number; dumped: number } | null;
  /** Posts on X naming the token, oldest first, as the extension saw them. */
  mentions?: Array<{ handle: string; url: string; postAt: number }>;
}
