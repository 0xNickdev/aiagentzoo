import { appendFileSync, readFileSync } from "node:fs";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { curveCap } from "./radar.ts";

/**
 * Runner radar v2, paper only: a logistic model on real graduation, scored on each 20-minute reading (with the same
 * coin's 5-minute reading and its long-memory history), trained offline on 13-25 Nov (radar2/train.py, G20). Picks
 * over the trained threshold (about ten a day) go to radar-v2.jsonl with the cap at the signal, and 25 s later the cap
 * a real entry would have paid, so the paper record is honest. Nothing here is served or shown.
 */

export interface V2Model {
  cols: string[];
  med: number[];
  mu: number[];
  sd: number[];
  w: number[];
  b: number;
  threshold: number;
}

export const V2: V2Model = JSON.parse(readFileSync(new URL("./radar-v2-model.json", import.meta.url), "utf8")) as V2Model;

/** A reading as marks.ts writes it: the fields v2 reads. */
export interface V2Row {
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
  bundlers: number | null;
  bundlersHeldPct: number | null;
  bundlersPeakPct: number | null;
  bundledSol: number | null;
}

/** Point-in-time history, as build.js counts it: outcomes of earlier coins only once they are 6 h old. */
export interface V2History {
  eN: number;
  bN: number;
  eKnown: number;
  eSmart: number;
  eDump: number;
  eRR: number | null;
  eDR: number | null;
  bDump: number;
  cN: number;
  cK: number;
  cR: number;
  cD: number;
  cG: number;
  fN: number | null;
  fK: number | null;
  fR: number | null;
  fD: number | null;
}

/** Outcomes of an earlier coin count from this long after its launch, as in training. */
const HISTORY_DELAY_MS = 6 * 3_600_000;
/** A pick's real entry: the cap 25 s after the signal. */
export const ENTRY_DELAY_MS = 25_000;
/** A wallet's record moves slowly next to a 6 h delay: kept for an hour. */
const WALLET_CACHE_MS = 3_600_000;

const L = (v: number | null | undefined) => Math.log1p(Math.max(v || 0, 0));
const num = (v: number | null | undefined) => (v === null || v === undefined ? NaN : v);

/** feats5 + feats20 of train.py, value for value. NaN where training had a missing value (filled with the median). */
export function featuresV2(r: V2Row, m: V2Row, h: V2History): Record<string, number> {
  const s = r.curveSol || 0;
  const si = r.solIn || 0;
  const by = r.buyers || 0;
  const bu = r.buys || 0;
  const se = r.sells || 0;
  const out = Math.max(si - s, 0);
  const s20 = m.curveSol || 0;
  const si20 = m.solIn || 0;
  return {
    buyers: L(by), buys: L(bu), sells: L(se), solIn: L(si), curveSol: s, c5: Math.log(curveCap(s)),
    top5: num(r.top5BuyingPct), churn: num(r.churnPct), devSold: num(r.creatorSoldPct), earlyHeld: num(r.earlyHeldPct),
    bundPeak: num(r.bundlersPeakPct), bundHeld: num(r.bundlersHeldPct), bundlers: num(r.bundlers), bundSol: L(r.bundledSol),
    solPerBuyer: si / Math.max(by, 1), solPerBuy: si / Math.max(bu, 1), buyersPerTrade: by / Math.max(bu + se, 1),
    sellShareTrades: se / Math.max(bu + se, 1), outInRatio: out / Math.max(si, 1e-9), netPerBuyer: s / Math.max(by, 1),
    curveVsIn: s / Math.max(si, 1e-9),
    eN: h.eN, bN: h.bN, eKnownSh: h.eKnown / Math.max(h.eN, 1), eSmart: h.eSmart, eDump: h.eDump,
    eRR: num(h.eRR), eDR: num(h.eDR), bDump: h.bDump,
    cN: L(h.cN), cRrate: h.cK ? h.cR / h.cK : NaN, cDrate: h.cK ? h.cD / h.cK : NaN, cG: Math.min(h.cG, 3),
    fN: h.fN === null ? NaN : L(h.fN), fRrate: h.fK ? h.fR! / h.fK : NaN, fDrate: h.fK ? h.fD! / h.fK : NaN,
    m20buyers: L(m.buyers), m20solIn: L(m.solIn), m20curve: s20, m20top5: num(m.top5BuyingPct), m20churn: num(m.churnPct),
    m20devSold: num(m.creatorSoldPct), m20earlyHeld: num(m.earlyHeldPct), m20bundHeld: num(m.bundlersHeldPct),
    dBuyers: L(m.buyers) - L(r.buyers), dSolIn: L(m.solIn) - L(r.solIn), dCurve: s20 - (r.curveSol || 0),
    accel: (si20 - si) / 15 / Math.max(si / 5, 0.1),
    m20outIn: Math.max(si20 - s20, 0) / Math.max(si20, 1e-9), m20solPerBuyer: si20 / Math.max(m.buyers || 1, 1),
  };
}

/** The logit and probability: missing values take the training median, then standardised, as StandardScaler did. */
export function scoreV2(model: V2Model, f: Record<string, number>): { z: number; p: number } {
  let z = model.b;
  model.cols.forEach((c, j) => {
    const v = f[c];
    const x = v === undefined || Number.isNaN(v) ? model.med[j]! : v;
    z += ((x - model.mu[j]!) / model.sd[j]!) * model.w[j]!;
  });
  return { z, p: 1 / (1 + Math.exp(-z)) };
}

export interface V2Pick {
  kind: "pick";
  mint: string;
  symbol: string;
  at: number;
  createdAt: number;
  capAtSignal: number;
  p: number;
  z: number;
}

type WalletStat = { k: number; r: number; d: number; at: number };

export class RadarV2 {
  /** Each coin's 5-minute reading, until its 20-minute one comes (or half an hour passes). */
  private m5 = new Map<string, V2Row>();
  private q: Record<string, StatementSync> = {};
  private wallets = new Map<string, WalletStat>();
  picks = 0;

  private readonly file: string | null;
  private readonly db: DatabaseSync | null;
  private readonly capNow: (mint: string) => number | null;
  private readonly model: V2Model;
  private readonly later: (fn: () => void, ms: number) => unknown;

  constructor(
    file: string | null,
    db: DatabaseSync | null,
    capNow: (mint: string) => number | null,
    model: V2Model = V2,
    later: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms).unref(),
  ) {
    this.file = file;
    this.db = db;
    this.capNow = capNow;
    this.model = model;
    this.later = later;
  }

  private stmts() {
    if (!this.db) return null;
    const p = (sql: string) => this.db!.prepare(sql);
    const run = `(graduated_at IS NOT NULL OR coalesce(cap_peak, 0) >= 1000)`;
    const dump = `(dev_dumped_at IS NOT NULL AND dev_dumped_at - created_at <= 600000)`;
    if (!this.q.token) {
      this.q.token = p("SELECT id, creator_id, created_at, funder FROM tokens WHERE mint = ?");
      this.q.creatorN = p("SELECT count(*) n FROM tokens WHERE creator_id = ? AND created_at < ?");
      this.q.creator = p(`SELECT count(*) k, coalesce(sum(${run}), 0) r, coalesce(sum(${dump}), 0) d, count(graduated_at) g FROM tokens WHERE creator_id = ? AND created_at <= ?`);
      this.q.funderN = p("SELECT count(*) n FROM tokens WHERE funder = ? AND created_at < ?");
      this.q.funder = p(`SELECT count(*) k, coalesce(sum(${run}), 0) r, coalesce(sum(${dump}), 0) d FROM tokens WHERE funder = ? AND created_at <= ?`);
      this.q.roles = p("SELECT wallet_id w, role FROM wallet_tokens WHERE token_id = ? AND role IN (1, 2)");
      this.q.wallet = p(`SELECT count(*) k, coalesce(sum(${run.replaceAll("graduated_at", "t.graduated_at").replaceAll("cap_peak", "t.cap_peak")}), 0) r,
        coalesce(sum(t.dev_dumped_at IS NOT NULL AND t.dev_dumped_at - t.created_at <= 600000), 0) d
        FROM wallet_tokens wt JOIN tokens t ON t.id = wt.token_id WHERE wt.wallet_id = ? AND wt.role = 1 AND t.created_at <= ?`);
    }
    return this.q;
  }

  private walletStat(w: number, cut: number, now: number): WalletStat {
    const key = String(w);
    const c = this.wallets.get(key);
    if (c && now - c.at < WALLET_CACHE_MS) return c;
    const r = this.q.wallet!.get(w, cut) as { k: number; r: number; d: number };
    const s = { k: Number(r.k), r: Number(r.r), d: Number(r.d), at: now };
    this.wallets.set(key, s);
    if (this.wallets.size > 200_000) for (const [k, v] of this.wallets) if (now - v.at >= WALLET_CACHE_MS) this.wallets.delete(k);
    return s;
  }

  /** The long-memory half, as build.js reads it; null when the store never kept the token. */
  history(mint: string, now = Date.now()): V2History | null {
    const s = this.stmts();
    if (!s) return null;
    const t = s.token!.get(mint) as { id: number; creator_id: number; created_at: number; funder: string | null } | undefined;
    if (!t) return null;
    const cut = t.created_at - HISTORY_DELAY_MS;
    const c = s.creator!.get(t.creator_id, cut) as { k: number; r: number; d: number; g: number };
    const cN = Number((s.creatorN!.get(t.creator_id, t.created_at) as { n: number }).n);
    let f: { n: number; k: number; r: number; d: number } | null = null;
    if (t.funder) {
      const a = s.funder!.get(t.funder, cut) as { k: number; r: number; d: number };
      f = { n: Number((s.funderN!.get(t.funder, t.created_at) as { n: number }).n), k: Number(a.k), r: Number(a.r), d: Number(a.d) };
    }
    const roles = s.roles!.all(t.id) as Array<{ w: number; role: number }>;
    let eN = 0, bN = 0, eKnown = 0, eSmart = 0, eDump = 0, eRR = 0, eDR = 0, bDump = 0;
    for (const { w, role } of roles) {
      const st = this.walletStat(Number(w), cut, now);
      if (Number(role) === 1) {
        eN++;
        if (!st.k) continue;
        eKnown++;
        eRR += st.r / st.k;
        eDR += st.d / st.k;
        if (st.k >= 3 && st.r / st.k >= 0.2) eSmart++;
        if (st.k >= 5 && st.d / st.k >= 0.8) eDump++;
      } else {
        bN++;
        if (st.k >= 5 && st.d / st.k >= 0.8) bDump++;
      }
    }
    return {
      eN, bN, eKnown, eSmart, eDump, eRR: eKnown ? eRR / eKnown : null, eDR: eKnown ? eDR / eKnown : null, bDump,
      cN, cK: Number(c.k), cR: Number(c.r), cD: Number(c.d), cG: Number(c.g),
      fN: f ? f.n : null, fK: f ? f.k : null, fR: f ? f.r : null, fD: f ? f.d : null,
    };
  }

  /** Every reading passes by; only a 20-minute one, with its 5-minute one kept, is scored. */
  consider(x: V2Row, info: { symbol: string; skip?: boolean }, now = Date.now()): V2Pick | null {
    if (x.min === 5) {
      if (!info.skip && !x.graduated) this.m5.set(x.mint, x);
      for (const [k, v] of this.m5) if ((x.at ?? now) - v.at > 30 * 60_000) this.m5.delete(k);
      return null;
    }
    if (x.min !== 20) return null;
    const r5 = this.m5.get(x.mint);
    this.m5.delete(x.mint);
    if (!r5 || x.graduated || info.skip) return null;
    const h = this.history(x.mint, now);
    if (!h) return null;
    const { z, p } = scoreV2(this.model, featuresV2(r5, x, h));
    if (p < this.model.threshold) return null;
    const pick: V2Pick = { kind: "pick", mint: x.mint, symbol: info.symbol, at: x.at ?? now, createdAt: x.createdAt, capAtSignal: Math.round(curveCap(x.curveSol) * 10) / 10, p, z: Math.round(z * 1000) / 1000 };
    this.picks++;
    this.append(pick);
    // The cap a buyer 25 s behind the signal pays, read off the tape then: the paper record's entry.
    this.later(() => {
      let cap: number | null = null;
      try {
        cap = this.capNow(pick.mint);
      } catch {
        /* no cap: the line says so */
      }
      this.append({ kind: "entry", mint: pick.mint, at: pick.at + ENTRY_DELAY_MS, capAtEntry: cap === null ? null : Math.round(cap * 10) / 10, x: cap === null ? null : Math.round((cap / pick.capAtSignal) * 1000) / 1000 });
    }, ENTRY_DELAY_MS);
    return pick;
  }

  private append(line: object) {
    if (!this.file) return;
    try {
      appendFileSync(this.file, `${JSON.stringify(line)}\n`);
    } catch {
      /* paper only */
    }
  }
}
