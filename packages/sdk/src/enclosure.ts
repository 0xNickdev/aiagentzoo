import type { AgentContext, AgentDefinition, Tool, WakeReason } from "./agent.js";
import { Budget, DEFAULT_BUDGET } from "./budget.js";
import { canonicalJson, type Identity, sha256 } from "./crypto.js";
import { BudgetExceeded, InsufficientFeed, PermissionDenied, ZooError } from "./errors.js";
import { type Address, assertSigned, createEvent, type EventKind, signEvent, type ZooEvent } from "./events.js";
import { type DeliveryResult, PeerDirectory, type Transport } from "./federation.js";
import { FeedLedger } from "./ledger.js";
import { type LogEntry, PublicLog } from "./log.js";
import { type ModelProvider, renderUntrusted, UNTRUSTED_NOTICE } from "./model.js";
import { nextRun } from "./schedule.js";
import type { Capability } from "./species.js";
import { MemoryStore, type StateStore } from "./store.js";

export interface NodeInfo {
  /** Public node id, e.g. `node-a.zoo`. Used in every address. */
  id: string;
  identity: Identity;
  /** Ledger account of whoever pays for compute on this node. */
  operator: string;
}

export interface EnclosureOptions {
  node: NodeInfo;
  /** Display name, e.g. "Northern Edge". */
  name?: string;
  /** Ledger account of the keeper who feeds this enclosure. */
  keeper: string;
  agents: AgentDefinition[];
  tools?: Tool[];
  store?: StateStore;
  log?: PublicLog;
  /** Without a ledger the enclosure runs unmetered (useful for local dev). */
  ledger?: FeedLedger;
  model?: ModelProvider;
  peers?: PeerDirectory;
  transport?: Transport;
  clock?: () => number;
  /** Identical non-empty outputs this many sessions in a row pause the agent. */
  loopThreshold?: number;
  /** Scheduler resolution. */
  tickMs?: number;
}

export type AgentStatus = "asleep" | "awake" | "paused" | "hungry";

export interface AgentSnapshot {
  name: string;
  species: string;
  status: AgentStatus;
  nextRunAt: number | null;
  sessions: number;
  pausedReason?: string;
}

interface AgentRuntime {
  def: AgentDefinition;
  status: AgentStatus;
  nextRunAt: number | null;
  queue: Promise<void>;
  sessions: number;
  lastFingerprint?: string;
  repeats: number;
  pausedReason?: string;
}

export class Enclosure {
  readonly node: NodeInfo;
  readonly name: string;
  readonly keeper: string;
  readonly log: PublicLog;
  readonly store: StateStore;
  readonly ledger: FeedLedger | undefined;
  readonly peers: PeerDirectory;

  private readonly tools = new Map<string, Tool>();
  private readonly agents = new Map<string, AgentRuntime>();
  private readonly model: ModelProvider | undefined;
  private readonly transport: Transport | undefined;
  private readonly clock: () => number;
  private readonly loopThreshold: number;
  private readonly tickMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private retired = false;
  private signalStats = { sent: 0, rejected: 0 };

  constructor(options: EnclosureOptions) {
    this.node = options.node;
    this.name = options.name ?? options.node.id;
    this.keeper = options.keeper;
    this.store = options.store ?? new MemoryStore();
    this.log = options.log ?? new PublicLog();
    this.ledger = options.ledger;
    this.model = options.model;
    this.peers = options.peers ?? new PeerDirectory();
    this.transport = options.transport;
    this.clock = options.clock ?? Date.now;
    this.loopThreshold = options.loopThreshold ?? 5;
    this.tickMs = options.tickMs ?? 1000;
    for (const tool of options.tools ?? []) this.tools.set(tool.name, tool);
    for (const def of options.agents) {
      if (this.agents.has(def.name)) throw new Error(`duplicate agent "${def.name}"`);
      this.agents.set(def.name, {
        def,
        status: "asleep",
        nextRunAt: def.schedule ? nextRun(def.schedule, this.clock()) : null,
        queue: Promise.resolve(),
        sessions: 0,
        repeats: 0,
      });
    }
  }

  address(agent: string): Address {
    return { node: this.node.id, agent };
  }

  /** Start the scheduler. Wake-ups that are due fire on the next tick. */
  start(): void {
    if (this.timer || this.retired) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Warden kill-switch. Not for sale: needs no token, cannot be undone. */
  async retire(reason: string): Promise<void> {
    this.stop();
    this.retired = true;
    const released = this.ledger?.releaseStake(this.keeper, this.node.id) ?? 0;
    await this.emit("system", "enclosure.retired", null, { reason, stakeReturned: released });
  }

  get isRetired(): boolean {
    return this.retired;
  }

  /** Lock the stake required to write to the network. */
  async lockStake(): Promise<void> {
    if (!this.ledger) return;
    this.ledger.lockStake(this.keeper, this.node.id);
    await this.emit("system", "stake.locked", null, { amount: this.ledger.stakeOf(this.node.id) });
  }

  snapshot(): AgentSnapshot[] {
    return [...this.agents.values()].map((rt) => ({
      name: rt.def.name,
      species: rt.def.species.id,
      status: rt.status,
      nextRunAt: rt.nextRunAt,
      sessions: rt.sessions,
      ...(rt.pausedReason ? { pausedReason: rt.pausedReason } : {}),
    }));
  }

  async tick(): Promise<void> {
    if (this.retired) return;
    const now = this.clock();
    for (const rt of this.agents.values()) {
      if (rt.nextRunAt !== null && rt.nextRunAt <= now && rt.status !== "paused") {
        rt.nextRunAt = rt.def.schedule ? nextRun(rt.def.schedule, now) : null;
        void this.wake(rt.def.name, { type: "schedule" });
      }
    }
  }

  /** Run one session for `agent`. Sessions of the same agent never overlap. */
  wake(agent: string, reason: WakeReason = { type: "manual" }): Promise<void> {
    const rt = this.agents.get(agent);
    if (!rt) return Promise.reject(new Error(`unknown agent "${agent}"`));
    rt.queue = rt.queue.then(() => this.session(rt, reason)).catch(() => undefined);
    return rt.queue;
  }

  /**
   * Accept an inbound signal (local or from a peer). The signature is checked
   * against the sender node's key, the payload against the recipient's
   * declared schema. Anything undeclared is rejected.
   */
  async deliver(event: ZooEvent): Promise<DeliveryResult> {
    const result = await this.check(event);
    await this.emit("system", result.accepted ? "signal.accepted" : "signal.rejected", null, {
      id: event.id,
      from: event.from,
      to: event.to,
      type: event.type,
      ...(result.reason ? { reason: result.reason } : {}),
    });
    if (result.accepted && event.to) {
      const rt = this.agents.get(event.to.agent);
      if (rt?.status === "paused" && rt.pausedReason === "loop") {
        rt.status = "asleep";
        delete rt.pausedReason;
      }
      void this.wake(event.to.agent, { type: "signal", event });
    }
    return result;
  }

  private async check(event: ZooEvent): Promise<DeliveryResult> {
    if (this.retired) return { accepted: false, reason: "enclosure retired" };
    if (event.v !== 1 || event.kind !== "signal") return { accepted: false, reason: "not a v1 signal" };
    if (!event.to || event.to.node !== this.node.id) return { accepted: false, reason: "wrong node" };
    const rt = this.agents.get(event.to.agent);
    if (!rt) return { accepted: false, reason: `no agent "${event.to.agent}"` };
    const key = event.from.node === this.node.id ? this.node.identity.publicKey : this.peers.get(event.from.node)?.publicKey;
    if (!key) return { accepted: false, reason: `unknown node "${event.from.node}"` };
    try {
      assertSigned(event, key);
    } catch (error) {
      return { accepted: false, reason: (error as Error).message };
    }
    const validate = rt.def.accepts?.[event.type];
    if (!validate) return { accepted: false, reason: `"${rt.def.name}" does not accept "${event.type}"` };
    let verdict: true | string;
    try {
      verdict = validate(event.payload, event);
    } catch (error) {
      verdict = (error as Error).message;
    }
    return verdict === true ? { accepted: true } : { accepted: false, reason: verdict };
  }

  private async session(rt: AgentRuntime, reason: WakeReason): Promise<void> {
    if (this.retired || rt.status === "paused") return;
    const { def } = rt;

    if (this.ledger && !this.ledger.canAfford(this.keeper, this.ledger.cycleCost(0))) {
      rt.status = "hungry";
      await this.emit("system", "agent.hungry", def.name, { balance: this.ledger.balance(this.keeper) });
      return;
    }

    rt.status = "awake";
    rt.sessions += 1;
    const budget = new Budget(def.name, { ...DEFAULT_BUDGET, ...def.budget });
    const outputs: unknown[] = [];
    const ctx = this.context(def, reason, budget, outputs);
    await this.emit("trace", "agent.woke", def.name, {
      reason: reason.type,
      ...(reason.type === "signal" ? { signal: reason.event.id } : {}),
      ...(reason.type === "manual" && reason.note ? { note: reason.note } : {}),
    });

    try {
      await def.onWake(ctx);
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        await this.emit("system", "budget.stop", def.name, { resource: error.resource });
      } else if (error instanceof PermissionDenied) {
        await this.emit("system", "permission.denied", def.name, { capability: error.capability });
      } else if (error instanceof InsufficientFeed) {
        await this.emit("system", "agent.hungry", def.name, { needed: error.needed, available: error.available });
      } else {
        await this.emit("system", "agent.error", def.name, {
          error: error instanceof ZooError ? error.code : "unhandled",
          message: (error as Error).message?.slice(0, 500),
        });
      }
    }

    const used = budget.usage();
    if (this.ledger) {
      try {
        const cost = this.ledger.settleCycle(this.keeper, this.node.operator, used.modelTokens, `${def.name}#${rt.sessions}`);
        await this.emit("system", "cycle.settled", def.name, { cost, modelTokens: used.modelTokens, steps: used.steps });
      } catch (error) {
        if (!(error instanceof InsufficientFeed)) throw error;
        rt.status = "hungry";
        await this.emit("system", "agent.hungry", def.name, { needed: error.needed, available: error.available });
        return;
      }
    }

    rt.status = "asleep";
    if (this.detectLoop(rt, outputs)) {
      await this.emit("system", "loop.stop", def.name, { repeats: rt.repeats });
    }
  }

  /** Identical, non-empty outputs N sessions in a row mean the agent is spinning. */
  private detectLoop(rt: AgentRuntime, outputs: unknown[]): boolean {
    if (outputs.length === 0) {
      rt.repeats = 0;
      delete rt.lastFingerprint;
      return false;
    }
    const fingerprint = sha256(canonicalJson(outputs));
    rt.repeats = fingerprint === rt.lastFingerprint ? rt.repeats + 1 : 1;
    rt.lastFingerprint = fingerprint;
    if (rt.repeats < this.loopThreshold) return false;
    rt.status = "paused";
    rt.pausedReason = "loop";
    return true;
  }

  private context(def: AgentDefinition, reason: WakeReason, budget: Budget, outputs: unknown[]): AgentContext {
    const name = def.name;
    const require = (capability: Capability) => {
      if (!def.species.capabilities.has(capability)) throw new PermissionDenied(name, capability);
    };

    return {
      agent: this.address(name),
      species: def.species,
      reason,
      now: this.clock(),

      state: {
        get: async <T>(key: string) => {
          require("state:read");
          return (await this.store.get<T>(key)) ?? undefined;
        },
        set: async (key, value) => {
          require("state:write");
          budget.charge("steps");
          outputs.push({ set: key, value });
          await this.store.set(key, value);
        },
        delete: async (key) => {
          require("state:write");
          budget.charge("steps");
          outputs.push({ delete: key });
          await this.store.delete(key);
        },
        keys: async (prefix) => {
          require("state:read");
          return this.store.keys(prefix);
        },
      },

      use: async <O>(toolName: string, input?: unknown) => {
        const tool = this.tools.get(toolName);
        if (!tool) throw new ZooError(`unknown tool "${toolName}"`, "unknown_tool");
        require(tool.capability);
        budget.charge("steps");
        return (await tool.run(input, { agent: name, signal: AbortSignal.timeout(30_000) })) as O;
      },

      think: async (request) => {
        require("model:think");
        if (!this.model) throw new ZooError("no model provider configured", "no_model");
        if (budget.remaining("modelTokens") <= 0) throw new BudgetExceeded(name, "modelTokens");
        const hasUntrusted = request.untrusted !== undefined;
        const result = await this.model.think({
          ...request,
          system: hasUntrusted ? `${request.system}\n\n${UNTRUSTED_NOTICE}` : request.system,
          prompt: hasUntrusted ? `${request.prompt}\n\n${renderUntrusted(request.untrusted)}` : request.prompt,
          maxTokens: Math.min(request.maxTokens ?? 4000, budget.remaining("modelTokens")),
        });
        budget.record("modelTokens", result.inputTokens + result.outputTokens);
        return result;
      },

      signal: async (to, type, payload) => {
        require("signal:send");
        budget.charge("signals");
        const target = typeof to === "string" ? this.address(to) : to;
        if (this.ledger && this.ledger.params.enclosureStake > 0 && this.ledger.stakeOf(this.node.id) <= 0) {
          throw new ZooError("enclosure has no stake locked; it may read but not write to the network", "no_stake");
        }
        const event = signEvent(
          createEvent({ kind: "signal", type, from: this.address(name), to: target, payload, ts: this.clock() }),
          this.node.identity,
        );
        this.ledger?.chargeSignal(this.keeper, event.id);
        outputs.push({ signal: target, type, payload });
        await this.log.append(event);

        const result = await this.route(event);
        this.ledger?.settleSignal(target.node === this.node.id ? this.keeper : `remote:${target.node}`, result.accepted, event.id);
        // The sender records the verdict too, so both sides of every signal are on the record.
        await this.emit("trace", "signal.delivered", name, {
          id: event.id,
          to: target,
          type,
          accepted: result.accepted,
          ...(result.reason ? { reason: result.reason } : {}),
        });
        await this.recordSignal(result.accepted);
        return result;
      },

      trace: async (type, payload) => {
        outputs.push({ trace: type, payload });
        await this.emit("trace", type, name, payload ?? null);
      },

      artifact: {
        draft: async (id, content) => {
          require("artifact:draft");
          budget.charge("steps");
          outputs.push({ draft: id, content });
          await this.store.set(`artifact:${id}`, content);
          await this.emit("trace", "artifact.drafted", name, { id });
        },
        drafts: async (prefix = "") => {
          require("artifact:draft");
          const keys = await this.store.keys(`artifact:${prefix}`);
          return Promise.all(keys.map(async (key) => ({ id: key.slice("artifact:".length), content: await this.store.get(key) })));
        },
        publish: async (id, content, meta) => {
          require("artifact:publish");
          budget.charge("steps");
          outputs.push({ publish: id, content });
          await this.emit("artifact", "artifact.published", name, {
            id,
            sha256: sha256(canonicalJson(content)),
            content,
            ...(meta ? { meta } : {}),
          });
        },
      },
    };
  }

  private async route(event: ZooEvent): Promise<DeliveryResult> {
    const node = event.to!.node;
    if (node === this.node.id) return this.deliver(event);
    const peer = this.peers.get(node);
    if (!peer) return { accepted: false, reason: `unknown peer "${node}"` };
    if (!this.transport) return { accepted: false, reason: "no transport configured" };
    return this.transport.send(peer, event);
  }

  /** The spam rule lives in code: too many rejected signals slash the sender's own stake. */
  private async recordSignal(accepted: boolean): Promise<void> {
    this.signalStats.sent += 1;
    if (!accepted) this.signalStats.rejected += 1;
    if (!this.ledger) return;
    const { sent, rejected } = this.signalStats;
    const { spamMinSignals, spamRejectRatio } = this.ledger.params;
    if (sent >= spamMinSignals && rejected / sent > spamRejectRatio) {
      const amount = this.ledger.slash(this.node.id);
      this.signalStats = { sent: 0, rejected: 0 };
      await this.emit("system", "stake.slashed", null, { amount, rejected, sent, rule: "spam" });
    }
  }

  private async emit(kind: EventKind, type: string, agent: string | null, payload: unknown): Promise<LogEntry> {
    const event = signEvent(
      createEvent({ kind, type, from: this.address(agent ?? "warden"), payload, ts: this.clock() }),
      this.node.identity,
    );
    return this.log.append(event);
  }
}
