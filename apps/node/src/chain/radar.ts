import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { type Organic, organicOf } from "./organic.ts";
import type { WalletQuality } from "./wallet-quality.ts";

/**
 * The runner radar: the logistic models frozen on 21 Nov 2026 (the silent trial on the VPS, ~/runner-trial), scored
 * live on each 5-minute reading the node writes to chain-marks.jsonl. Inputs, transforms and thresholds are exactly
 * those of trial.js, so a coin the radar flags is a coin the public grading counts the same way.
 */

export interface RadarModel {
  w: number[];
  mu: number[];
  sd: number[];
  top1: number;
  top05: number;
  base: number;
}
export interface Frozen {
  frozenAt: number;
  smartWallets: number[];
  models: Record<"RB" | "G" | "R3" | "R10", RadarModel>;
}

export const FROZEN: Frozen = JSON.parse(readFileSync(new URL("./radar-model.json", import.meta.url), "utf8")) as Frozen;
const SMART = new Set(FROZEN.smartWallets);

/** A 5-minute reading as marks.ts writes it (only the fields the models read). */
export interface MarkRow {
  mint: string;
  min: number;
  at: number;
  createdAt: number;
  graduated: boolean | null;
  buyers: number | null;
  buys: number | null;
  sells: number | null;
  curveSol: number | null;
  solIn: number | null;
  top5BuyingPct: number | null;
  churnPct: number | null;
  creatorSoldPct: number | null;
  earlyHeldPct: number | null;
  bundlersPeakPct: number | null;
  bundledSol: number | null;
}

/** What the long memory adds: the creator's earlier launches and how many graduated, and the first-second wallet ids. */
export interface Lookup {
  prior: number;
  priorG: number;
  early: number[];
}

export interface Features {
  buyers: number;
  buys: number;
  sells: number;
  solIn: number;
  c5: number;
  top5: number;
  churn: number;
  devSold: number;
  earlyHeld: number;
  bundPeak: number;
  bundSol: number;
  prior: number;
  priorG: number;
  smart: number;
  earlyN: number;
}

/** pump.fun's curve: the cap in SOL from the SOL in it (30 SOL virtual at the start). Same as trial.js. */
export const curveCap = (s: number | null) => (30 + (s || 0)) ** 2 / 32.19;

// trial.js does arithmetic on the raw JSON values, where a null counts as 0; the casts keep that, on purpose.
const n = (v: number | null) => v as number;

export function featuresOf(x: MarkRow, l: Lookup): Features {
  return {
    buyers: n(x.buyers),
    buys: n(x.buys),
    sells: n(x.sells),
    solIn: n(x.solIn),
    c5: curveCap(x.curveSol),
    top5: n(x.top5BuyingPct),
    churn: n(x.churnPct),
    devSold: n(x.creatorSoldPct),
    earlyHeld: n(x.earlyHeldPct),
    bundPeak: n(x.bundlersPeakPct),
    bundSol: n(x.bundledSol),
    prior: l.prior,
    priorG: l.priorG,
    smart: l.early.filter((w) => SMART.has(w)).length,
    earlyN: l.early.length,
  };
}

/** The design row, transform for transform as in trial.js. */
export const fx = (f: Features) => [
  1,
  Math.log1p(f.buyers),
  Math.log1p(f.buys),
  Math.log1p(f.sells),
  Math.log1p(f.solIn),
  Math.log(f.c5),
  f.top5 / 100,
  f.churn / 100,
  f.devSold / 100,
  f.earlyHeld / 100,
  f.bundPeak / 100,
  Math.log1p(f.bundSol),
  Math.log1p(f.prior),
  Math.min(f.priorG, 3),
  f.prior === 0 ? 1 : 0,
  Math.min(f.smart, 5),
  Math.log1p(f.earlyN),
];

/** Each term's part in the score: weight times the standardised value (the intercept first). */
export const contributions = (m: RadarModel, f: Features) => fx(f).map((v, j) => (j ? (v - m.mu[j]!) / m.sd[j]! : 1) * m.w[j]!);
export const scoreOf = (m: RadarModel, f: Features) => contributions(m, f).reduce((a, v) => a + v, 0);

const pct = (v: number) => `${Math.round(v)}%`;
const sol = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1));

/** A term in plain words, read as it pushed the score up: `high` when the value sat above the average launch. */
function phrase(j: number, f: Features, high: boolean): string | null {
  switch (j) {
    case 1: return high ? `${f.buyers} buyers in 5 minutes` : `${f.buys} buys from just ${f.buyers} buyers`;
    case 2: return high ? `${f.buys} buys in 5 minutes` : `${f.buys} buys in 5 minutes, a quiet start`;
    case 3: return high ? `${f.sells} sells, plenty of trading` : `only ${f.sells} sells so far`;
    case 4: return `${sol(f.solIn)} SOL in`;
    case 5: return `${sol(f.c5)} SOL cap at 5 minutes`;
    case 6: return high ? `top 5 buyers took ${pct(f.top5)}` : `top 5 buyers took only ${pct(f.top5)}`;
    case 7: return high ? `${pct(f.churn)} of buyers already out` : `few buyers out yet (${pct(f.churn)})`;
    case 8: return high ? `dev sold ${pct(f.devSold)}` : f.devSold <= 0 ? "dev has not sold" : `dev sold only ${pct(f.devSold)}`;
    case 9: return high ? `early wallets still hold ${pct(f.earlyHeld)}` : f.earlyHeld <= 0 ? "early wallets hold nothing" : `early wallets hold only ${pct(f.earlyHeld)}`;
    case 10: return f.bundPeak <= 0 ? "no bundles holding" : high ? `bundles peaked at ${pct(f.bundPeak)}` : `bundles peaked at only ${pct(f.bundPeak)}`;
    case 11: return f.bundSol <= 0 ? "no SOL bundled at launch" : `${sol(f.bundSol)} SOL bundled at launch`;
    case 12: return f.prior === 0 ? "the dev's first launch" : `the dev launched ${f.prior} coins before`;
    case 13: return f.priorG > 0 ? `the dev graduated ${f.priorG} before` : "the dev never graduated a coin";
    case 14: return f.prior === 0 ? "the dev's first launch" : null;
    case 15: return f.smart > 0 ? `${f.smart} early wallet${f.smart === 1 ? "" : "s"} with a runner record` : null;
    case 16: return high ? `${f.earlyN} first-second wallets` : `only ${f.earlyN} first-second wallets`;
    default: return null;
  }
}

/** The three terms that lifted the score most, in words; duplicates (first launch twice) said once. */
export function reasonsOf(m: RadarModel, f: Features, k = 3): string[] {
  const x = fx(f);
  const parts = contributions(m, f).map((c, j) => ({ c, j })).filter((p) => p.j > 0 && p.c > 0).sort((a, b) => b.c - a.c);
  const out: string[] = [];
  for (const { j } of parts) {
    const s = phrase(j, f, x[j]! > m.mu[j]!);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= k) break;
  }
  return out;
}

export type Tier = "strong" | "watch";
export interface Scored {
  scores: { RB: number; G: number };
  tier: Tier | null;
  models: Array<"RB" | "G">;
}

/** RB and G against their frozen cut-offs: top 0.5% of either is strong, top 1% of either a watch. */
export function judge(f: Features, frozen: Frozen = FROZEN): Scored {
  const scores = { RB: scoreOf(frozen.models.RB, f), G: scoreOf(frozen.models.G, f) };
  const strong = (["RB", "G"] as const).filter((k) => scores[k] >= frozen.models[k].top05);
  const watch = (["RB", "G"] as const).filter((k) => scores[k] >= frozen.models[k].top1);
  if (strong.length) return { scores, tier: "strong", models: strong };
  if (watch.length) return { scores, tier: "watch", models: watch };
  return { scores, tier: null, models: [] };
}

/* ----- the live radar ----- */

export interface Outcome {
  /** The highest cap seen since the signal, in SOL, and that over the cap at the signal. */
  peakCap: number;
  peakX: number;
  graduated: boolean;
  checkedAt: number;
  /** The cap 1, 2, 6 and 24 hours after the signal (after the confirmation once confirmed), SOL; null when the coin had left the tape. Added 28 Nov. */
  capAt1h?: number | null;
  capAt2h?: number | null;
  capAt6h?: number | null;
  capAt24h?: number | null;
}

/** The checkpoints after the signal at which the cap is written down once. */
export const CAP_AFTER = [["capAt1h", 1], ["capAt2h", 2], ["capAt6h", 6], ["capAt24h", 24]] as const;

/**
 * A signal fires at minute five as a candidate and is confirmed at minute twenty, or not: the coin must be up at least
 * 20% since minute five (or have graduated by then) and the dev must not have sold half. Old lines carry no stage and
 * are candidates.
 */
export type Stage = "candidate" | "confirmed" | "rejected";
export const CONFIRM_UP = 1.2;
export const CONFIRM_DEV_SOLD = 50;
/** A coin graduated by minute twenty confirms only on a live pool: at least this much SOL left in it. */
export const CONFIRM_POOL_SOL = 40;

/** What the minute-20 reading says, for the confirmation. */
export interface At20 {
  /** The cap at minute twenty, SOL (for a coin graduated by then, its cap at that time). */
  cap: number | null;
  graduated: boolean;
  devSold: number | null;
  /** SOL in the PumpSwap pool, for a coin graduated by then. */
  poolSol?: number | null;
}

/**
 * The confirmation rule: up 20% since minute five and the dev sold less than half. A coin graduated by then is read
 * on its pool: the cap from the pool price must be up 20% too, and the pool must still hold 40 SOL (not drained).
 */
export function confirms(capAt5: number, m: At20): boolean {
  if ((m.devSold ?? 0) >= CONFIRM_DEV_SOLD) return false;
  if (m.cap == null || m.cap < CONFIRM_UP * capAt5) return false;
  if (m.graduated) return m.poolSol != null && m.poolSol >= CONFIRM_POOL_SOL;
  return true;
}

/** Where a graduated coin's market stands: the cap from the pool's last price and the SOL left in the pool. */
export type Market = (mint: string) => { cap: number | null; poolSol: number | null } | null;

/** A minute-20 mark line as the backfill hands it over (the fields the rule reads). */
export interface Mark20 {
  mint: string;
  at: number;
  curveSol: number | null;
  graduated: boolean | null;
  creatorSoldPct: number | null;
  /** The live minute-20 reading also carries these, for the organic label (the backfill does not). */
  buyers?: number | null;
  buys?: number | null;
  sells?: number | null;
  solIn?: number | null;
  solOut?: number | null;
  creatorFeesSol?: number | null;
}

/** What the main thread adds to a minute-20 reading from the tape: how many of the first 30 buyers still hold. */
export interface At20Extra {
  held30?: { held: number; of: number } | null;
  /** Of the first 30 buyers with a traced first transaction, how many made it under a day before buying. */
  chainAge?: { fresh: number; known: number } | null;
}

export interface Signal {
  mint: string;
  symbol: string;
  /** The minute-five reading that made it a candidate. */
  at: number;
  createdAt: number;
  /** The entry shown: the cap at minute five for a candidate, at minute twenty once confirmed. */
  capAtSignal: number;
  /** The cap at minute five, kept once confirmed. */
  capAt5?: number;
  stage?: Stage;
  /** When the minute-20 reading confirmed it. */
  confirmedAt?: number;
  /** The cap at minute twenty over the cap at minute five. */
  upX?: number;
  /** Confirmed under the first rule on a graduation alone, with no pool reading: to be restaged. Not served. */
  unverifiedGrad?: boolean;
  /** The original tier, a label only once confirmed. */
  tier: Tier;
  models: Array<"RB" | "G">;
  scores: { RB: number; G: number };
  reasons: string[];
  /** Buys and sells at minute five, for the sell ramp of the organic label. */
  at5?: { buys: number | null; sells: number | null };
  /** The organic label from the minute-20 reading: a label only, nothing is hidden by it. */
  organic?: Organic;
  /** How seasoned the first 30 buyers were (history.db, read at minute five in the worker), plus on-chain age where traced. */
  wallets?: WalletQuality & { chainFresh?: number; chainKnown?: number };
  outcome?: Outcome;
}

const DAY = 24 * 3_600_000;
const KEEP_MS = 7 * DAY;
/** A signal is counted in the record once it is this old: a day is long enough for a pump.fun coin to have run or died. */
export const SETTLED_MS = DAY;
/** What a caller without the holder pass sees: signals at least this old. */
export const PUBLIC_DELAY_MS = 60 * 60_000;

/**
 * Counts the 5-minute readings the radar would have scored since `since`, reading chain-marks.jsonl backwards in
 * chunks so a file of a gigabyte costs only today's tail. A line is a reading of minute five that had not graduated.
 */
export function countMarksSince(file: string, since: number, chunk = 1 << 20): number {
  if (!existsSync(file)) return 0;
  const fd = openSync(file, "r");
  try {
    let pos = fstatSync(fd).size;
    let rest = "";
    let n = 0;
    while (pos > 0) {
      const len = Math.min(chunk, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, pos);
      const lines = (buf.toString("utf8") + rest).split("\n");
      // The first piece may be half a line; it is kept for the next chunk unless the file starts here.
      rest = pos > 0 ? lines.shift()! : "";
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line) continue;
        let x: { min?: number; at?: number; graduated?: boolean | null };
        try {
          x = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof x.at !== "number") continue;
        if (x.at < since) return n;
        if (x.min === 5 && !x.graduated) n++;
      }
    }
    return n;
  } finally {
    closeSync(fd);
  }
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The live store: scores readings, keeps the last week of signals in memory, and writes every signal and outcome to a JSONL file. */
export class Radar {
  private list: Signal[] = [];
  /** Readings scored today (UTC), signal or not: the page says how many coins the radar looked at. */
  scored = { day: "", n: 0 };
  private byMint = new Map<string, Signal>();
  private q: { token?: StatementSync; prior?: StatementSync; early?: StatementSync; peak?: StatementSync } = {};

  private readonly file: string | null;
  private dayFile: string | null = null;
  private dayWritten = 0;
  private readonly db: DatabaseSync | null;
  private readonly frozen: Frozen;

  /** The tape's pool market now, for a coin that graduated before its minute-20 reading (the curve says nothing then). */
  private readonly capNow: Market | null;

  constructor(file: string | null, db: DatabaseSync | null, frozen: Frozen = FROZEN, capNow: Market | null = null) {
    this.file = file;
    this.db = db;
    this.frozen = frozen;
    this.capNow = capNow;
  }

  /** Reads the file back: signal lines, then outcome lines that update them. Only the last week stays in memory. */
  load(now = Date.now()): number {
    if (!this.file || !existsSync(this.file)) return 0;
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (!line) continue;
      let x: (Signal & { kind?: undefined }) | ({ kind: "outcome"; mint: string } & Outcome) | StageLine;
      try {
        x = JSON.parse(line);
      } catch {
        continue;
      }
      if (x.kind === "outcome") {
        const s = this.byMint.get(x.mint);
        if (s) {
          s.outcome = { peakCap: x.peakCap, peakX: x.peakX, graduated: x.graduated, checkedAt: x.checkedAt };
          for (const [k] of CAP_AFTER) if (x[k] !== undefined) s.outcome[k] = x[k];
        }
      } else if (x.kind === "stage") {
        const s = this.byMint.get(x.mint);
        if (s) applyStage(s, x);
      } else if ((x as { kind?: string }).kind === "quality") {
        const q = x as unknown as { mint: string; q: WalletQuality };
        const s = this.byMint.get(q.mint);
        if (s && !s.wallets) s.wallets = q.q;
      } else if (now - x.at <= KEEP_MS && !this.byMint.has(x.mint)) {
        x.stage ??= "candidate";
        x.capAt5 ??= x.capAtSignal;
        this.list.push(x);
        this.byMint.set(x.mint, x);
      }
    }
    this.list.sort((a, b) => b.at - a.at);
    return this.list.length;
  }

  /**
   * Brings back today's scored count after a restart: from the small day file when it is today's, else counted from
   * the marks file. From then on every scored reading updates the day file (at most every 5 seconds).
   */
  restoreDay(dayFile: string, marksFile: string | null, now = Date.now()): number {
    this.dayFile = dayFile;
    const day = utcDay(now);
    let n = 0;
    try {
      const x = JSON.parse(readFileSync(dayFile, "utf8")) as { day?: string; n?: number };
      if (x.day === day && typeof x.n === "number") n = x.n;
    } catch {
      /* no day file yet */
    }
    if (!n && marksFile) {
      try {
        n = countMarksSince(marksFile, Date.parse(day));
      } catch {
        /* the count starts from zero */
      }
    }
    this.scored = { day, n: Math.max(n, this.scored.day === day ? this.scored.n : 0) };
    this.saveDay(now, true);
    return this.scored.n;
  }

  private saveDay(now: number, force = false) {
    if (!this.dayFile || (!force && now - this.dayWritten < 5_000)) return;
    this.dayWritten = now;
    try {
      writeFileSync(`${this.dayFile}.tmp`, JSON.stringify(this.scored));
      renameSync(`${this.dayFile}.tmp`, this.dayFile);
    } catch {
      /* the count is still served from memory */
    }
  }

  /** When the newest confirmed signal fired, held back nothing: the page says how long ago, without naming the coin. */
  lastSignalAt(): number | null {
    return this.signals(Number.MAX_SAFE_INTEGER)[0]?.confirmedAt ?? null;
  }

  /** Confirmed signals since midnight UTC. */
  todayCount(now = Date.now()): number {
    const mid = Date.parse(utcDay(now));
    return this.list.filter((s) => s.stage === "confirmed" && s.confirmedAt! >= mid).length;
  }

  private stmts() {
    if (!this.db) return null;
    const p = (sql: string) => this.db!.prepare(sql);
    this.q.token ??= p("select id,creator_id,created_at from tokens where mint=?");
    this.q.prior ??= p("select count(*) n, count(graduated_at) g from tokens where creator_id=? and created_at<?");
    this.q.early ??= p("select wallet_id w from wallet_tokens where token_id=? and role=1");
    this.q.peak ??= p("select cap_peak, cap_peak_at, graduated_at from tokens where mint=?");
    return this.q as Required<typeof this.q>;
  }

  /** The long-memory half of the inputs, read the same way as trial.js; null when the store never kept the token. */
  lookup(mint: string): Lookup | null {
    const s = this.stmts();
    if (!s) return null;
    const t = s.token.get(mint) as { id: number; creator_id: number; created_at: number } | undefined;
    if (!t) return null;
    const p = s.prior.get(t.creator_id, t.created_at) as { n: number; g: number };
    const early = (s.early.all(t.id) as Array<{ w: number }>).map((o) => Number(o.w));
    return { prior: Number(p.n), priorG: Number(p.g), early };
  }

  /**
   * One 5-minute reading. Coins the trial does not grade (graduated already, adopted, mayhem, non-SOL) never signal:
   * the caller passes `skip` for what the mark line does not say.
   */
  consider(x: MarkRow, info: { symbol: string; skip?: boolean } & At20Extra, now = Date.now()): Signal | null {
    if (x.min === 20) return this.confirm(x, true, info);
    if (x.min !== 5 || x.graduated || info.skip || this.byMint.has(x.mint)) return null;
    const l = this.lookup(x.mint);
    if (!l) return null;
    const f = featuresOf(x, l);
    const j = judge(f, this.frozen);
    const day = utcDay(now);
    if (this.scored.day !== day) this.scored = { day, n: 0 };
    this.scored.n++;
    this.saveDay(now);
    if (!j.tier) return null;
    // Reasons come from the model that fired hardest over its own cut-off.
    const lead = [...j.models].sort((a, b) => j.scores[b] - this.frozen.models[b].top1 - (j.scores[a] - this.frozen.models[a].top1))[0]!;
    const s: Signal = {
      mint: x.mint,
      symbol: info.symbol,
      at: x.at ?? now,
      createdAt: x.createdAt,
      capAtSignal: r1(f.c5),
      capAt5: r1(f.c5),
      stage: "candidate",
      tier: j.tier,
      models: j.models,
      scores: { RB: r3(j.scores.RB), G: r3(j.scores.G) },
      reasons: reasonsOf(this.frozen.models[lead], f),
      at5: { buys: x.buys, sells: x.sells },
    };
    this.list.unshift(s);
    this.byMint.set(s.mint, s);
    this.append(s);
    return s;
  }

  /**
   * The minute-20 reading of a candidate: confirmed or rejected, once, with a stage line in the file. Returns the
   * signal when it is confirmed. `live` reads the tape's cap for a coin graduated by then; the backfill cannot.
   */
  /** The wallet-quality read of a candidate's first buyers, from the worker: kept on the signal and in the file. */
  setQuality(mint: string, q: WalletQuality): void {
    const s = this.byMint.get(mint);
    if (!s || s.wallets) return;
    s.wallets = q;
    this.append({ kind: "quality", mint, q });
  }

  /** Whether this mint is a signal the radar keeps (any stage). */
  has(mint: string): boolean {
    return this.byMint.has(mint);
  }

  private confirm(x: Mark20, live: boolean, extra: At20Extra = {}): Signal | null {
    const s = this.byMint.get(x.mint);
    if (!s || (s.stage ?? "candidate") !== "candidate") return null;
    const graduated = Boolean(x.graduated);
    let cap: number | null = curveCap(x.curveSol);
    let poolSol: number | null = null;
    if (graduated) {
      // The curve's last cap is a placeholder once the coin is on its pool: only the pool's own price and SOL count.
      // The backfill has neither for that moment, so it leaves the candidate undecided rather than guess.
      if (!live || !this.capNow) return null;
      let m: ReturnType<Market> = null;
      try {
        m = this.capNow(x.mint);
      } catch {
        /* no market read */
      }
      cap = m?.cap ?? null;
      poolSol = m?.poolSol ?? null;
    }
    const capAt5 = s.capAt5 ?? s.capAtSignal;
    const ok = confirms(capAt5, { cap, graduated, devSold: x.creatorSoldPct, poolSol });
    let organic: Organic | null = null;
    if (live) {
      try {
        organic = organicOf({ buyers: x.buyers ?? null, buys: x.buys ?? null, sells: x.sells ?? null, solIn: x.solIn ?? null, solOut: x.solOut, creatorFeesSol: x.creatorFeesSol, buys5: s.at5?.buys, sells5: s.at5?.sells, held30: extra.held30, wallets: s.wallets });
        if (s.wallets && extra.chainAge) s.wallets = { ...s.wallets, chainFresh: extra.chainAge.fresh, chainKnown: extra.chainAge.known };
      } catch {
        /* the stage stands without a label */
      }
    }
    const line: StageLine = { kind: "stage", mint: s.mint, stage: ok ? "confirmed" : "rejected", at: x.at, capAt20: r1(cap ?? 0), devSold: x.creatorSoldPct, graduated, ...(graduated ? { poolSol: poolSol == null ? null : r1(poolSol) } : {}), ...(organic ? { organic } : {}), ...(s.wallets ? { wallets: s.wallets } : {}) };
    applyStage(s, line);
    this.append(line);
    return ok ? s : null;
  }

  /**
   * Signals confirmed under the first rule only because they graduated before minute twenty (stage lines without a
   * pool reading) go back to candidates, with a line saying so: their minute-20 pool was never read, so they are not
   * confirmed. Returns how many flipped.
   */
  restage(now = Date.now()): number {
    let n = 0;
    for (const s of this.list) {
      if (s.stage !== "confirmed" || !s.unverifiedGrad) continue;
      const line: StageLine = { kind: "stage", mint: s.mint, stage: "candidate", at: now, capAt20: 0, devSold: null, graduated: true };
      applyStage(s, line);
      this.append(line);
      n++;
    }
    return n;
  }

  /** Rebuilds the stage of candidates the node missed (a restart, older lines) from minute-20 marks the worker read. */
  backfill(rows: Mark20[]): number {
    let n = 0;
    for (const x of rows) if (this.confirm(x, false)) n++;
    return n;
  }

  private append(line: object) {
    if (!this.file) return;
    try {
      appendFileSync(this.file, `${JSON.stringify(line)}\n`);
    } catch {
      /* the signal is still served from memory */
    }
  }

  /**
   * Fills in what came after: the highest cap seen since the signal (the tape's current cap, sampled every call,
   * and the long memory's peak when it came after the signal) and whether it graduated. Old signals leave memory.
   * An outcome line is written when it changes, so a restart keeps the record.
   */
  refresh(capNow: (mint: string) => { cap: number | null; graduated: boolean } | null, now = Date.now()): void {
    this.list = this.list.filter((s) => {
      if (now - s.at <= KEEP_MS) return true;
      this.byMint.delete(s.mint);
      return false;
    });
    const s = this.stmts();
    for (const sig of this.list) {
      // A confirmed signal is measured from its minute-20 cap, a candidate from minute five.
      const from = sig.confirmedAt ?? sig.at;
      const o = sig.outcome ?? { peakCap: sig.capAtSignal, peakX: 1, graduated: false, checkedAt: 0 };
      // A settled signal two days on is no longer moving enough to read every minute.
      if (now - sig.at > 2 * DAY && sig.outcome && now - o.checkedAt < 3_600_000) continue;
      let peak = o.peakCap;
      let graduated = o.graduated;
      const live = capNow(sig.mint);
      if (live?.cap != null && live.cap > peak) peak = live.cap;
      if (live?.graduated) graduated = true;
      const h = s?.peak.get(sig.mint) as { cap_peak: number | null; cap_peak_at: number | null; graduated_at: number | null } | undefined;
      if (h?.cap_peak != null && h.cap_peak_at != null && h.cap_peak_at > from && h.cap_peak > peak) peak = h.cap_peak;
      if (h?.graduated_at != null && h.graduated_at > from) graduated = true;
      const next: Outcome = { peakCap: r1(peak), peakX: r1(peak / Math.max(sig.capAtSignal, 1e-9)), graduated, checkedAt: now };
      let marked = false;
      for (const [k, h] of CAP_AFTER) {
        if (o[k] !== undefined) next[k] = o[k];
        else if (now - from >= h * 3_600_000) {
          // Written once, at the first refresh past the checkpoint (a restart late by hours reads it late, not never).
          next[k] = live?.cap != null ? r1(live.cap) : null;
          marked = true;
        }
      }
      const changed = !sig.outcome || marked || next.peakCap !== o.peakCap || next.graduated !== o.graduated;
      sig.outcome = next;
      if (changed) this.append({ kind: "outcome", mint: sig.mint, ...next });
    }
  }

  get size() {
    return this.list.length;
  }

  /**
   * Confirmed signals newest confirmation first, or with "early" every minute-five candidate (any stage) newest first;
   * optionally only those at least `delayMs` old (from the confirmation, or from minute five for early).
   */
  signals(now = Date.now(), delayMs = 0, stage: "confirmed" | "early" = "confirmed"): Signal[] {
    if (stage === "early") return this.list.filter((s) => now - s.at >= delayMs);
    return this.list.filter((s) => s.stage === "confirmed" && now - s.confirmedAt! >= delayMs).sort((a, b) => b.confirmedAt! - a.confirmedAt!);
  }

  /** The record of settled confirmed signals (a day old or more): how many ran 2x and 5x past their cap at confirmation, graduated, and the median peak. */
  stats(now = Date.now()) {
    const done = this.list.filter((s) => s.stage === "confirmed" && now - s.confirmedAt! >= SETTLED_MS && s.outcome);
    const by = (tier?: Tier) => {
      const xs = done.filter((s) => !tier || s.tier === tier);
      const peaks = xs.map((s) => s.outcome!.peakX).sort((a, b) => a - b);
      return {
        n: xs.length,
        x2: xs.filter((s) => s.outcome!.peakX >= 2).length,
        x5: xs.filter((s) => s.outcome!.peakX >= 5).length,
        graduated: xs.filter((s) => s.outcome!.graduated).length,
        medianPeakX: peaks.length ? peaks[Math.floor(peaks.length / 2)]! : null,
      };
    };
    return { settledAfterHours: SETTLED_MS / 3_600_000, days: KEEP_MS / DAY, all: by(), strong: by("strong"), watch: by("watch") };
  }
}

/** A stage line in radar.jsonl: what the minute-20 reading decided. */
export interface StageLine {
  kind: "stage";
  mint: string;
  /** "candidate": a confirmation taken back (graduated before minute 20 with no pool reading). */
  stage: "confirmed" | "rejected" | "candidate";
  at: number;
  capAt20: number;
  devSold: number | null;
  graduated: boolean;
  /** SOL in the pool at minute twenty, on lines for a coin graduated by then (absent on the first rule's lines). */
  poolSol?: number | null;
  /** The organic label from the live minute-20 reading (added 28 Nov). */
  organic?: Organic;
  /** The wallet-quality aggregates as they stood at minute twenty, for the regrade. */
  wallets?: Signal["wallets"];
}

function applyStage(s: Signal, l: StageLine) {
  if (l.organic) s.organic = l.organic;
  if (l.wallets) s.wallets = l.wallets;
  if (l.stage === "rejected") {
    s.stage = "rejected";
    return;
  }
  const c5 = s.capAt5 ?? s.capAtSignal;
  if (l.stage === "candidate") {
    s.stage = "candidate";
    s.capAtSignal = c5;
    delete s.confirmedAt;
    delete s.upX;
    delete s.unverifiedGrad;
    delete s.outcome;
    return;
  }
  if (l.graduated && l.poolSol === undefined) s.unverifiedGrad = true;
  s.stage = "confirmed";
  s.capAt5 = c5;
  s.capAtSignal = l.capAt20;
  s.confirmedAt = l.at;
  s.upX = Math.round((l.capAt20 / Math.max(c5, 1e-9)) * 100) / 100;
  // The outcome starts again from the minute-20 cap.
  delete s.outcome;
}
