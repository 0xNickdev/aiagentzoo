/**
 * Operators: wallets that signed the same transaction.
 *
 * Every buyer and seller on pump.fun and PumpSwap signs their own trade, so a transaction carrying trades from two
 * wallets was signed by both. Short of a stolen key, one hand holds both keys: a launch that buys from five wallets
 * inside its own create transaction, a bundled sell that empties ten wallets at once. Wallets joined this way stay
 * joined, so a rugger who moves to a fresh wallet is still the same operator the moment that wallet signs next to an
 * old one. This is the strongest link the zoo draws, and the only one it calls "one operator".
 */

/** Joined pairs kept as evidence; the oldest go first past this. */
const EVIDENCE_MAX = 200_000;
/** Members listed for one operator; a bigger group is still counted in full. */
const MEMBERS_LIST = 500;

export interface CoSign {
  a: string;
  b: string;
  tx: string;
  at: number;
}

export class Operators {
  private readonly parent = new Map<string, string>();
  private readonly members = new Map<string, Set<string>>();
  private readonly size = new Map<string, number>();
  private evidence: CoSign[] = [];
  /** The transaction being read and the wallets seen signing in it so far. */
  private current: { tx: string; wallets: Set<string> } | null = null;

  find(w: string): string {
    let root = w;
    while (true) {
      const p = this.parent.get(root);
      if (!p || p === root) break;
      root = p;
    }
    // Path compression: every wallet on the way points straight at the root.
    let at = w;
    while (at !== root) {
      const next = this.parent.get(at)!;
      this.parent.set(at, root);
      at = next;
    }
    return root;
  }

  /** Joins two wallets seen signing one transaction. */
  join(a: string, b: string, tx: string, at: number): void {
    if (a === b) return;
    this.evidence.push({ a, b, tx, at });
    if (this.evidence.length > EVIDENCE_MAX * 1.1) this.evidence = this.evidence.slice(-EVIDENCE_MAX);
    this.union(a, b);
  }

  private union(a: string, b: string): void {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if ((this.size.get(ra) ?? 1) < (this.size.get(rb) ?? 1)) [ra, rb] = [rb, ra];
    this.parent.set(rb, ra);
    this.parent.set(ra, ra);
    this.size.set(ra, (this.size.get(ra) ?? 1) + (this.size.get(rb) ?? 1));
    this.size.delete(rb);
    const into = this.members.get(ra) ?? new Set([ra]);
    for (const m of this.members.get(rb) ?? [rb]) if (into.size < MEMBERS_LIST) into.add(m);
    this.members.set(ra, into);
    this.members.delete(rb);
  }

  /**
   * Reads one signer of a transaction. Events of one transaction arrive together, so a new signature closes the last
   * one; each new wallet in the same transaction is joined to the first.
   */
  signer(wallet: string, tx: string | undefined, at: number): void {
    if (!tx) return;
    if (this.current?.tx !== tx) {
      this.current = { tx, wallets: new Set([wallet]) };
      return;
    }
    if (this.current.wallets.has(wallet)) return;
    const first = this.current.wallets.values().next().value as string;
    this.current.wallets.add(wallet);
    this.join(first, wallet, tx, at);
  }

  /** The operator a wallet belongs to: every wallet joined to it, and how many there are. Null when it stands alone. */
  of(wallet: string): { root: string; wallets: number; members: string[] } | null {
    if (!this.parent.has(wallet)) return null;
    const root = this.find(wallet);
    const wallets = this.size.get(root) ?? 1;
    if (wallets < 2) return null;
    return { root, wallets, members: [...(this.members.get(root) ?? [root])] };
  }

  /** The transactions that joined a group, newest first: the proof anyone can open on an explorer. */
  proof(root: string, limit = 5): CoSign[] {
    const out: CoSign[] = [];
    for (let i = this.evidence.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.evidence[i]!;
      if (this.find(e.a) === root) out.push(e);
    }
    return out;
  }

  get joined(): number {
    return this.evidence.length;
  }

  snapshot(): CoSign[] {
    return this.evidence;
  }

  load(saved: CoSign[] | undefined): void {
    for (const e of saved ?? []) if (e?.a && e?.b) this.join(e.a, e.b, e.tx, e.at);
  }
}

/** What the check says about the operator behind a dev, when the operator's other wallets launched and dumped. */
export interface OperatorRecord {
  wallets: number;
  /** Launches in two days by the operator's wallets other than this dev, and how many their creator dumped. */
  launches: number;
  dumped: number;
  settled: number;
}

/**
 * Past this many wallets a group is more likely a custodial trading bot that holds its users' keys and batches their
 * trades than one person: it says nothing about one dev.
 */
export const CUSTODIAL_WALLETS = 100;

export function operatorWarning(r: OperatorRecord | null): { text: string; avoid: boolean } | null {
  if (!r || r.wallets < 2 || r.wallets > CUSTODIAL_WALLETS || r.settled < 3) return null;
  const rate = r.dumped / r.settled;
  if (rate < 0.8) return null;
  const others = r.wallets - 1;
  const text = `the dev signed transactions together with ${others} other wallet${others === 1 ? "" : "s"}: one operator, whose other wallets launched ${r.launches} coins in two days and dumped ${r.dumped} of the ${r.settled} that settled`;
  return { text, avoid: r.settled >= 5 && rate >= 0.9 };
}
