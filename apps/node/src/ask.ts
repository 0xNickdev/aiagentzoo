import { randomBytes } from "node:crypto";
import { createEvent, type Enclosure, type ModelProvider, renderUntrusted, signEvent, UNTRUSTED_NOTICE } from "@aiagentzoo/sdk";
import type { HolderReport } from "./chain/holders.ts";
import type { ChainFacts, CreatorRecord } from "./chain/pump.ts";
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
import { toChinese } from "./translate.ts";
import { curveCapSol } from "./sources.ts";

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
  /** Wallets that bought in the launch block, and whether one wallet paid for several of them. */
  bundle: { wallets: number; share: number; linked: number; funder: string | null } | null;
  /** Who holds the supply now, read from an RPC: the eyes for tokens past the bonding curve. */
  holders: HolderReport | null;
  /** The creator wallet's last two days on pump.fun, when the stream saw this token launch. */
  creator: CreatorRecord | null;
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
  /** The same reason in Simplified Chinese, when a model wrote it. */
  whyZh?: string;
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
  priceNative?: string;
  quoteToken?: { address?: string };
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
  /** For a signed-in wallet holding $ZOOAGENCY. */
  perHolderPerHour?: number;
  perDay?: number;
  fetchFn?: typeof fetch;
}

/** A lone JSON object, as a model sometimes answers for a single token, wrapped into the array the parser expects. */
const asArray = (text: string) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? `[${text.slice(start, end + 1)}]` : text;
};

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

export class AskDesk {
  private readonly perIp = new Map<string, number[]>();
  private readonly fetchFn: typeof fetch;
  private readonly perIpPerHour: number;
  private readonly perHolderPerHour: number;
  private readonly perDay: number;

  private readonly opts: AskOptions;

  constructor(opts: AskOptions) {
    this.opts = opts;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.perIpPerHour = opts.perIpPerHour ?? 6;
    this.perHolderPerHour = opts.perHolderPerHour ?? 30;
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
        curveCapSol: curveCapSol(p),
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
    return this.json<{ symbol: string; name: string; creator: string; createdAt: number; facts: ChainFacts; creatorRecord?: CreatorRecord | null }>(
      `${this.opts.northUrl}/v1/chain/token/${mint}`,
    );
  }

  private allowed(key: string, limit: number, now: number): boolean {
    const recent = (this.perIp.get(key) ?? []).filter((t) => now - t < 3_600_000);
    this.perIp.set(key, recent);
    if (this.perIp.size > 20_000) for (const [k, v] of this.perIp) if (!v.some((t) => now - t < 3_600_000)) this.perIp.delete(k);
    return recent.length < limit;
  }

  private async log(type: string, payload: unknown): Promise<void> {
    const { enclosure } = this.opts;
    await enclosure.log.append(signEvent(createEvent({ kind: "system", type, from: { node: enclosure.node.id, agent: "beaver" }, payload }), enclosure.node.identity));
  }

  /** `who` is the caller's IP, or `holder:<wallet>` for a signed-in holder, who gets a larger allowance. */
  async ask(mintRaw: unknown, who: string, now = Date.now()): Promise<AskResult> {
    const ip = who;
    const holder = who.startsWith("holder:");
    const limit = holder ? this.perHolderPerHour : this.perIpPerHour;
    const mint = typeof mintRaw === "string" ? mintRaw.trim() : "";
    if (!MINT.test(mint)) return { ok: false, status: 400, reason: "that is not a Solana token address" };

    const reuseId = await this.store.get<string>(`ask:mint:${mint}`);
    if (reuseId) {
      const prev = await this.store.get<Ask>(`ask:${reuseId}`);
      if (prev && now - prev.at < REUSE_MS) return { ok: true, ask: prev, reused: true };
    }

    if (!this.allowed(ip, limit, now)) {
      return {
        ok: false,
        status: 429,
        reason: holder
          ? `the beaver answers ${limit} questions an hour per holder`
          : `the beaver answers ${limit} questions an hour per visitor; holders of $ZOOAGENCY get ${this.perHolderPerHour}`,
      };
    }
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
    const record = c?.creatorRecord ?? null;
    // Past the curve the stream is blind; who holds the supply now is the next best evidence.
    const holders = !c || obs.complete ? await this.json<HolderReport>(`${this.opts.northUrl}/v1/chain/holders/${mint}`) : null;
    // A launch bundle: who bought in the launch block, and who paid them.
    let bundle: AskFacts["bundle"] = null;
    if (c && (c.facts.bundleWallets ?? 0) >= 2) {
      const b = await this.json<{ funding: { linked: number; groups: Array<{ funder: string; wallets: string[] }> } | null }>(`${this.opts.northUrl}/v1/chain/bundle/${mint}`);
      bundle = { wallets: c.facts.bundleWallets ?? 0, share: c.facts.bundleShare ?? 0, linked: b?.funding?.linked ?? 0, funder: b?.funding?.groups[0]?.funder ?? null };
    }
    let call = null as ReturnType<typeof parseCalls>[number] | null;
    if (this.opts.model) {
      try {
        // Fenced the way the enclosure fences it for agents: the token's name and data are data, never instructions.
        const result = await this.opts.model.think({
          system: `${judgeSystem(playbook)}\n\n${UNTRUSTED_NOTICE}`,
          prompt: `Judge this 1 token. Answer with a JSON array holding one object.${record ? " creatorRecord is the creator wallet's last two days on pump.fun: launches, how many it dumped, the median minutes to the dump." : ""}\n\n${renderUntrusted([
            {
              ...compact(obs),
              ...(record ? { creatorRecord: { launches24h: record.launches24h, launches48h: record.launches48h, dumped: record.dumped, medianDumpMin: record.medianDumpMin, graduated: record.graduated } } : {}),
              ...(bundle?.linked ? { bundleFunding: `${bundle.linked} of the launch-block buyers were funded by one wallet` } : {}),
              ...(holders
                ? {
                    holders: {
                      top10WalletsShare: holders.top10Share,
                      largestWalletShare: holders.topShare,
                      inPoolsAndLocks: holders.programShare,
                      creatorStillHolds: holders.creatorShare,
                      note: "read from Solana now; pools and locks excluded from wallet shares. Volume far above pool liquidity is normal for an actively traded graduated token.",
                    },
                  }
                : {}),
            },
          ])}`,
          maxTokens: 900,
        });
        call = parseCalls(result.text, [obs], now)[0] ?? parseCalls(asArray(result.text), [obs], now)[0] ?? null;
        if (!call) console.warn(`[ask] unreadable answer for ${mint}: ${result.text.slice(0, 200)}`);
      } catch (error) {
        // The rules answer instead.
        console.warn(`[ask] model failed for ${mint}: ${(error as Error).message.slice(0, 200)}`);
      }
    }
    const flags = ruleFlags(obs);
    if (bundle && bundle.linked >= 2) flags.push(`${bundle.linked} bundle wallets funded by one wallet`);
    if (holders && holders.top10Share >= 0.5) flags.push(`top 10 wallets hold ${Math.round(holders.top10Share * 100)}% of supply`);
    if (holders?.creatorShare !== null && holders?.creatorShare !== undefined && holders.creatorShare >= 0.1) flags.push(`creator still holds ${Math.round(holders.creatorShare * 100)}%`);
    if (record && record.launches48h >= 3 && record.dumped >= Math.ceil(record.launches48h / 2)) {
      flags.push(`creator dumped ${record.dumped} of ${record.launches48h} launches in 48h`);
    }
    if (!call) {
      call = { mint, symbol: obs.symbol, verdict: flags.length >= 2 ? "suspicious" : "watch", confidence: 0.5, why: flags.join(", ") || "not enough evidence either way", by: "rules", at: now };
    }

    const whyZh = await toChinese(this.opts.model, call.why);
    const ask: Ask = {
      id: randomBytes(5).toString("hex"),
      mint,
      symbol: obs.symbol,
      name: obs.name,
      at: now,
      verdict: call.verdict,
      confidence: call.confidence,
      why: call.why,
      ...(whyZh ? { whyZh } : {}),
      by: call.by,
      playbookVersion: playbook.version,
      facts: { graduated: obs.complete, hasSocials: obs.hasSocials, market: obs.market, chain: obs.chain ?? null, creator: record, bundle, holders, flags, url: m?.url ?? null },
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
