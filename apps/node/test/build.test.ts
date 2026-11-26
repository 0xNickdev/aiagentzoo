import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { test } from "node:test";
import { CallBudget, checkBuild, dependenciesOf, entryPointsOf, factsOf, parseVerdict, pickFiles, rankFiles, rerankByImports, promptOf, scoreOf, SYSTEM, type BuildCheck, type BuildDeps, type TreeEntry } from "../src/claims/build.ts";
import type { Claims } from "../src/claims/claims.ts";
import { buildCaller } from "../src/routes/claims.ts";

const MINT = "2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B";
const NOW = Date.parse("2026-11-26T12:00:00Z");
const SHA = "a".repeat(40);
const gh = (over: Partial<Claims["github"]> = {}): Claims["github"] => ({ status: "mutual", repo: "o/r", url: "https://github.com/o/r", commits: 80, activity: "shipping", fork: false, flags: [], ...over });
const claims = (over: Partial<Claims["github"]> = {}): Claims => ({ mint: MINT, readAt: NOW, website: "https://tok.example", x: null, metadataRead: true, websiteRead: true, github: gh(over), dex: { paid: false }, account: { status: "none", flags: [] }, telegram: { status: "none", flags: [] } });

const TREE: TreeEntry[] = [
  { path: "README.md", type: "blob", size: 900 },
  { path: "package.json", type: "blob", size: 300 },
  { path: "package-lock.json", type: "blob", size: 90_000 },
  { path: "src/agent/brain.ts", type: "blob", size: 6_000 },
  { path: "src/trade/jupiter.ts", type: "blob", size: 5_000 },
  { path: "src/index.ts", type: "blob", size: 800 },
  { path: "test/agent.test.ts", type: "blob", size: 2_000 },
  { path: "node_modules/openai/index.js", type: "blob", size: 70_000 },
  { path: "dist/bundle.min.js", type: "blob", size: 300_000 },
  { path: "src", type: "tree" },
];

function world(over: { llm?: BuildDeps["llm"]; tree?: TreeEntry[]; head?: number; claims?: Claims | null } = {}) {
  const calls = { llm: 0, prompts: [] as string[] };
  const mem = new Map<string, BuildCheck>();
  const d: BuildDeps = {
    now: () => NOW,
    claims: async () => (over.claims === undefined ? claims() : over.claims),
    metadata: async () => ({ name: "Agent Coin", symbol: "AGC", description: "An AI agent that trades on Jupiter for you." }),
    json: async (u) => {
      if (u.endsWith("/commits/HEAD")) return { status: over.head ?? 200, body: { sha: SHA }, link: null };
      if (u.includes("/git/trees/")) return { status: 200, body: { tree: over.tree ?? TREE }, link: null };
      if (u.endsWith("/languages")) return { status: 200, body: { TypeScript: 9000, CSS: 10 }, link: null };
      return null;
    },
    page: async (u) => {
      if (u.startsWith("https://tok.example")) return { status: 200, url: u, body: "<html><title>AGC</title><script>x()</script><p>Autonomous trading agent</p></html>" };
      if (u.endsWith("/package.json")) return { status: 200, url: u, body: JSON.stringify({ dependencies: { openai: "4", "@jup-ag/api": "6", "@solana/web3.js": "1" }, devDependencies: { typescript: "5" } }) };
      if (u.endsWith("/README.md")) return { status: 200, url: u, body: "# AGC\nAn agent." };
      return { status: 200, url: u, body: "export const x = 1;" };
    },
    llm:
      over.llm === undefined
        ? async (_s, user) => {
            calls.llm += 1;
            calls.prompts.push(user);
            return JSON.stringify({ claims: [{ claim: "an AI agent", status: "matches", evidence: [{ path: "src/agent/brain.ts", why: "calls the model" }, { path: "src/made/up.ts", why: "invented" }] }, { claim: "trades on Jupiter", status: "partly", evidence: [{ path: "src/trade/jupiter.ts", why: "quote only" }] }], overall: { summary: "It is a legit agent — mostly.", matchScore: 70 } });
          }
        : over.llm,
    store: { get: (k) => mem.get(k), set: (k, v) => void mem.set(k, v) },
  };
  return { d, calls, mem };
}

test("an eliza-like monorepo sends the runtime and entry points, not android tests or plugin shells", () => {
  const tree: TreeEntry[] = [];
  const f = (path: string, size = 6_000) => tree.push({ path, type: "blob", size });
  for (let i = 0; i < 30; i++) f(`packages/os/android/app-update/src/androidTest/java/ai/eliza/agent/AgentContract${i}.java`);
  for (let i = 0; i < 10; i++) f(`packages/plugin-x/android/src/main/kotlin/ai/eliza/AgentModel${i}.kt`);
  for (let i = 0; i < 10; i++) f(`packages/core/src/__tests__/agent${i}.test.ts`);
  for (let i = 0; i < 6; i++) f(`examples/agent-chat/src/agent${i}.ts`);
  f("docs/agent/memory.ts");
  f("scripts/build-agent.ts");
  f("packages/core/vitest.config.ts");
  f("packages/core/src/index.ts");
  f("packages/core/src/runtime.ts", 30_000);
  for (let i = 0; i < 8; i++) f(`packages/core/src/agent/step${i}.ts`);
  f("packages/core/src/memory.ts");
  f("packages/cli/src/main.ts");
  f("packages/server/src/server.ts");
  f("packages/plugin-solana/src/index.ts");
  f("packages/plugin-solana/src/actions/swap.ts");
  const manifests = [{ path: "packages/cli/package.json", text: JSON.stringify({ bin: { eliza: "./dist/main.js" } }) }];
  const picked = pickFiles(tree, "Autonomous AI agent built on elizaOS that trades on Solana", manifests).map((e) => e.path);
  for (const p of ["packages/core/src/index.ts", "packages/core/src/runtime.ts", "packages/cli/src/main.ts", "packages/server/src/server.ts"]) assert.ok(picked.includes(p), p);
  assert.ok(!picked.some((p) => /androidTest|android\/|__tests__|\.test\.|examples\/|docs\/|scripts\/|config\./.test(p)), picked.join(","));
  assert.ok(picked.filter((p) => p.startsWith("packages/core/src/agent/")).length <= 3);
  // A phone claim lets the platform shell back in.
  assert.ok(pickFiles(tree, "a mobile android app", manifests).some((p) => p.path.includes("/android/") && !p.path.includes("androidTest")));
  assert.ok(entryPointsOf(manifests).has("packages/cli/src/main"));
});

test("files that import AI or Solana libraries move up after reading", () => {
  const tree: TreeEntry[] = Array.from({ length: 40 }, (_, i): TreeEntry => ({ path: `src/m${String(i).padStart(2, "0")}/x.ts`, type: "blob", size: 5_000 }));
  const ranked = rankFiles(tree, "");
  const bodies = new Map(tree.map((e) => [e.path, e.path === "src/m39/x.ts" ? 'import OpenAI from "openai";' : "export const a = 1;"]));
  assert.equal(rerankByImports(ranked, bodies)[0]!.path, "src/m39/x.ts");
});

test("files are ranked by the claims and vendored code, lockfiles and built bundles are never sent", () => {
  const picked = pickFiles(TREE, "an AI agent that trades on Jupiter").map((e) => e.path);
  assert.deepEqual(picked.slice(0, 2).sort(), ["src/agent/brain.ts", "src/trade/jupiter.ts"]);
  assert.ok(!picked.some((p) => p.includes("node_modules") || p.includes("dist/") || p.endsWith(".json")));
  assert.ok(!picked.includes("test/agent.test.ts"));
  const many = Array.from({ length: 100 }, (_, i): TreeEntry => ({ path: `src/f${i}.ts`, type: "blob", size: 9_000 }));
  const capped = pickFiles(many, "");
  assert.ok(capped.length * 9_000 <= 72_000 && capped.length > 0);
});

test("dependencies are read from every manifest kind and sorted into AI and Solana", () => {
  assert.deepEqual(dependenciesOf("Cargo.toml", '[package]\nname="x"\n[dependencies]\nanchor-lang = "0.30"\nserde = "1"\n[dependencies.rig-core]\nversion="1"'), ["anchor-lang", "serde", "rig-core"]);
  assert.deepEqual(dependenciesOf("requirements.txt", "langchain==0.2\n# c\nsolders>=0.2\n"), ["langchain", "solders"]);
  assert.ok(dependenciesOf("go.mod", "module m\nrequire (\n\tgithub.com/gagliardetto/solana-go v1.0\n)").includes("github.com/gagliardetto/solana-go"));
  assert.deepEqual(dependenciesOf("package.json", "not json"), []);
  const f = factsOf(TREE, [{ path: "package.json", text: JSON.stringify({ dependencies: { "@elizaos/core": "1", "@solana/web3.js": "1", react: "18" } }) }], "# hi", ["TypeScript"], gh());
  assert.deepEqual(f.ai, ["@elizaos/core"]);
  assert.deepEqual(f.solana, ["@solana/web3.js"]);
  assert.equal(f.ownCodeBytes, 13_800);
  assert.equal(f.vendoredBytes, 370_000);
  const shell = factsOf([{ path: "index.js", type: "blob", size: 100 }], [], "This template provides a minimal setup to get React working in Vite", [], gh({ fork: true, forkOf: "a/b", commits: 1 }));
  assert.deepEqual(shell.template, ["a fork of a/b", "almost no code of its own", "the README is a framework's starter text", "only 1 commit"]);
});

test("the model's answer is validated: bad JSON throws, unknown paths are dropped, unbacked matches fall to not found", () => {
  const set = new Set(["src/a.ts"]);
  assert.throws(() => parseVerdict("sorry", set));
  assert.throws(() => parseVerdict('{"claims":"x"}', set));
  const v = parseVerdict('```json\n{"claims":[{"claim":"agent","status":"matches","evidence":[{"path":"./src/a.ts","why":"safe and clean"}]},{"claim":"bot","status":"matches","evidence":[{"path":"src/nope.ts","why":"x"}]},{"claim":"dex","status":"weird"}],"overall":{"summary":"Looks trustworthy — ok.","matchScore":250}}\n```', set);
  assert.deepEqual(v.claims.map((c) => c.status), ["matches", "not found", "not found"]);
  assert.deepEqual(v.claims[0]!.evidence, [{ path: "src/a.ts", why: "and" }]);
  assert.deepEqual(v.claims[1]!.evidence, []);
  assert.equal(v.matchScore, 100);
  assert.ok(!/trustworthy|—/.test(v.summary));
});

test("the score is claims 40, substance 25, activity 20 and ties 15, and a contradiction caps the claim part", () => {
  const facts = factsOf(TREE, [], "# x", [], gh());
  const full = scoreOf([{ claim: "a", status: "matches", evidence: [] }], 100, { ...facts, ownCodeBytes: 400_000, ai: ["openai"], template: [] }, gh());
  assert.deepEqual(full, { total: 100, claims: 40, substance: 25, activity: 20, ties: 15 });
  const bad = scoreOf([{ claim: "a", status: "contradicts", evidence: [] }, { claim: "b", status: "matches", evidence: [] }], 90, facts, gh({ status: "oneway", activity: "dormant" }));
  assert.equal(bad.claims, 15);
  assert.equal(bad.ties, 0);
  assert.equal(bad.activity, 0);
  assert.equal(scoreOf([], 80, facts, gh()).claims, 0);
  assert.equal(scoreOf([], 0, facts, gh({ activity: "shipping", commits: 2 })).activity, 5);
});

test("the system prompt forbids praise and price and asks for 'not found in the files we read'", () => {
  for (const w of ["safe", "legit", "clean", "trustworthy", "price", "not found in the files we read", "only read the files provided"]) assert.ok(SYSTEM.includes(w), w);
  const p = promptOf("x".repeat(20_000), [{ path: "a.ts", text: "y".repeat(200_000) }], factsOf([], [], "", [], gh()), "o/r", SHA);
  assert.ok(p.length <= 90_000);
  assert.ok(!p.includes("x".repeat(6_001)));
});

test("a check reads, judges, scores and keeps its answer per repository, commit and token", async () => {
  const { d, calls, mem } = world();
  const r = await checkBuild(MINT, "wallet:a", d, new CallBudget());
  assert.ok("score" in r, JSON.stringify(r));
  assert.equal(r.sha, SHA);
  assert.equal(r.filesTotal, 9);
  assert.ok(r.filesRead.includes("README.md") && r.filesRead.includes("package.json") && r.filesRead.includes("src/agent/brain.ts"));
  assert.ok(!r.filesRead.some((p) => p.startsWith("node_modules")));
  assert.deepEqual(r.claims[0]!.evidence.map((e) => e.path), ["src/agent/brain.ts"]);
  assert.deepEqual(r.facts.ai, ["openai"]);
  assert.deepEqual(r.facts.solana, ["@jup-ag/api", "@solana/web3.js"]);
  assert.ok(!/legit|—/.test(r.summary));
  assert.ok(calls.prompts[0]!.includes("An AI agent that trades on Jupiter") && calls.prompts[0]!.includes("Autonomous trading agent") && !calls.prompts[0]!.includes("x()"));
  assert.equal(r.score.total, r.score.claims + r.score.substance + r.score.activity + r.score.ties);
  assert.ok(mem.has(`o/r@${SHA}:${MINT}`));
  const again = await checkBuild(MINT, "wallet:a", d, new CallBudget());
  assert.equal(calls.llm, 1);
  assert.ok("cached" in again && again.cached);
});

test("failures come back as plain states, never as a score", async () => {
  assert.equal(((await checkBuild(MINT, "c", world({ llm: null }).d)) as { state: string }).state, "off");
  assert.equal(((await checkBuild(MINT, "c", world({ claims: claims({ status: "none", repo: undefined }) }).d)) as { state: string }).state, "no-repo");
  assert.equal(((await checkBuild(MINT, "c", world({ head: 409 }).d)) as { state: string }).state, "no-repo");
  assert.equal(((await checkBuild(MINT, "c", world({ head: 500 }).d)) as { state: string }).state, "unread");
  const broken = await checkBuild(MINT, "c", world({ llm: async () => "not json" }).d, new CallBudget());
  assert.deepEqual(broken, { error: "the check failed, try again later", state: "failed" });
  const thrown = await checkBuild(MINT, "c", world({ llm: async () => { throw new Error("key sk-ant-secret timed out"); } }).d, new CallBudget());
  assert.ok(!JSON.stringify(thrown).includes("sk-ant"));
});

test("model calls are limited per caller, per hour and per day", async () => {
  const b = new CallBudget(2, 3, 4);
  assert.equal(b.take("a", NOW), 0);
  assert.equal(b.take("a", NOW), 0);
  assert.ok(b.take("a", NOW) > 0);
  assert.equal(b.take("b", NOW), 0);
  assert.ok(b.take("c", NOW) > 0);
  assert.equal(b.take("c", NOW + 3_600_001), 0);
  assert.ok(b.take("d", NOW + 3_600_002) > 0);
  const { d } = world();
  const limited = await checkBuild(MINT, "a", d, new CallBudget(0, 10, 10));
  assert.equal((limited as { state: string }).state, "limit");
});

test("the check is for sibling nodes and signed-in holders only", async () => {
  const req = (peer = false) => ({ headers: peer ? {} : { "x-forwarded-for": "1.2.3.4" }, socket: { remoteAddress: peer ? "172.18.0.5" : "1.2.3.4" } }) as unknown as IncomingMessage;
  const anon = await buildCaller(req(), null, async () => true);
  assert.equal(anon.ok, false);
  assert.equal(!anon.ok && anon.status, 401);
  const forged = await buildCaller(req(), { guardian: { publicKey: MINT, message: "hi", signature: "AA==" } }, async () => true);
  assert.equal(!forged.ok && forged.status, 401);
});
