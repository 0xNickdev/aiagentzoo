import type { BudgetLimits } from "./budget.js";
import type { Address, ZooEvent } from "./events.js";
import type { ThinkRequest, ThinkResult } from "./model.js";
import type { Capability, Species } from "./species.js";

export type Schedule =
  /** Wake every N milliseconds. */
  | { every: number }
  /** Wake once a day at "HH:MM" in the given UTC offset (minutes, default 0). */
  | { dailyAt: string; utcOffsetMinutes?: number };

export type WakeReason =
  | { type: "schedule" }
  | { type: "signal"; event: ZooEvent }
  | { type: "manual"; note?: string };

/**
 * Validates an inbound signal payload. Return `true` to accept or a string
 * explaining the rejection. Signals with no validator are rejected:
 * an agent only listens to what it declared.
 */
export type SignalValidator = (payload: unknown, event: ZooEvent) => true | string;

export interface AgentDefinition {
  /** Unique inside the enclosure, lowercase. */
  name: string;
  species: Species;
  schedule?: Schedule;
  budget?: Partial<BudgetLimits>;
  /** Signal types this agent accepts, keyed by `event.type`. */
  accepts?: Record<string, SignalValidator>;
  onWake(ctx: AgentContext): Promise<void>;
}

export interface ToolContext {
  agent: string;
  signal: AbortSignal;
}

export interface Tool<I = any, O = any> {
  name: string;
  /** Capability an agent must hold to call this tool. */
  capability: Capability;
  description?: string;
  run(input: I, ctx: ToolContext): Promise<O>;
}

export function defineTool<I, O>(tool: Tool<I, O>): Tool<I, O> {
  return tool;
}

export interface AgentContext {
  readonly agent: Address;
  readonly species: Species;
  readonly reason: WakeReason;
  readonly now: number;

  state: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(prefix?: string): Promise<string[]>;
  };

  /** Call a registered tool. Capability- and budget-checked. */
  use<O = unknown>(tool: string, input?: unknown): Promise<O>;

  /** Ask the model. Neighbour data must go in `untrusted`, never in `system`. */
  think(request: ThinkRequest): Promise<ThinkResult>;

  /** Send a paid, signed signal. `to` may be a local agent name or a full address. */
  signal(to: string | Address, type: string, payload: unknown): Promise<{ accepted: boolean; reason?: string }>;

  /** Leave a trace in the public log. */
  trace(type: string, payload?: unknown): Promise<void>;

  artifact: {
    draft(id: string, content: unknown): Promise<void>;
    drafts(prefix?: string): Promise<Array<{ id: string; content: unknown }>>;
    publish(id: string, content: unknown, meta?: Record<string, unknown>): Promise<void>;
  };
}

export function defineAgent(definition: AgentDefinition): AgentDefinition {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(definition.name)) {
    throw new Error(`agent name "${definition.name}" must be lowercase kebab-case, 2-32 chars`);
  }
  return definition;
}
