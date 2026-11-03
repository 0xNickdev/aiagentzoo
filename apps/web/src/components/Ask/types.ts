import type { LaunchOutcome } from "../../outcome";

export type Verdict = "promising" | "watch" | "suspicious";
export type Outcome = "dead" | "alive" | "unknown";

export interface Chain {
  ageMin: number;
  buys: number;
  sells: number;
  buyers: number;
  buyersMore?: boolean;
  creatorSold: number | null;
  creatorLaunches24h: number;
  top5Share: number | null;
  repeatBuyers: number;
}

export interface CreatorRecord {
  wallet: string;
  launches24h: number;
  launches48h: number;
  dumped: number;
  medianDumpMin: number | null;
  graduated: number;
  recent: Array<{ mint: string; symbol: string; createdAt: number } & LaunchOutcome>;
}

export interface CleanLaunch {
  mint: string;
  symbol: string;
  name: string;
  ageMin: number;
  buyers: number;
  buyersMore?: boolean;
  repeatBuyers: number;
  top5Share: number | null;
  creatorSold: number | null;
}

/** The nursery's vote on the same facts: each judge by its own DNA, weighed by its graded record. */
export interface Council {
  verdict: Verdict;
  lean: number;
  votes: Array<{ id: string; name: string; house: string; verdict: Verdict; why: string; weight: number }>;
}

export interface Ask {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  at: number;
  verdict: Verdict;
  confidence: number;
  why: string;
  whyZh?: string;
  by: "model" | "rules";
  playbookVersion: number;
  council?: Council | null;
  already: boolean;
  facts: {
    graduated: boolean;
    hasSocials: boolean | null;
    market: { liquidityUsd: number | null; volume24hUsd: number | null; priceChange24h: number | null; buys24h: number; sells24h: number; dex: string | null } | null;
    chain: Chain | null;
    creator?: CreatorRecord | null;
    bundle?: { wallets: number; share: number; linked: number; funder: string | null } | null;
    holders?: { top10Share: number; topShare: number; programShare: number; creator: string | null; creatorShare: number | null } | null;
    flags: string[];
    url: string | null;
  };
  graded?: { at: number; outcome: Outcome; hit: boolean | null };
}

export interface Recent {
  asked: number;
  record: { graded: number; skill: number | null; dead: number; deadRight: number; alive: number; aliveRight: number };
  asks: Ask[];
}
