/**
 * Caller Truth: what happened after each pump.fun callout, kept per caller. A call is followed for 24 hours from the
 * minute it was made: the cap an hour in, the highest cap we saw, where the coin stood at the end and whether it was
 * still alive, and what the wallet pump.fun lists for the caller did around the call (in before it, sold out after it).
 * Nothing here says who owns a wallet: the wallet is the one pump.fun prints next to the caller's name.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Callout } from "./calls.ts";

const HOUR = 3_600_000;
/** A call is followed this long, then its outcome is final. */
export const FOLLOW_MS = 24 * HOUR;
const KEEP_MS = 30 * 86_400_000;
/** A first look later than this after the call missed the first minutes: the peak is then a floor, not the peak. */
const LATE_MS = 5 * 60_000;
/** A caller is listed once this many of their calls have run their 24 hours. */
export const MIN_SETTLED = 5;

/** A coin as the tape sees it now. */
export interface CallLook {
  capUsd: number | null;
  /** By the zoo's own lines: alive, dead, or between the two. */
  state: "alive" | "dead" | "between";
  dumpedAt: number | null;
}

export interface CallOutcome {
  post: number;
  mint: string;
  symbol: string;
  wallet: string;
  at: number;
  calledUsd: number;
  /** Our first look at the coin after the call, and the last. */
  firstAt: number;
  endAt: number;
  /** The cap an hour after the call, the highest we saw, and at the last look. */
  h1Usd: number | null;
  peakUsd: number | null;
  endUsd: number | null;
  state: "alive" | "dead" | "between";
  /** The dev dumped it after the call was made. */
  devDumpedAt: number | null;
  /** The caller's listed wallet on this coin: seen among the buyers we track, its first buy, when it sold out. */
  walletSeen: boolean;
  boughtAt: number | null;
  exitAt: number | null;
  /** The 24 hours are over, or the coin left the tape: nothing more is read. */
  done: boolean;
}

export interface CallerRecord {
  wallet: string;
  name: string;
  twitter: string | null;
  followers: number | null;
  /** Every callout in 30 days, and the coins they were on. Repeat calls on a coin are not judged twice. */
  calls: number;
  coins: number;
  /** Coins whose first call ran its 24 hours on our tape. */
  settled: number;
  alive: number;
  dead: number;
  up: number;
  /** The median of cap at the end over cap when called, across settled calls. */
  medianX: number | null;
  /** The best peak over the cap when called, among calls we watched from the first minutes. */
  bestX: number | null;
  /** Calls where the listed wallet was among the buyers we track; of those, in before the call, sold out within an hour after it, sold out at all after it. */
  walletSeen: number;
  boughtBefore: number;
  soldWithinHour: number;
  soldAfter: number;
  devDumpedAfter: number;
  lastAt: number;
}

export interface CallerDeps {
  /** Calls made at or after a time. */
  callsSince: (since: number) => Callout[];
  look: (mint: string, now: number) => CallLook | null;
  buyer: (mint: string, wallet: string) => { at: number | null; exitAt: number | null } | null;
  /** False while the node cannot price a coin yet (no SOL price after a restart). */
  ready?: () => boolean;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export class CallerLedger {
  private outcomes = new Map<number, CallOutcome>();
  private deps: CallerDeps;
  private file: string | null;
  private log: (m: string) => void;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private ticks = 0;
  /** Since when calls are followed: older ones were never watched. */
  since = Date.now();
  private cache: { at: number; list: CallerRecord[] } | null = null;

  constructor(deps: CallerDeps, file: string | null = null, log: (m: string) => void = () => {}) {
    this.deps = deps;
    this.file = file;
    this.log = log;
    if (file && existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, "utf8")) as { since?: number; outcomes?: CallOutcome[] };
        for (const o of saved.outcomes ?? []) this.outcomes.set(o.post, o);
        if (saved.since) this.since = saved.since;
      } catch (e) {
        log(`callers: could not read ${file}: ${(e as Error).message}`);
      }
    }
  }

  get size(): number {
    return this.outcomes.size;
  }

  start(everyMs = 60_000): void {
    if (this.timer) return;
    // A ledger with nothing in it yet starts from the calls of the last two days, not from an empty page. It looks
    // that far back for its first ten minutes: the feed may still be reading older calls in.
    let wide = this.outcomes.size === 0 ? 10 : 0;
    this.timer = setInterval(() => {
      try {
        // No price yet, no look: a call closed without a cap would stay that way.
        if (this.deps.ready && !this.deps.ready()) return;
        this.tick(Date.now(), wide-- > 0 ? 47 * HOUR : undefined);
        // The file is written every fifth look: a minute of outcomes lost on a crash is read again from the tape.
        if (++this.ticks % 5 === 0) this.save();
      } catch (e) {
        this.log(`callers: ${(e as Error).message}`);
      }
    }, everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.save();
  }

  save(): void {
    if (!this.file || !this.dirty) return;
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ since: this.since, outcomes: [...this.outcomes.values()] }));
      renameSync(tmp, this.file);
      this.dirty = false;
    } catch (e) {
      this.log(`callers: could not save: ${(e as Error).message}`);
    }
  }

  /**
   * One look at every call still inside its 24 hours. `back` reaches further for the first look a new ledger takes:
   * calls up to two days old whose coin the tape still holds are closed with where the coin stands now.
   */
  tick(now = Date.now(), back = FOLLOW_MS + HOUR): void {
    for (const c of this.deps.callsSince(now - back)) {
      if (!c.wallet || !c.calledMcUsd || c.at > now) continue;
      let o = this.outcomes.get(c.post);
      if (o?.done) continue;
      const look = this.deps.look(c.mint, now);
      if (!look) {
        // The coin is not on the tape: never was (nothing to follow), or it aged out before the 24 hours ended.
        if (o) (o.done = true), (this.dirty = true);
        continue;
      }
      if (!o) {
        o = { post: c.post, mint: c.mint, symbol: c.symbol, wallet: c.wallet, at: c.at, calledUsd: c.calledMcUsd, firstAt: now, endAt: now, h1Usd: null, peakUsd: null, endUsd: null, state: look.state, devDumpedAt: null, walletSeen: false, boughtAt: null, exitAt: null, done: false };
        this.outcomes.set(c.post, o);
      }
      const age = now - c.at;
      o.endAt = now;
      o.state = look.state;
      if (look.capUsd !== null) {
        o.endUsd = Math.round(look.capUsd);
        o.peakUsd = Math.max(o.peakUsd ?? 0, o.endUsd);
        // The first look at or past the hour stands for the hour, if it came within ten minutes of it.
        if (o.h1Usd === null && age >= HOUR && age < HOUR + 10 * 60_000) o.h1Usd = o.endUsd;
      }
      if (look.dumpedAt !== null && look.dumpedAt > c.at) o.devDumpedAt = look.dumpedAt;
      const b = this.deps.buyer(c.mint, c.wallet);
      if (b) {
        o.walletSeen = true;
        o.boughtAt = b.at;
        o.exitAt = b.exitAt;
      }
      if (age >= FOLLOW_MS) o.done = true;
      this.dirty = true;
    }
    const cut = now - KEEP_MS;
    for (const [post, o] of this.outcomes) if (o.at < cut) this.outcomes.delete(post), (this.dirty = true);
    this.cache = null;
  }

  outcomeOf(post: number): CallOutcome | null {
    return this.outcomes.get(post) ?? null;
  }

  /** A call is settled when it was followed to the end of its 24 hours (a coin that left the tape earlier is not). */
  private settled(o: CallOutcome): boolean {
    return o.done && o.endAt - o.at >= FOLLOW_MS - 10 * 60_000;
  }

  /** Every caller's record over the kept 30 days, the ones with the most settled calls first. */
  records(now = Date.now()): CallerRecord[] {
    if (this.cache && now - this.cache.at < 60_000) return this.cache.list;
    const by = new Map<string, Callout[]>();
    for (const c of this.deps.callsSince(now - KEEP_MS)) {
      if (!c.wallet) continue;
      const list = by.get(c.wallet) ?? [];
      list.push(c);
      by.set(c.wallet, list);
    }
    const out: CallerRecord[] = [];
    for (const [wallet, calls] of by) {
      calls.sort((a, b) => a.at - b.at);
      const first = new Map<string, Callout>();
      for (const c of calls) if (!first.has(c.mint)) first.set(c.mint, c);
      const last = calls[calls.length - 1]!;
      const rec: CallerRecord = { wallet, name: last.caller, twitter: last.twitter, followers: last.followers, calls: calls.length, coins: first.size, settled: 0, alive: 0, dead: 0, up: 0, medianX: null, bestX: null, walletSeen: 0, boughtBefore: 0, soldWithinHour: 0, soldAfter: 0, devDumpedAfter: 0, lastAt: last.at };
      const xs: number[] = [];
      for (const c of first.values()) {
        const o = this.outcomes.get(c.post);
        if (!o) continue;
        if (o.walletSeen) {
          rec.walletSeen++;
          if (o.boughtAt !== null && o.boughtAt < o.at) rec.boughtBefore++;
          if (o.exitAt !== null && o.exitAt > o.at) {
            rec.soldAfter++;
            if (o.exitAt - o.at <= HOUR) rec.soldWithinHour++;
          }
        }
        if (o.peakUsd !== null && o.firstAt - o.at <= LATE_MS) rec.bestX = Math.max(rec.bestX ?? 0, r2(o.peakUsd / o.calledUsd));
        if (!this.settled(o)) continue;
        rec.settled++;
        if (o.state === "dead") rec.dead++;
        else if (o.state === "alive") rec.alive++;
        if (o.devDumpedAt !== null) rec.devDumpedAfter++;
        if (o.endUsd !== null) {
          xs.push(o.endUsd / o.calledUsd);
          if (o.endUsd >= o.calledUsd) rec.up++;
        }
      }
      const m = median(xs);
      rec.medianX = m === null ? null : r2(m);
      out.push(rec);
    }
    out.sort((a, b) => b.settled - a.settled || b.calls - a.calls);
    this.cache = { at: now, list: out };
    return out;
  }

  recordOf(wallet: string, now = Date.now()): CallerRecord | null {
    return this.records(now).find((r) => r.wallet === wallet) ?? null;
  }

  /** How much of what was called we could follow at all. */
  coverage(now = Date.now()): { since: number; callers: number; listed: number; followed: number; settled: number } {
    const list = this.records(now);
    let settled = 0;
    for (const o of this.outcomes.values()) if (this.settled(o)) settled++;
    return { since: this.since, callers: list.length, listed: list.filter((r) => r.settled >= MIN_SETTLED).length, followed: this.outcomes.size, settled };
  }
}
