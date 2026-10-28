/**
 * The odds: what the first five minutes of a pump.fun launch say about the rest of it, as probabilities instead of a
 * label. Two logistic models fitted on 34,183 pump.fun launches (launched 24 to 48 hours before 2026-10-28, features as
 * they stood five minutes in, trained on the older half, checked on the newer):
 *
 * - run: the market cap climbs past 85 SOL (the line the zoo calls alive) after minute five. 2.7% of launches do.
 *   Ranking power on the held-out half: AUC 0.89, against 0.59 for the avoid/pass verdict alone. The top tenth by
 *   these odds ran 19.6% of the time.
 * - devDumps: a dev who has not dumped by minute five sells half the bag later. AUC 0.95.
 *
 * They are odds, not advice: a 20% run still dies four times out of five. Refit by scripts/calibrate when the market
 * moves; the date below says which fit this is.
 */

export const ODDS_FIT = "2026-10-28";

export interface OddsInputs {
  /** Trades still coming in five minutes after the launch. */
  still5: boolean;
  dumped5: boolean;
  devSold5: boolean;
  priorLaunches: number;
  priorDumped: number;
  priorGraduated: number;
  launchShare: number;
  devShare: number;
  buyers1m: number;
  buyers5: number;
  insiders: boolean;
  wash: number;
  crew2: boolean;
  ring3: boolean;
  social: boolean;
  mayhem: boolean;
  funderExchange: boolean;
  funderMany: boolean;
}

type Vec = Record<string, number>;

const RUN = { intercept: -4.5509, coef: { still5: 1.0635, dumped5: -1.5096, devSold5: 0.2266, logPrior: -0.4692, priorDumpShare: -0.492, priorGrad: 0.5685, bundle15: -0.0634, launchShare: 3.6616, devShare: 11.2021, logB1: -0.4147, logB5: 0.6745, insiders: 0.4176, wash: -2.1802, crew2: 0.5282, ring3: -0.2193, social: 0.5938, mayhem: 0.8704, funderEx: 0.3672, funderMany: -0.0821 } as Vec };
const DEV_DUMPS = { intercept: -1.7451, coef: { still5: 1.7846, dumped5: -7.9006, devSold5: -0.8198, logPrior: -0.1203, priorDumpShare: 3.083, priorGrad: -0.0079, bundle15: -2.4286, launchShare: 2.9102, devShare: 4.0896, logB1: 0.057, logB5: 0.0481, insiders: -0.6629, wash: -1.6454, crew2: -0.7616, ring3: -1.6221, social: 0.1288, mayhem: -0.1446, funderEx: 0.0953, funderMany: 0.9752 } as Vec };
/** The average launch, to say what moved the odds away from it. */
const MEAN: Vec = { still5: 0.2283, dumped5: 0.6233, devSold5: 0.6287, logPrior: 1.9437, priorDumpShare: 0.4461, priorGrad: 0.1293, bundle15: 0.1352, launchShare: 0.0495, devShare: 0.0336, logB1: 1.8012, logB5: 1.8887, insiders: 0.0027, wash: 0.0661, crew2: 0.0145, ring3: 0.0737, social: 0.0453, mayhem: 0.3766, funderEx: 0.216, funderMany: 0.2658 };
/** How often the average launch does it, for "N times the average". */
export const BASE_RUN = 0.027;

/** What each input says when it pushes the run odds, up or down. */
const SAYS: Record<string, [up: string, down: string]> = {
  still5: ["still trading five minutes in", "trading had stopped by minute five"],
  dumped5: ["the dev had not dumped by minute five", "the dev dumped in the first five minutes"],
  logPrior: ["the dev's first launch in two days", "the dev launched many coins before this one"],
  priorDumpShare: ["the dev's earlier coins were not dumped", "the dev dumped most of their earlier coins"],
  priorGrad: ["the dev graduated a coin before", ""],
  launchShare: ["much of the supply bought in the launch block", "little bought in the launch block"],
  devShare: ["the dev bought a big bag at launch", "the dev bought little or nothing"],
  logB5: ["many wallets bought in the first five minutes", "few wallets bought in the first five minutes"],
  wash: ["little churn", "much of the volume is the same wallets churning"],
  social: ["links an X account or Telegram", "no X or Telegram linked"],
  insiders: ["insiders still hold a quarter", ""],
};

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function vector(i: OddsInputs): Vec {
  return {
    still5: +i.still5,
    dumped5: +i.dumped5,
    devSold5: +i.devSold5,
    logPrior: Math.log1p(i.priorLaunches),
    priorDumpShare: i.priorDumped / (i.priorLaunches + 1),
    priorGrad: +(i.priorGraduated > 0),
    bundle15: +(i.launchShare >= 0.15),
    launchShare: Math.min(1, Math.max(0, i.launchShare)),
    devShare: Math.min(0.3, Math.max(0, i.devShare)),
    logB1: Math.log1p(i.buyers1m),
    logB5: Math.log1p(i.buyers5),
    insiders: +i.insiders,
    wash: i.wash,
    crew2: +i.crew2,
    ring3: +i.ring3,
    social: +i.social,
    mayhem: +i.mayhem,
    funderEx: +i.funderExchange,
    funderMany: +i.funderMany,
  };
}

const score = (m: { intercept: number; coef: Vec }, x: Vec) => sigmoid(Object.entries(m.coef).reduce((z, [k, w]) => z + w * (x[k] ?? 0), m.intercept));

export interface Odds {
  /** Chance the market cap climbs past 85 SOL after minute five, 0..1. */
  run: number;
  /** The run odds against the average launch's 2.7%. */
  vsAverage: number;
  /** Chance the dev still dumps, when they have not yet; null once they have. */
  devDumps: number | null;
  /** What moved the run odds most, the strongest first, each with its direction. */
  why: Array<{ says: string; up: boolean }>;
  /** Read as it stood five minutes in, or from what there is so far for a younger launch. */
  at: "5min" | "early";
  fit: string;
}

export function oddsOf(i: OddsInputs, at: Odds["at"]): Odds {
  const x = vector(i);
  const run = score(RUN, x);
  // A younger launch is trading by definition, so that is no reason; Mayhem's double supply skews caps, so it is none either.
  const pushes = Object.keys(SAYS)
    .filter((k) => !(at === "early" && k === "still5"))
    .map((k) => ({ k, d: (RUN.coef[k] ?? 0) * ((x[k] ?? 0) - (MEAN[k] ?? 0)) }))
    .filter((p) => Math.abs(p.d) >= 0.15)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .map((p) => ({ says: SAYS[p.k]![p.d > 0 ? 0 : 1], up: p.d > 0 }))
    .filter((p) => p.says)
    .slice(0, 4);
  return {
    run: Math.round(run * 1000) / 1000,
    vsAverage: Math.round((run / BASE_RUN) * 10) / 10,
    devDumps: i.dumped5 ? null : Math.round(score(DEV_DUMPS, x) * 100) / 100,
    why: pushes,
    at,
    fit: ODDS_FIT,
  };
}
