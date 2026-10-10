/**
 * Runs the nursery through simulated nights with a stand-in model and random outcomes, and prints what the
 * evolution page would receive. For previewing the page; nothing here touches a real node.
 *
 *   node scripts/sim-nursery.ts [nights] > nursery.json
 */
import { EchoProvider, Enclosure, Identity } from "@aiagentzoo/sdk";
import { creatureView, EVO, evolutionAgent, evolutionView } from "../src/agents/evolution.ts";

const nights = Number(process.argv[2] ?? 12);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const mint = () => Array.from({ length: 40 }, () => ALPHA[Math.floor(rand() * ALPHA.length)]).join("") + "pump";
const SYMBOLS = ["READ", "DERP", "WLOB", "ClapCat", "NVIDIA", "MOMO", "QTC", "SHUFFLE", "TSUKI", "JOEY", "NOAH", "BRAINROT", "Luna", "FLAGZ", "GOONCAT", "ELIZA"];

let now = Date.UTC(2026, 9, 10, 9, 0);
let exam: string[] = [];
const model = new EchoProvider((req) => {
  if (req.system.includes("are breeding")) {
    const rules = ["Liquidity under $3k is suspicious.", "No socials plus sells 2:1 over buys is a rug in progress.", "Graduated with steady buys deserves a watch.", "Brand copies die within a day."];
    const mutation = ["A ticker launched three times in an hour is suspicious.", "Volume 30x liquidity on a fresh token is wash trading.", "A drop over 60% with liquidity intact is a promising rebound.", "Socials added after launch mean nothing."][Math.floor(rand() * 4)]!;
    return JSON.stringify({ playbook: [...rules.slice(0, 3), mutation].map((r, i) => `${i + 1}. ${r}`).join("\n"), mutation });
  }
  if (req.system.includes("selected out")) return ["I trusted volume; volume did not trust me back.", "Every rug looked like a launch to me.", "I waited for two signals. The market needed one.", "Optimism is not a liquidity source."][Math.floor(rand() * 4)]!;
  const bias = /Fox|Badger|Stoat/.test(req.system) ? 0.75 : /Moth|Wren/.test(req.system) ? 0.3 : 0.55;
  return JSON.stringify(exam.map((m) => {
    const r = rand();
    return { mint: m, verdict: r < bias ? "suspicious" : r < bias + 0.15 ? "watch" : "promising", confidence: 0.6, why: "rule 1 applied" };
  }));
});
const enclosure = new Enclosure({
  node: { id: "canyon.zoo", identity: Identity.generate(), operator: "op" },
  keeper: "keeper",
  model,
  clock: () => now,
  agents: [evolutionAgent({ briefAt: "07:00", examAfter: 3, judgesPerWake: 8 })],
});
const nightId = (t: number) => new Date(t + (new Date(t).getUTCHours() >= 7 ? 86_400_000 : 0)).toISOString().slice(0, 10);

for (let n = 0; n < nights; n++) {
  const night = nightId(now);
  const prev = new Date(Date.parse(`${night}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const prevExam = (await enclosure.store.get<{ tokens: Array<{ mint: string; symbol: string }> }>(EVO.exam(prev)))?.tokens ?? [];
  // About 70% of fresh tokens are dead by the next day.
  await enclosure.store.set(`followup:${prev}`, Object.fromEntries(prevExam.map((t) => [t.mint, { symbol: t.symbol, outcome: rand() < 0.7 ? "dead" : "alive" }])));
  exam = Array.from({ length: 8 }, mint);
  await enclosure.store.set(`obs:${night}`, Object.fromEntries(exam.map((m, i) => [m, { mint: m, symbol: SYMBOLS[(n * 3 + i) % SYMBOLS.length], name: "", source: "pump", createdAt: now, creator: null, hasSocials: rand() > 0.5, complete: rand() > 0.8, marketCapUsd: 5000, market: { priceUsd: 0.001, liquidityUsd: 2000 + rand() * 30000, volume24hUsd: rand() * 200000, priceChange24h: rand() * 400 - 80, buys24h: 100, sells24h: 140, dex: "pumpswap", url: null }, seenAt: now }])));
  await enclosure.wake("heron");
  now += 86_400_000;
}
// One more wake: the last night's exam stays ungraded, as it would be live.
const view = await evolutionView(enclosure.store, "07:00", now - 86_400_000);
const details = Object.fromEntries(await Promise.all(view!.creatures.map(async (c) => [c.id, await creatureView(enclosure.store, c.id)])));
console.log(JSON.stringify({ view, details }));
