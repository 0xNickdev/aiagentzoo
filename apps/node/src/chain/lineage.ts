import { funderOf, fundersEnabled, rpc } from "./funders.ts";
import { type PumpTape, tape } from "./pump.ts";

/**
 * Who paid for the creator. A rugger who rotates wallets gets a clean record each time; the SOL for each new wallet
 * still comes from somewhere. Every creator traced (the worst ruggers in the background, and any token someone
 * checks) adds to an index of funder -> creators, so a fresh wallet funded by the same hand is known at once.
 * Exchange hot wallets fund everyone and are left out: two strangers withdrawing from one exchange are not a ring.
 */

export interface LineageView {
  creator: string;
  /** The wallet that sent the creator its SOL; null when none was found in its recent history. */
  funder: string | null;
  /** The funder moves a thousand transactions a day or more: an exchange or a router, so no ring is read from it. */
  funderIsHot: boolean;
  /** Other creators the same funder paid for, as far as the zoo has traced. */
  siblings: Array<{ wallet: string; launches48h: number; dumped: number }>;
  /** Their launches and dumps over the last two days, from the tape. */
  siblingLaunches48h: number;
  siblingDumped48h: number;
  tracedAt: number;
}

interface Saved {
  v: 1;
  creators: Array<[string, { funder: string | null; at: number }]>;
  hot: Array<[string, { hot: boolean; at: number }]>;
}

const KEEP_MS = 14 * 24 * 3_600_000;
const HOT_MS = 24 * 3_600_000;

export class Lineage {
  private readonly creators = new Map<string, { funder: string | null; at: number }>();
  private readonly byFunder = new Map<string, Set<string>>();
  private readonly hot = new Map<string, { hot: boolean; at: number }>();
  private readonly queue: string[] = [];
  private readonly busy = new Map<string, Promise<string | null>>();
  private timer: NodeJS.Timeout | null = null;
  private refilledAt = 0;

  private readonly tape: PumpTape;
  private readonly fetchFn: typeof fetch;

  constructor(tape: PumpTape, fetchFn: typeof fetch = fetch) {
    this.tape = tape;
    this.fetchFn = fetchFn;
  }

  get size() {
    return this.creators.size;
  }

  /** Traces one creator (or returns what is known), at most one RPC trace per wallet at a time. */
  async trace(creator: string, now = Date.now()): Promise<string | null> {
    const known = this.creators.get(creator);
    if (known) return known.funder;
    const running = this.busy.get(creator);
    if (running) return running;
    const job = (async () => {
      const funder = await funderOf(creator, this.fetchFn).catch(() => null);
      if (funder) await this.isHot(funder, now);
      this.remember(creator, funder, now);
      return funder;
    })().finally(() => this.busy.delete(creator));
    this.busy.set(creator, job);
    return job;
  }

  private remember(creator: string, funder: string | null, at: number): void {
    this.creators.set(creator, { funder, at });
    if (funder) {
      const set = this.byFunder.get(funder) ?? new Set();
      set.add(creator);
      this.byFunder.set(funder, set);
    }
  }

  /** A wallet with a thousand signatures inside a day is an exchange, a router or a bot farm's bank: not one person's. */
  private async isHot(wallet: string, now: number): Promise<boolean> {
    const hit = this.hot.get(wallet);
    if (hit && now - hit.at < HOT_MS) return hit.hot;
    const sigs = await rpc<Array<{ blockTime: number | null }>>("getSignaturesForAddress", [wallet, { limit: 1000 }], this.fetchFn);
    const last = sigs?.[sigs.length - 1]?.blockTime;
    const hot = Boolean(sigs && sigs.length >= 1000 && last && now / 1000 - last < 24 * 3600);
    this.hot.set(wallet, { hot, at: now });
    return hot;
  }

  /** What is known about a creator's funding, without any RPC call; null when it was never traced. */
  view(creator: string, now = Date.now()): LineageView | null {
    const known = this.creators.get(creator);
    if (!known) return null;
    const funderIsHot = known.funder ? (this.hot.get(known.funder)?.hot ?? false) : false;
    const siblings = known.funder && !funderIsHot
      ? [...(this.byFunder.get(known.funder) ?? [])]
          .filter((w) => w !== creator)
          .map((w) => {
            const r = this.tape.creator(w, now);
            return { wallet: w, launches48h: r?.launches48h ?? 0, dumped: r?.dumped ?? 0 };
          })
          .sort((a, b) => b.dumped - a.dumped || b.launches48h - a.launches48h)
      : [];
    return {
      creator,
      funder: known.funder,
      funderIsHot,
      siblings: siblings.slice(0, 20),
      siblingLaunches48h: siblings.reduce((n, s) => n + s.launches48h, 0),
      siblingDumped48h: siblings.reduce((n, s) => n + s.dumped, 0),
      tracedAt: known.at,
    };
  }

  /** The creators a wallet paid for, as far as the zoo has traced, the worst first; empty when it funded none or is an exchange. */
  funded(funder: string, now = Date.now()): { hot: boolean; creators: Array<{ wallet: string; launches48h: number; dumped: number }> } {
    const hot = this.hot.get(funder)?.hot ?? false;
    const creators = [...(this.byFunder.get(funder) ?? [])]
      .map((w) => {
        const r = this.tape.creator(w, now);
        return { wallet: w, launches48h: r?.launches48h ?? 0, dumped: r?.dumped ?? 0 };
      })
      .sort((a, b) => b.dumped - a.dumped || b.launches48h - a.launches48h);
    return { hot, creators: creators.slice(0, 40) };
  }

  /** Puts a creator in line for the background tracer; `first` for one somebody is asking about right now. */
  enqueue(creator: string, first = false): void {
    if (this.creators.has(creator) || this.queue.includes(creator)) return;
    if (first) this.queue.unshift(creator);
    else this.queue.push(creator);
    if (this.queue.length > 2_000) this.queue.length = 2_000;
  }

  /**
   * Who to trace when nobody is asking: fresh wallets that just dumped their launch. A rugger who rotates wallets
   * leaves exactly these, and a fresh wallet's funding is its first transaction. Old serial launchers are skipped:
   * their recent history is all launches, so the transfer that funded them is out of reach.
   */
  refill(now = Date.now()): void {
    this.refilledAt = now;
    const seen = new Set<string>();
    for (const e of this.tape.momentsMatching({ kind: "dump", limit: 400 })) {
      const c = e.creator;
      if (!c || seen.has(c) || this.creators.has(c)) continue;
      seen.add(c);
      const r = this.tape.creator(c, now);
      if (r && r.launches48h <= 5) this.enqueue(c);
    }
  }

  /** Traces one creator every `everyMs`: whoever is asked about first, then fresh dumpers. Off without an RPC. */
  start(everyMs: number): void {
    if (!fundersEnabled() || this.timer) return;
    this.timer = setInterval(() => {
      if (!this.queue.length && Date.now() - this.refilledAt > 10 * 60_000) this.refill();
      const next = this.queue.shift();
      if (next) void this.trace(next).catch(() => null);
    }, everyMs);
    this.timer.unref();
  }

  snapshot(now = Date.now()): string {
    const fresh = <T extends { at: number }>(m: Map<string, T>) => [...m].filter(([, v]) => now - v.at < KEEP_MS);
    const saved: Saved = { v: 1, creators: fresh(this.creators), hot: fresh(this.hot) };
    return JSON.stringify(saved);
  }

  load(json: string, now = Date.now()): number {
    try {
      const saved = JSON.parse(json) as Saved;
      if (saved.v !== 1) return 0;
      for (const [w, v] of saved.hot ?? []) if (now - v.at < KEEP_MS) this.hot.set(w, v);
      for (const [c, v] of saved.creators ?? []) if (now - v.at < KEEP_MS) this.remember(c, v.funder, v.at);
      return this.creators.size;
    } catch {
      return 0;
    }
  }
}

/** The one index per node process, beside the one tape. */
export const lineage = new Lineage(tape);
