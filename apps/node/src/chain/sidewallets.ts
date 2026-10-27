import { funderOf, fundersEnabled } from "./funders.ts";
import type { KolLabel, Labels } from "./labels.ts";

/**
 * Side wallets. A KOL buys early from a fresh wallet, then buys with the known one and posts; the fresh wallet was
 * paid for by the known one. Every first-second and launch-block wallet is traced to the wallet that funded it, in
 * the background, one at a time; when that funder is a KOL on the list, the side wallet is marked as that KOL's.
 */

export interface SideWallet {
  funder: string | null;
  at: number;
}

const KEEP_MS = 14 * 24 * 3_600_000;
const QUEUE_MAX = 5_000;

export class SideWallets {
  private readonly funders = new Map<string, SideWallet>();
  private readonly queue: string[] = [];
  private readonly labels: Labels;
  private readonly f: typeof fetch;
  private stopped = false;
  private running = false;
  private gapMs = 500;

  constructor(labels: Labels, f: typeof fetch = fetch) {
    this.labels = labels;
    this.f = f;
  }

  /** Wallets to trace, newest first; known ones and the queue's own are skipped. */
  enqueue(wallets: string[]): void {
    if (!fundersEnabled()) return;
    for (const w of wallets) {
      if (this.funders.has(w) || this.queue.includes(w)) continue;
      this.queue.unshift(w);
    }
    if (this.queue.length > QUEUE_MAX) this.queue.length = QUEUE_MAX;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.stopped) {
        const w = this.queue.shift()!;
        const funder = await funderOf(w, this.f).catch(() => null);
        this.funders.set(w, { funder, at: Date.now() });
        if (this.funders.size > 200_000) this.funders.delete(this.funders.keys().next().value!);
        await new Promise((r) => setTimeout(r, this.gapMs));
      }
    } finally {
      this.running = false;
    }
  }

  start(gapMs = 500): () => void {
    this.gapMs = gapMs;
    this.stopped = false;
    void this.drain();
    return () => {
      this.stopped = true;
    };
  }

  /** Who funded the wallet: a wallet, null when none was found, undefined when not traced yet. */
  funderOf(wallet: string): string | null | undefined {
    return this.funders.get(wallet)?.funder;
  }

  /** The KOL whose known wallet paid for this one, if any. */
  kolOf(wallet: string): (KolLabel & { main: string }) | null {
    const funder = this.funders.get(wallet)?.funder;
    if (!funder) return null;
    const kol = this.labels.kol(funder);
    return kol ? { ...kol, main: funder } : null;
  }

  pending(): number {
    return this.queue.length;
  }

  snapshot(now = Date.now()): string {
    return JSON.stringify({ v: 1, funders: [...this.funders].filter(([, s]) => now - s.at < KEEP_MS) });
  }

  load(json: string, now = Date.now()): number {
    try {
      const saved = JSON.parse(json) as { v?: number; funders?: Array<[string, SideWallet]> };
      if (saved.v !== 1) return 0;
      for (const [w, s] of saved.funders ?? []) if (s && now - s.at < KEEP_MS) this.funders.set(w, s);
      return this.funders.size;
    } catch {
      return 0;
    }
  }
}
