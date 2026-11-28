import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { confirms, curveCap, featuresOf, FROZEN, type Frozen, judge, type Mark20, type MarkRow, type Tier } from "./radar.ts";

/**
 * The radar's track record: every 5-minute reading since the freeze, scored by the frozen models the way trial.js
 * does, graded once it is 30 hours old against what the long memory says came after; plus the live signals in
 * radar.jsonl once a day old. A second record holds only the confirmed picks: the same minute-20 rule the live radar
 * applies (up 20% since minute five or graduated, dev sold under half), measured from the minute-20 cap, so the past
 * is recomputed the way the live radar now works. The marks file is read once from the start and then only from where it ended, so an
 * hourly update costs the last hour of readings and a few hundred lookups. Runs in the background worker.
 */

export const GRADE_AFTER_MS = 30 * 3_600_000;
export const LIVE_SETTLED_MS = 24 * 3_600_000;
/** A graduation counts when the coin also reached this cap (SOL): a curve filled and dumped at once is not a run. */
export const CLEAN_GRAD_CAP = 350;

export interface RecordRow {
  mint: string;
  symbol: string;
  /** When the radar would have said it (the 5-minute reading), ms. */
  at: number;
  capAtSignal: number;
  /** The highest cap after the signal, SOL. */
  peakCap: number;
  /** peakCap over capAtSignal. */
  multiple: number;
  graduated: boolean;
  tier: Tier;
  /** Also fired live on the radar (radar.jsonl), not only in the silent trial. */
  live: boolean;
  /** In the confirmed record: the cap at minute five (capAtSignal is then the cap at minute twenty). */
  capAt5?: number;
}

export interface Rates {
  n: number;
  graduated: number;
  x2: number;
  x5: number;
  x10: number;
  medianX: number | null;
}

export interface RadarRecord {
  builtAt: number;
  frozenAt: number;
  gradedAfterHours: number;
  /** The best runners from signal to peak, 3x or more, best first. */
  top: RecordRow[];
  /** Every graded pick, strong and watch. */
  picks: Rates & { strong: number; watch: number };
  /** A random graded 5-minute reading, for comparison. */
  base: Rates;
  /** Picks confirmed at minute twenty, from confirmation to peak; perDay over the graded days since the freeze. */
  confirmed: Rates & { perDay: number | null; top: RecordRow[] };
}

/** A pick's confirmation: the minute-20 time and cap, and what came after it. */
interface Conf {
  at: number;
  c20: number;
  peak: number;
  graduated: boolean;
}

interface Pending {
  mint: string;
  at: number;
  createdAt: number;
  x: MarkRow;
}
interface Graded {
  mint: string;
  at: number;
  c5: number;
  peak: number;
  graduated: boolean;
  tier: Tier;
  conf: Conf | null;
}

interface M20 extends Mark20 {
  createdAt: number;
}

const KEEP_M20_MS = 8 * 24 * 3_600_000;
const r1 = (v: number) => Math.round(v * 10) / 10;

function rates(xs: number[], grads: number): Rates {
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: xs.length,
    graduated: grads,
    x2: xs.filter((v) => v >= 2).length,
    x5: xs.filter((v) => v >= 5).length,
    x10: xs.filter((v) => v >= 10).length,
    medianX: s.length ? r1(s[Math.floor(s.length / 2)]!) : null,
  };
}

export class RecordBuilder {
  private offset = 0;
  private rest = "";
  private pending: Pending[] = [];
  private picks = new Map<string, Graded>();
  /** Minute-20 readings since the freeze, by mint, for the confirmation; older than 8 days they leave. */
  private m20 = new Map<string, M20>();
  /** Multiples of every graded reading, rounded to 0.1, and graduations: the base rate. */
  private base = { xs: [] as number[], grads: 0 };
  private q: Record<"token" | "prior" | "early", StatementSync> | null = null;

  private readonly db: DatabaseSync;
  private readonly marksFile: string;
  private readonly radarFile: string | null;
  private readonly frozen: Frozen;

  constructor(db: DatabaseSync, marksFile: string, radarFile: string | null, frozen: Frozen = FROZEN) {
    this.db = db;
    this.marksFile = marksFile;
    this.radarFile = radarFile;
    this.frozen = frozen;
  }

  private stmts() {
    this.q ??= {
      token: this.db.prepare("select id,symbol,creator_id,created_at,cap_peak,cap_peak_at,graduated_at from tokens where mint=?"),
      prior: this.db.prepare("select count(*) n, count(graduated_at) g from tokens where creator_id=? and created_at<?"),
      early: this.db.prepare("select wallet_id w from wallet_tokens where token_id=? and role=1"),
    };
    return this.q;
  }

  private token(mint: string) {
    return this.stmts().token.get(mint) as
      | { id: number; symbol: string; creator_id: number; created_at: number; cap_peak: number | null; cap_peak_at: number | null; graduated_at: number | null }
      | undefined;
  }

  /** The highest cap after a moment, and a clean graduation after it, as trial.js reads them. */
  private outcome(t: NonNullable<ReturnType<RecordBuilder["token"]>>, after: number, floor: number) {
    const later = t.cap_peak_at == null || t.cap_peak_at > after;
    const peak = later && t.cap_peak != null ? Math.max(t.cap_peak, floor) : floor;
    const graduated = t.graduated_at != null && t.graduated_at > after && (t.cap_peak ?? 0) >= CLEAN_GRAD_CAP;
    return { peak, graduated };
  }

  /** Reads the marks file from where it stopped; `pause` lets the worker breathe between chunks. */
  async update(now = Date.now(), pause: () => Promise<void> = async () => {}, chunk = 4 << 20): Promise<RadarRecord> {
    if (existsSync(this.marksFile)) {
      const fd = openSync(this.marksFile, "r");
      try {
        const size = fstatSync(fd).size;
        if (size < this.offset) (this.offset = 0), (this.rest = "");
        while (this.offset < size) {
          const len = Math.min(chunk, size - this.offset);
          const buf = Buffer.alloc(len);
          readSync(fd, buf, 0, len, this.offset);
          this.offset += len;
          const lines = (this.rest + buf.toString("utf8")).split("\n");
          this.rest = lines.pop()!;
          for (const l of lines) this.read(l);
          await pause();
        }
      } finally {
        closeSync(fd);
      }
    }
    this.grade(now);
    return this.build(now);
  }

  private read(line: string) {
    if (!line) return;
    const five = line.includes('"min":5,');
    if (!five && !line.includes('"min":20,')) return;
    let x: MarkRow;
    try {
      x = JSON.parse(line) as MarkRow;
    } catch {
      return;
    }
    if (x.min === 20) {
      if (x.createdAt > this.frozen.frozenAt && !this.m20.has(x.mint)) this.m20.set(x.mint, { mint: x.mint, at: x.at, createdAt: x.createdAt, curveSol: x.curveSol, graduated: x.graduated, creatorSoldPct: x.creatorSoldPct });
      return;
    }
    if (x.min !== 5 || x.graduated || x.createdAt <= this.frozen.frozenAt) return;
    this.pending.push({ mint: x.mint, at: x.at, createdAt: x.createdAt, x });
  }

  /** Readings 30 hours old are scored and graded once; picks keep being re-read so a late peak still counts. */
  private grade(now: number) {
    const s = this.stmts();
    const keep: Pending[] = [];
    for (const p of this.pending) {
      if (now - p.createdAt < GRADE_AFTER_MS) {
        keep.push(p);
        continue;
      }
      const t = this.token(p.mint);
      if (!t || t.cap_peak == null) continue;
      const pr = s.prior.get(t.creator_id, t.created_at) as { n: number; g: number };
      const early = (s.early.all(t.id) as Array<{ w: number }>).map((o) => Number(o.w));
      const f = featuresOf(p.x, { prior: Number(pr.n), priorG: Number(pr.g), early });
      const o = this.outcome(t, p.createdAt + 5 * 60_000, f.c5);
      this.base.xs.push(r1(o.peak / f.c5));
      if (o.graduated) this.base.grads++;
      const j = judge(f, this.frozen);
      if (j.tier && !this.picks.has(p.mint)) this.picks.set(p.mint, { mint: p.mint, at: p.at, c5: f.c5, peak: o.peak, graduated: o.graduated, tier: j.tier, conf: this.confirmOf(p.mint, f.c5) });
    }
    this.pending = keep;
    for (const g of this.picks.values()) {
      const t = this.token(g.mint);
      if (!t) continue;
      const o = this.outcome(t, g.at, g.c5);
      g.peak = Math.max(g.peak, o.peak);
      g.graduated ||= o.graduated;
      if (g.conf) {
        const c = this.outcome(t, g.conf.at, g.conf.c20);
        g.conf.peak = Math.max(g.conf.peak, c.peak);
        g.conf.graduated ||= c.graduated;
      }
    }
    for (const [mint, m] of this.m20) if (now - m.createdAt > KEEP_M20_MS) this.m20.delete(mint);
  }

  /** The minute-20 rule on a pick's own reading; null when it had no minute-20 reading or failed the rule. */
  private confirmOf(mint: string, c5: number): Conf | null {
    const m = this.m20.get(mint);
    if (!m) return null;
    const cap = curveCap(m.curveSol);
    if (!confirms(c5, { cap, graduated: Boolean(m.graduated), devSold: m.creatorSoldPct })) return null;
    return { at: m.at, c20: cap, peak: cap, graduated: false };
  }

  /** Lines of radar.jsonl, parsed; a missing file reads as none. */
  private radarLines(): Array<Record<string, unknown> & { mint: string }> {
    if (!this.radarFile || !existsSync(this.radarFile)) return [];
    const out: Array<Record<string, unknown> & { mint: string }> = [];
    for (const line of readFileSync(this.radarFile, "utf8").split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* a torn line */
      }
    }
    return out;
  }

  /** Minute-20 marks of live candidates in radar.jsonl that have no stage line yet: the backfill on the main thread decides them. */
  undecided(): Mark20[] {
    const open = new Set<string>();
    for (const x of this.radarLines()) {
      if (x.kind === "stage") open.delete(x.mint);
      else if (x.kind == null && typeof x.at === "number" && (x.stage ?? "candidate") === "candidate") open.add(x.mint);
    }
    const out: Mark20[] = [];
    for (const mint of open) {
      const m = this.m20.get(mint);
      if (m) out.push({ mint, at: m.at, curveSol: m.curveSol, graduated: m.graduated, creatorSoldPct: m.creatorSoldPct });
    }
    return out;
  }

  /** Live signals and their last outcome, a day old or more. */
  private live(now: number): Map<string, LiveRow> {
    const out = new Map<string, LiveRow>();
    for (const raw of this.radarLines()) {
      const x = raw as { kind?: string; mint: string; at?: number; capAtSignal?: number; symbol?: string; tier?: Tier; peakCap?: number; stage?: string; capAt20?: number };
      if (x.kind === "outcome") {
        const s = out.get(x.mint);
        if (s && typeof x.peakCap === "number") {
          s.peak = Math.max(s.peak, x.peakCap);
          if (s.conf) s.conf.peak = Math.max(s.conf.peak, x.peakCap);
        }
      } else if (x.kind === "stage") {
        const s = out.get(x.mint);
        if (s && x.stage === "confirmed" && typeof x.at === "number" && typeof x.capAt20 === "number") s.conf = { at: x.at, c20: x.capAt20, peak: x.capAt20, graduated: false };
      } else if (typeof x.at === "number" && typeof x.capAtSignal === "number" && x.tier && !out.has(x.mint)) {
        out.set(x.mint, { at: x.at, c5: x.capAtSignal, symbol: x.symbol ?? "", tier: x.tier, peak: x.capAtSignal, graduated: false, conf: null });
      }
    }
    for (const [mint, s] of out) {
      if (now - s.at < LIVE_SETTLED_MS) {
        out.delete(mint);
        continue;
      }
      const t = this.token(mint);
      if (t) {
        const o = this.outcome(t, s.at, s.c5);
        s.peak = Math.max(s.peak, o.peak);
        s.graduated = o.graduated;
        if (s.conf) {
          const c = this.outcome(t, s.conf.at, s.conf.c20);
          s.conf.peak = Math.max(s.conf.peak, c.peak);
          s.conf.graduated = c.graduated;
        }
      }
    }
    return out;
  }

  build(now = Date.now()): RadarRecord {
    const live = this.live(now);
    const rows: RecordRow[] = [];
    for (const g of this.picks.values()) {
      const l = live.get(g.mint);
      const peak = Math.max(g.peak, l?.peak ?? 0);
      rows.push({ mint: g.mint, symbol: l?.symbol || this.token(g.mint)?.symbol || "", at: g.at, capAtSignal: r1(g.c5), peakCap: r1(peak), multiple: r1(peak / g.c5), graduated: g.graduated || Boolean(l?.graduated), tier: g.tier, live: Boolean(l) });
    }
    for (const [mint, l] of live) {
      if (this.picks.has(mint)) continue;
      rows.push({ mint, symbol: l.symbol, at: l.at, capAtSignal: r1(l.c5), peakCap: r1(l.peak), multiple: r1(l.peak / Math.max(l.c5, 1e-9)), graduated: l.graduated, tier: l.tier, live: true });
    }
    const top = rows.filter((r) => r.multiple >= 3).sort((a, b) => b.multiple - a.multiple || b.at - a.at).slice(0, 20);
    // The confirmed record: the same picks through the minute-20 rule, from the minute-20 cap.
    const conf: RecordRow[] = [];
    const confRow = (mint: string, symbol: string, tier: Tier, c5: number, c: Conf, live: boolean): RecordRow => ({ mint, symbol, at: c.at, capAtSignal: r1(c.c20), capAt5: r1(c5), peakCap: r1(c.peak), multiple: r1(c.peak / Math.max(c.c20, 1e-9)), graduated: c.graduated, tier, live });
    for (const g of this.picks.values()) {
      const l = live.get(g.mint);
      const c = g.conf ?? l?.conf;
      if (!c) continue;
      const lc = l?.conf;
      const merged = lc && g.conf ? { ...c, peak: Math.max(c.peak, lc.peak), graduated: c.graduated || lc.graduated } : c;
      conf.push(confRow(g.mint, l?.symbol || this.token(g.mint)?.symbol || "", g.tier, g.c5, merged, Boolean(l)));
    }
    for (const [mint, l] of live) if (!this.picks.has(mint) && l.conf) conf.push(confRow(mint, l.symbol, l.tier, l.c5, l.conf, true));
    const days = (now - GRADE_AFTER_MS - this.frozen.frozenAt) / (24 * 3_600_000);
    return {
      builtAt: now,
      frozenAt: this.frozen.frozenAt,
      gradedAfterHours: GRADE_AFTER_MS / 3_600_000,
      top,
      picks: { ...rates(rows.map((r) => r.multiple), rows.filter((r) => r.graduated).length), strong: rows.filter((r) => r.tier === "strong").length, watch: rows.filter((r) => r.tier === "watch").length },
      base: rates(this.base.xs, this.base.grads),
      confirmed: {
        ...rates(conf.map((r) => r.multiple), conf.filter((r) => r.graduated).length),
        perDay: days >= 1 ? r1(conf.length / days) : null,
        top: conf.filter((r) => r.multiple >= 3).sort((a, b) => b.multiple - a.multiple || b.at - a.at).slice(0, 20),
      },
    };
  }
}


interface LiveRow {
  at: number;
  c5: number;
  symbol: string;
  tier: Tier;
  peak: number;
  graduated: boolean;
  conf: Conf | null;
}
