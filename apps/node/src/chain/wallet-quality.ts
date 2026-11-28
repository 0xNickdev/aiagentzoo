import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * How seasoned the first buyers of a radar candidate are, from our own history.db only (no RPC): when we first saw
 * each wallet (wallets.first_seen, 90 days deep), how many coins it traded before this buy (wallet_pnl rows that began
 * earlier, counted up to 200) and whether those trades left it up or down in SOL. Run in the background worker.
 *
 * Thresholds (owner's call 28 Nov, to be tested at the 5-6 Dec regrade; the 28 Nov research saw no signal in
 * "fresh" but only had our first-seen, not wallet age):
 *   fresh    = 2 or fewer prior coins and first seen by us under a day before the buy (or never seen before)
 *   seasoned = 50+ prior coins, or 20+ prior coins and first seen 7+ days before
 */
export const QUALITY = { freshMaxPrior: 2, freshMaxAgeMs: 24 * 3_600_000, seasonedPrior: 50, seasonedPriorAged: 20, seasonedAgeMs: 7 * 24 * 3_600_000, priorCap: 200 } as const;

export interface WalletQuality {
  /** Wallets read (the first 30 buyers, creator left out). */
  of: number;
  fresh: number;
  seasoned: number;
  /** Wallets we had never seen before this coin. */
  unseen: number;
  /** Median prior coins traded, capped at 200. */
  medianPrior: number;
  /** Wallets with prior trades whose realized SOL is up / down. */
  pnlUp: number;
  pnlDown: number;
  /** Median days since we first saw the wallet (seen wallets only), or null. */
  medianAgeDays: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export class QualityReader {
  private seen: StatementSync | null = null;
  private prior: StatementSync | null = null;
  private pnlOk = true;
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  read(buyers: Array<{ wallet: string; at: number }>): WalletQuality {
    this.seen ??= this.db.prepare("select first_seen f from wallets where wallet=?");
    if (this.pnlOk && !this.prior) {
      try {
        this.prior = this.db.prepare("select count(*) n, coalesce(sum(sol_out - sol_in), 0) net from (select sol_in, sol_out from wallet_pnl where wallet=? and first_ts<? limit ?)");
      } catch {
        this.pnlOk = false; // no ledger on this node
      }
    }
    let fresh = 0, seasoned = 0, unseen = 0, pnlUp = 0, pnlDown = 0;
    const priors: number[] = [];
    const ages: number[] = [];
    for (const b of buyers) {
      const f = (this.seen.get(b.wallet) as { f: number } | undefined)?.f;
      const age = f == null || f >= b.at ? null : b.at - f;
      if (age == null) unseen++;
      else ages.push(age / 86_400_000);
      let n = 0;
      if (this.prior) {
        const r = this.prior.get(b.wallet, b.at, QUALITY.priorCap) as { n: number; net: number };
        n = Number(r.n);
        if (n) (r.net > 0 ? pnlUp++ : r.net < 0 ? pnlDown++ : 0);
      }
      priors.push(n);
      if (n <= QUALITY.freshMaxPrior && (age == null || age < QUALITY.freshMaxAgeMs)) fresh++;
      else if (n >= QUALITY.seasonedPrior || (n >= QUALITY.seasonedPriorAged && age != null && age >= QUALITY.seasonedAgeMs)) seasoned++;
    }
    const ma = median(ages);
    return { of: buyers.length, fresh, seasoned, unseen, medianPrior: median(priors) ?? 0, pnlUp, pnlDown, medianAgeDays: ma == null ? null : Math.round(ma * 10) / 10 };
  }
}
