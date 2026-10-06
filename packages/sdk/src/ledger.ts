import { InsufficientFeed } from "./errors.js";

/**
 * Protocol parameters. These are the only things governance may change.
 * Amounts are in feed units; v1 runs on internal credits, v2 settles the
 * same numbers on Solana.
 */
export interface ProtocolParams {
  /** Flat price of one wake-up. */
  cyclePrice: number;
  /** Price per 1,000 model tokens. */
  modelPricePer1k: number;
  /** Share of cycle spend that goes to the node operator who paid for compute (0..1). The rest burns. */
  operatorShare: number;
  /** Fee for delivering a signal into another keeper's enclosure. */
  signalFee: number;
  /** Share of an accepted signal fee paid to the receiving keeper (0..1). The rest burns. */
  receiverShare: number;
  /** Stake an enclosure must lock before it may write to the network. */
  enclosureStake: number;
  /** Fraction of stake slashed when the spam rule trips (0..1). */
  slashFraction: number;
  /** Spam rule: rejected / sent above this ratio... */
  spamRejectRatio: number;
  /** ...over at least this many signals in the window. */
  spamMinSignals: number;
}

export const DEFAULT_PARAMS: ProtocolParams = {
  cyclePrice: 1,
  modelPricePer1k: 0.5,
  operatorShare: 0.8,
  signalFee: 0.2,
  receiverShare: 0.5,
  enclosureStake: 100,
  slashFraction: 0.1,
  spamRejectRatio: 0.5,
  spamMinSignals: 10,
};

export interface LedgerEntry {
  ts: number;
  account: string;
  delta: number;
  reason: "deposit" | "cycle" | "operator" | "signal" | "receiver" | "burn" | "stake" | "unstake" | "slash";
  ref?: string;
}

/**
 * Off-chain feed ledger. Every movement is an entry; balances are sums.
 * Burns are recorded against the `burn` account so total supply is auditable.
 */
export class FeedLedger {
  static readonly BURN = "burn";
  private balances = new Map<string, number>();
  private stakes = new Map<string, number>();
  readonly entries: LedgerEntry[] = [];

  constructor(readonly params: ProtocolParams = DEFAULT_PARAMS) {}

  balance(account: string): number {
    return this.balances.get(account) ?? 0;
  }

  stakeOf(enclosure: string): number {
    return this.stakes.get(enclosure) ?? 0;
  }

  burned(): number {
    return this.balance(FeedLedger.BURN);
  }

  deposit(account: string, amount: number, ref?: string): void {
    if (!(amount > 0)) throw new Error("deposit must be positive");
    this.move(account, amount, "deposit", ref);
  }

  /** Lock the enclosure stake from the keeper's balance. */
  lockStake(keeper: string, enclosure: string): void {
    const amount = this.params.enclosureStake;
    this.require(keeper, amount);
    this.move(keeper, -amount, "stake", enclosure);
    this.stakes.set(enclosure, this.stakeOf(enclosure) + amount);
  }

  /** Return the remaining stake when an enclosure is retired. */
  releaseStake(keeper: string, enclosure: string): number {
    const amount = this.stakeOf(enclosure);
    this.stakes.delete(enclosure);
    if (amount > 0) this.move(keeper, amount, "unstake", enclosure);
    return amount;
  }

  slash(enclosure: string): number {
    const amount = round(this.stakeOf(enclosure) * this.params.slashFraction);
    if (amount <= 0) return 0;
    this.stakes.set(enclosure, this.stakeOf(enclosure) - amount);
    this.move(FeedLedger.BURN, amount, "slash", enclosure);
    return amount;
  }

  cycleCost(modelTokens: number): number {
    return round(this.params.cyclePrice + (modelTokens / 1000) * this.params.modelPricePer1k);
  }

  canAfford(keeper: string, amount: number): boolean {
    return this.balance(keeper) >= amount;
  }

  /** Charge a finished cycle: operator gets their share, the rest burns. */
  settleCycle(keeper: string, operator: string, modelTokens: number, ref?: string): number {
    const cost = this.cycleCost(modelTokens);
    this.require(keeper, cost);
    const toOperator = round(cost * this.params.operatorShare);
    this.move(keeper, -cost, "cycle", ref);
    this.move(operator, toOperator, "operator", ref);
    this.move(FeedLedger.BURN, round(cost - toOperator), "burn", ref);
    return cost;
  }

  /** Escrow the signal fee when a signal is sent. */
  chargeSignal(sender: string, ref?: string): number {
    const fee = this.params.signalFee;
    this.require(sender, fee);
    this.move(sender, -fee, "signal", ref);
    return fee;
  }

  /** Settle an escrowed signal fee once the receiver accepts or rejects it. */
  settleSignal(receiver: string, accepted: boolean, ref?: string): void {
    const fee = this.params.signalFee;
    const toReceiver = accepted ? round(fee * this.params.receiverShare) : 0;
    if (toReceiver > 0) this.move(receiver, toReceiver, "receiver", ref);
    this.move(FeedLedger.BURN, round(fee - toReceiver), "burn", ref);
  }

  private require(account: string, amount: number): void {
    const available = this.balance(account);
    if (available < amount) throw new InsufficientFeed(account, amount, available);
  }

  private move(account: string, delta: number, reason: LedgerEntry["reason"], ref?: string): void {
    this.balances.set(account, round(this.balance(account) + delta));
    this.entries.push({ ts: Date.now(), account, delta, reason, ...(ref ? { ref } : {}) });
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
