import { randomBytes } from "node:crypto";
import { createEvent, type Enclosure, type ModelProvider, signEvent } from "@aiagentzoo/sdk";
import type { ChainFacts } from "./chain/pump.ts";
import {
  compact,
  DEFAULT_PLAYBOOK,
  judgeSystem,
  type Outcome,
  outcomeOf,
  parseCalls,
  type Playbook,
  ruleFlags,
  scoreCall,
  skillOf,
  type Verdict,
} from "./agents/judgement.ts";
import type { Observation } from "./agents/nightWatch.ts";

/**
 * "Ask the beaver": anyone pastes a Solana token and gets the beaver's verdict, judged by its current playbook
 * from the same data it sees at night: the market from DexScreener and, for fresh pump.fun tokens, the chain
 * itself. Every answer is signed on the public log, and a day later it is graded against what the token did.
 */

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DAY_MS = 24 * 3_600_000;
/** The same token asked again within this window gets the same answer, not a second model call. */
const REUSE_MS = 30 * 60_000;
const RECENT_MAX = 500;
const DEX = "https://api.dexscreener.com";

export interface AskFacts {
  graduated: boolean;
  hasSocials: boolean | null;
  market: Observation["market"];
  chain: ChainFacts | null;
  flags: string[];
  url: string | null;
}

export interface Ask {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  at: number;
  verdict: Verdict;
  confidence: number;
  why: string;
  /** "model" when the beaver thought it through, "rules" when no model was at hand. */
  by: "model" | "rules";
  playbookVersion: number;
  facts: AskFacts;
  /** The token was already dead when asked: the verdict is shown but never scored. */
  already: boolean;
  graded?: { at: number; outcome: Outcome; hit: boolean | null; liquidityUsd: number | null; change24h: number | null };
}

export type AskResult = { ok: true; ask: Ask; reused: boolean } | { ok: false; status: number; reason: string };

interface DexPair {
  baseToken: { address: string; symbol?: string; name?: string };
  dexId?: string;
  url?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  marketCap?: number;
  info?: { socials?: unknown[]; websites?: unknown[] };
}

export interface AskOptions {
  enclosure: Enclosure;
  model?: ModelProvider;
  /** The node that streams pump.fun, for chain facts. */
  northUrl?: string;
  perIpPerHour?: number;
  perDay?: number;
  fetchFn?: typeof fetch;
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

export class AskDesk {
  private readonly perIp = new Map<string, number[]>();
  private readonly fetchFn: typeof fetch;
  private readonly perIpPerHour: number;
  private readonly perDay: number;

  private readonly opts: AskOptions;

  constructor(opts: AskOptions) {
    this.opts = opts;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.perIpPerHour = opts.perIpPerHour ?? 6;
    this.perDay = opts.perDay ?? 500;
  }

  private get store() {
    return this.opts.enclosure.store;
  }

  private async json<T>(url: string): Promise<T | null> {
    try {
      const r = await this.fetchFn(url, { signal: AbortSignal.timeout(8_000) });
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  }

  /** The deepest pool for a token, with what DexScreener knows about its socials. */
  private async market(mint: string) {
    const pairs = (await this.json<DexPair[]>(`${DEX}/tokens/v1/solana/${mint}`)) ?? [];
    const p = pairs.filter((x) => x.baseToken?.address === mint).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (!p) return null;
    return {
      symbol: (p.baseToken.symbol ?? "?").trim().slice(0, 32),
      name: (p.baseToken.name ?? "").trim().slice(0, 64),
      graduated: Boolean(p.dexId && p.dexId !== "pumpfun"),
      hasSocials: p.info ? Boolean(p.info.socials?.length || p.info.websites?.length) : null,
      marketCapUsd: p.marketCap ?? null,
      url: p.url ?? null,
      market: {
        priceUsd: null,
        liquidityUsd: p.liquidity?.usd ?? null,
        volume24hUsd: p.volume?.h24 ?? null,
        priceChange24h: p.priceChange?.h24 ?? null,
        buys24h: p.txns?.h24?.buys ?? 0,
        sells24h: p.txns?.h24?.sells ?? 0,
        dex: p.dexId ?? null,
        url: p.url ?? null,
      } as NonNullable<Observation["market"]>,
    };
  }

  private async chain(mint: string) {
    if (!this.opts.northUrl) return null;
    return this.json<{ symbol: string; name: string; creator: string; createdAt: number; facts: ChainFacts }>(`${this.opts.northUrl}/v1/chain/token/${mint}`);
  }

  private allowed(ip: string, now: number): boolean {
    const recent = (this.perIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    this.perIp.set(ip, recent);
    if (this.perIp.size > 20_000) for (const [k, v] of this.perIp) if (!v.some((t) => now - t < 3_600_000)) this.perIp.delete(k);
    return recent.length < this.perIpPerHour;
  }

  private async log(type: string, payload: unknown): Promise<void> {
    const { enclosure } = this.opts;
    await enclosure.log.append(signEvent(createEvent({ kind: "system", type, from: { node: enclosure.node.id, agent: "beaver" }, payload }), enclosure.node.identity));
  }

  async ask(mintRaw: unknown, ip: string, now = Date.now()): Promise<AskResult> {
    const mint = typeof mintRaw === "string" ? mintRaw.trim() : "";
    if (!MINT.test(mint)) return { ok: false, status: 400, reason: "that is not a Solana token address" };

    const reuseId = await this.store.get<string>(`ask:mint:${mint}`);
    if (reuseId) {
      const prev = await this.store.get<Ask>(`ask:${reuseId}`);
      if (prev && now - prev.at < REUSE_MS) return { ok: true, ask: prev, reused: true };
    }

    if (!this.allowed(ip, now)) return { ok: false, status: 429, reason: `the beaver answers ${this.perIpPerHour} questions an hour per visitor` };
    const dayKey = `ask:count:${dayOf(now)}`;
    const today = (await this.store.get<number>(dayKey)) ?? 0;
    if (today >= this.perDay) return { ok: false, status: 429, reason: "the beaver is done for today, back after midnight UTC" };

    const [m, c] = await Promise.all([this.market(mint), this.chain(mint)]);
    if (!m && !c) return { ok: false, status: 404, reason: "no market on DexScreener and not on our pump.fun stream: nothing to judge yet" };

    const obs: Observation = {
      mint,
      symbol: m?.symbol ?? c?.symbol ?? "?",
      name: m?.name ?? c?.name ?? "",
      source: "pump",
      createdAt: c?.createdAt ?? null,
      creator: c?.creator ?? null,
      hasSocials: m?.hasSocials ?? null,
      complete: m?.graduated ?? c?.facts.graduated ?? false,
      marketCapUsd: m?.marketCapUsd ?? null,
      market: m?.market ?? null,
      seenAt: now,
      scout: "visitor",
      ...(c ? { chain: c.facts } : {}),
    };

    const playbook = (await this.store.get<Playbook>("beaver:playbook")) ?? DEFAULT_PLAYBOOK;
    let call = null as ReturnType<typeof parseCalls>[number] | null;
    if (this.opts.model) {
      try {
        const result = await this.opts.model.think({ system: judgeSystem(playbook), prompt: "Judge these 1 tokens.", untrusted: [compact(obs)], maxTokens: 700 });
        call = parseCalls(result.text, [obs], now)[0] ?? null;
      } catch {
        // The rules answer instead.
      }
    }
    const flags = ruleFlags(obs);
    if (!call) {
      call = { mint, symbol: obs.symbol, verdict: flags.length >= 2 ? "suspicious" : "watch", confidence: 0.5, why: flags.join(", ") || "not enough evidence either way", by: "rules", at: now };
    }

    const ask: Ask = {
      id: randomBytes(5).toString("hex"),
      mint,
      symbol: obs.symbol,
      name: obs.name,
      at: now,
      verdict: call.verdict,
      confidence: call.confidence,
      why: call.why,
      by: call.by,
      playbookVersion: playbook.version,
      facts: { graduated: obs.complete, hasSocials: obs.hasSocials, market: obs.market, chain: obs.chain ?? null, flags, url: m?.url ?? null },
      already: outcomeOf(obs) === "dead",
    };
    await this.store.set(`ask:${ask.id}`, ask);
    await this.store.set(`ask:mint:${mint}`, ask.id);
    await this.store.set(dayKey, today + 1);
    const recent = (await this.store.get<string[]>("ask:recent")) ?? [];
    await this.store.set("ask:recent", [ask.id, ...recent].slice(0, RECENT_MAX));
    this.perIp.get(ip)!.push(now);
    await this.log("ask.answered", { id: ask.id, mint, symbol: ask.symbol, verdict: ask.verdict, confidence: ask.confidence, why: ask.why, playbook: ask.playbookVersion });
    return { ok: true, ask, reused: false };
  }

  /** An ask, graded first if its day has passed. */
  async get(id: string, now = Date.now()): Promise<Ask | null> {
    const ask = await this.store.get<Ask>(`ask:${id}`);
    if (!ask) return null;
    return this.grade(ask, now);
  }

  private async grade(ask: Ask, now: number): Promise<Ask> {
    if (ask.graded || now - ask.at < DAY_MS) return ask;
    const m = await this.market(ask.mint);
    const outcome = outcomeOf(m ? ({ market: m.market } as Observation) : undefined);
    // No market a day later on a pump.fun token means it never left the curve and faded: that is dead.
    const final: Outcome = m ? outcome : "dead";
    const graded: Ask = {
      ...ask,
      graded: { at: now, outcome: final, hit: ask.already ? null : scoreCall(ask.verdict, final), liquidityUsd: m?.market.liquidityUsd ?? null, change24h: m?.market.priceChange24h ?? null },
    };
    await this.store.set(`ask:${ask.id}`, graded);
    await this.log("ask.graded", { id: ask.id, mint: ask.mint, verdict: ask.verdict, outcome: final, hit: graded.graded!.hit });
    return graded;
  }

  /** The newest asks, grading a few that came due, and the beaver's record on asks so far. */
  async recent(limit = 24, now = Date.now()) {
    const ids = (await this.store.get<string[]>("ask:recent")) ?? [];
    const asks: Ask[] = [];
    let graded = 0;
    for (const id of ids) {
      let a = await this.store.get<Ask>(`ask:${id}`);
      if (!a) continue;
      if (!a.graded && now - a.at >= DAY_MS && graded < 5) {
        a = await this.grade(a, now);
        graded += 1;
      }
      asks.push(a);
    }
    const fair = asks.filter((a) => a.graded && !a.already && a.graded.outcome !== "unknown");
    const t = {
      dead: fair.filter((a) => a.graded!.outcome === "dead").length,
      deadRight: fair.filter((a) => a.graded!.outcome === "dead" && a.verdict === "suspicious").length,
      alive: fair.filter((a) => a.graded!.outcome === "alive").length,
      aliveRight: fair.filter((a) => a.graded!.outcome === "alive" && a.verdict === "promising").length,
    };
    return { asked: ids.length, record: { ...t, graded: t.dead + t.alive, skill: skillOf(t) }, asks: asks.slice(0, limit) };
  }
}
