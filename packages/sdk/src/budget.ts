import { BudgetExceeded } from "./errors.js";

export interface BudgetLimits {
  /** Tool calls and state writes inside one wake-up. */
  steps: number;
  /** Input + output model tokens inside one wake-up. */
  modelTokens: number;
  /** Signals sent inside one wake-up. */
  signals: number;
}

export const DEFAULT_BUDGET: BudgetLimits = { steps: 50, modelTokens: 20_000, signals: 10 };

/**
 * A per-session meter. When a limit is hit the call throws
 * {@link BudgetExceeded}; the runtime catches it and ends the session
 * cleanly. There is no penalty for running out — only for spam.
 */
export class Budget {
  private used: BudgetLimits = { steps: 0, modelTokens: 0, signals: 0 };

  constructor(
    private readonly agent: string,
    readonly limits: BudgetLimits = DEFAULT_BUDGET,
  ) {}

  charge(resource: keyof BudgetLimits, amount = 1): void {
    if (this.used[resource] + amount > this.limits[resource]) {
      throw new BudgetExceeded(this.agent, resource);
    }
    this.used[resource] += amount;
  }

  /** Model calls report usage after the fact; overshoot is recorded, then the next call fails. */
  record(resource: keyof BudgetLimits, amount: number): void {
    this.used[resource] += amount;
  }

  remaining(resource: keyof BudgetLimits): number {
    return Math.max(0, this.limits[resource] - this.used[resource]);
  }

  usage(): Readonly<BudgetLimits> {
    return { ...this.used };
  }
}
