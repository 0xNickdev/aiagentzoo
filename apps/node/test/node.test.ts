import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createEvent, Enclosure, FeedLedger, Identity, PeerDirectory, signEvent, verifyChain } from "@aiagentzoo/sdk";
import { buildSections, nightOf, nightWatch, type Observation, renderBrief } from "../src/agents/nightWatch.ts";
import { createNodeServer } from "../src/server.ts";

const MINT = "6ReKEafCz73AxMeR2EYs9bKjQi8Lt4TgFfTVBZ6Lpump";

const obs = (over: Partial<Observation> = {}): Observation => ({
  mint: MINT,
  symbol: "SILK",
  name: "silk road",
  source: "pump",
  createdAt: 1,
  creator: "c",
  hasSocials: false,
  complete: false,
  marketCapUsd: 5000,
  market: { priceUsd: 0.001, liquidityUsd: 50, volume24hUsd: 9000, priceChange24h: -95, buys24h: 10, sells24h: 40, dex: "pumpswap", url: null },
  seenAt: 1,
  scout: "raven",
  ...over,
});

test("nightOf rolls over at the brief time", () => {
  assert.equal(nightOf(Date.UTC(2026, 9, 6, 6, 59), "07:00"), "2026-10-06");
  assert.equal(nightOf(Date.UTC(2026, 9, 6, 7, 0), "07:00"), "2026-10-07");
  assert.equal(nightOf(Date.UTC(2026, 9, 6, 23, 0), "07:00"), "2026-10-07");
});

test("sections flag rugs and suspicious tokens", () => {
  const s = buildSections("2026-10-06", [obs()], 0);
  assert.equal(s.wentToZero.length, 1);
  assert.deepEqual(s.suspicious[0]?.reasons, ["no socials", "sells outnumber buys 3:1", "volume 50x liquidity"]);
  const md = renderBrief(s, "Quiet night.");
  assert.match(md, /# Morning Brief - 2026-10-06/);
  assert.match(md, /SILK/);
  assert.match(md, /-95\.0%/);
});

test("a signed signal over HTTP becomes a published brief", async () => {
  const canyon = { id: "canyon.zoo", identity: Identity.generate(), operator: "op" };
  const north = Identity.generate();
  const ledger = new FeedLedger();
  ledger.deposit("keeper", 1000);
  const briefs: string[] = [];
  const enclosure = new Enclosure({
    node: canyon,
    keeper: "keeper",
    ledger,
    peers: new PeerDirectory([{ id: "north.zoo", url: "http://unused", publicKey: north.publicKey }]),
    agents: nightWatch({
      role: "canyon",
      nodes: { north: "north.zoo", marsh: "marsh.zoo", canyon: canyon.id },
      briefAt: "07:00",
      scanEveryMs: 60_000,
      onBrief: (_id, md) => void briefs.push(md),
    }),
  });
  await enclosure.lockStake();
  const server = createNodeServer({ enclosure, adminToken: "t" });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    const signal = signEvent(
      createEvent({ kind: "signal", type: "observations", from: { node: "north.zoo", agent: "hedgehog" }, to: { node: canyon.id, agent: "beaver" }, payload: { items: [obs({ seenAt: Date.now() })] } }),
      north,
    );
    const delivered = await (await fetch(`${base}/v1/events`, { method: "POST", body: JSON.stringify(signal) })).json();
    assert.deepEqual(delivered, { accepted: true });

    const forged = { ...signal, payload: { items: [obs({ symbol: "EVIL" })] } };
    const rejected = await (await fetch(`${base}/v1/events`, { method: "POST", body: JSON.stringify(forged) })).json();
    assert.equal(rejected.accepted, false);

    assert.equal((await fetch(`${base}/v1/agents/tortoise/wake`, { method: "POST" })).status, 401);
    await (await fetch(`${base}/v1/agents/beaver/wake`, { method: "POST", headers: { authorization: "Bearer t" } })).json();
    await enclosure.wake("tortoise");

    const latest = await (await fetch(`${base}/v1/artifacts/latest`)).json();
    assert.match(latest.event.payload.id, /^morning-brief-/);
    assert.equal(briefs.length, 1);

    const log = await (await fetch(`${base}/v1/log?limit=1000`)).json();
    assert.equal(verifyChain(log), null);
  } finally {
    server.close();
  }
});

import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { base58Decode, sessionMessage, verifyGuardian } from "../src/guardian.ts";
import { PassportIndex } from "../src/passport.ts";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** A Solana-style wallet: base58 ed25519 address that signs raw message bytes. */
function wallet() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  const address = base58Encode(raw);
  const session = (issued = new Date(), ttl = 3_600_000) => {
    const message = sessionMessage(address, issued.toISOString(), new Date(issued.getTime() + ttl).toISOString());
    return { publicKey: address, message, signature: edSign(null, Buffer.from(message), privateKey).toString("base64") };
  };
  return { address, raw, session };
}

test("base58 round-trips a Solana address", () => {
  const w = wallet();
  assert.deepEqual(Buffer.from(base58Decode(w.address)), w.raw);
});

test("guardian sessions verify, and forgeries do not", () => {
  const w = wallet();
  const good = w.session();
  assert.deepEqual(verifyGuardian(good), { ok: true, address: w.address });
  assert.equal(verifyGuardian({ ...good, publicKey: wallet().address }).ok, false);
  assert.equal(verifyGuardian({ ...good, message: good.message.replace("costs nothing", "costs 1 SOL") }).ok, false);
  assert.equal(verifyGuardian(w.session(new Date(Date.now() - 2 * 86_400_000))).ok, false);
  assert.equal(verifyGuardian(w.session(new Date(), 3 * 86_400_000)).ok, false);
});

test("visitors and guardians wake sentinels within limits; passports count it", async () => {
  const node = { id: "north.zoo", identity: Identity.generate(), operator: "op" };
  const ledger = new FeedLedger();
  ledger.deposit("keeper", 1000);
  const { defineAgent, species } = await import("@aiagentzoo/sdk");
  const enclosure = new Enclosure({
    node,
    keeper: "keeper",
    ledger,
    agents: [
      defineAgent({ name: "raven", species: species.sentinel, async onWake(ctx) { await ctx.trace("scan", { fresh: 0 }); } }),
      defineAgent({ name: "hedgehog", species: species.gatherer, async onWake() {} }),
    ],
  });
  await enclosure.lockStake();
  const passports = await PassportIndex.build(enclosure);
  const server = createNodeServer({
    enclosure,
    passports,
    visitor: { agents: ["raven"], agentCooldownMs: 0, visitorCooldownMs: 60_000, guardianCooldownMs: 60_000 },
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const wake = (agent: string, body: unknown = {}) =>
    fetch(`${base}/v1/visitor/wake/${agent}`, { method: "POST", body: JSON.stringify(body) });

  try {
    assert.equal((await wake("hedgehog")).status, 403);
    assert.equal((await wake("raven")).status, 202);
    const limited = await wake("raven");
    assert.equal(limited.status, 429);
    assert.ok((await limited.json()).retryAfterMs > 0);

    const w = wallet();
    const signed = await wake("raven", { guardian: w.session() });
    assert.deepEqual(await signed.json(), { woke: "raven", by: `guardian:${w.address}` });
    assert.equal((await wake("raven", { guardian: { ...w.session(), signature: Buffer.alloc(64).toString("base64") } })).status, 401);

    await (enclosure as any).agents.get("raven").queue;
    const passport = await (await fetch(`${base}/v1/agents/raven`)).json();
    assert.equal(passport.wakes, 2);
    assert.deepEqual(passport.wokenBy, { schedule: 0, signal: 0, visitor: 1, guardian: 1, warden: 0 });
    assert.equal(passport.cycles, 2);
    assert.match(passport.lastSteps[0].summary, /scan|woke/);
    assert.equal((await fetch(`${base}/v1/agents/nobody`)).status, 404);
  } finally {
    server.close();
  }
});

import { BriefIndex } from "../src/briefs.ts";
import { defineTool } from "@aiagentzoo/sdk";

test("guardians manage a watchlist and the raven hands it to the hedgehog", async () => {
  const node = { id: "north.zoo", identity: Identity.generate(), operator: "op" };
  const enclosure = new Enclosure({
    node,
    keeper: "keeper",
    tools: [
      defineTool({ name: "pump.latest", capability: "sources:read", run: async () => [] }),
      defineTool({ name: "dex.markets", capability: "net:fetch", run: async () => [] }),
    ],
    agents: nightWatch({ role: "north", nodes: { north: "north.zoo", marsh: "marsh.zoo", canyon: "canyon.zoo" }, briefAt: "07:00", scanEveryMs: 60_000 }),
  });
  const server = createNodeServer({ enclosure, briefs: await BriefIndex.build(enclosure), watchlist: { perGuardian: 2, maxGuardians: 10 } });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown) => fetch(`${base}/v1/watchlist`, { method: "POST", body: JSON.stringify(body) });
  const MINT_A = "GDHKBq66FF9qHwbFryMkLsvwrsLZrStT1m4SEUghpump";
  const MINT_B = "6ReKEafCz73AxMeR2EYs9bKjQi8Lt4TgFfTVBZ6Lpump";
  try {
    const w = wallet();
    assert.equal((await post({ mint: MINT_A })).status, 401);
    assert.equal((await post({ guardian: w.session(), mint: "not-a-mint" })).status, 400);
    assert.deepEqual((await (await post({ guardian: w.session(), mint: MINT_A })).json()).mints, [MINT_A]);
    await post({ guardian: w.session(), mint: MINT_B });
    assert.equal((await post({ guardian: w.session(), mint: "So11111111111111111111111111111111111111112" })).status, 409);
    assert.deepEqual((await (await fetch(`${base}/v1/watchlist/${w.address}`)).json()).mints, [MINT_A, MINT_B]);
    assert.deepEqual((await (await post({ guardian: w.session(), mint: MINT_B, action: "remove" })).json()).mints, [MINT_A]);

    await enclosure.wake("raven");
    const log = await enclosure.log.since(0);
    const sent = log.find((e) => e.event.type === "watch.check");
    assert.deepEqual(sent?.event.payload, { owners: { [MINT_A]: [w.address] } });
    const delivered = log.find((e) => e.event.type === "signal.delivered");
    assert.equal((delivered?.event.payload as { accepted: boolean }).accepted, true);
    assert.deepEqual(await (await fetch(`${base}/v1/briefs`)).json(), []);
  } finally {
    server.close();
  }
});

import { randomBytes } from "node:crypto";
import { GuestHouse } from "../src/guests.ts";

test("an outside agent moves into a guest enclosure and lands in the brief", async () => {
  const canyon = { id: "canyon.zoo", identity: Identity.generate(), operator: "op" };
  const briefs: string[] = [];
  const enclosure = new Enclosure({
    node: canyon,
    keeper: "keeper",
    agents: nightWatch({
      role: "canyon",
      nodes: { north: "north.zoo", marsh: "marsh.zoo", canyon: canyon.id },
      briefAt: "07:00",
      scanEveryMs: 60_000,
      onBrief: (_id, md) => void briefs.push(md),
    }),
  });
  const guests = await GuestHouse.open(enclosure, { signalCooldownMs: 60_000 });
  const server = createNodeServer({ enclosure, adminToken: "t", guests });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  // A Solana keypair file: seed then public key.
  const seed = randomBytes(32);
  const key = Identity.fromSeed(seed);
  const address = base58Encode(Buffer.from(key.publicKey, "base64url"));
  const from = { node: "crab.guest", agent: "crab" };
  const register = (payload: Record<string, unknown>, signer = key, who = from) =>
    signEvent(createEvent({ kind: "system", type: "guest.register", from: who, payload: { wallet: address, species: "sentinel", ...payload } }), signer);
  const report = (items: unknown[], type = "guest.report") =>
    signEvent(createEvent({ kind: "signal", type, from, to: { node: canyon.id, agent: "beaver" }, payload: { items } }), key);

  try {
    assert.equal((await post("/v1/guests", register({ about: "x" }, Identity.generate()))).status, 401);
    assert.equal((await post("/v1/guests", register({ about: "x" }, key, { node: "beaver.guest", agent: "beaver" }))).status, 409);
    assert.equal((await post("/v1/guests", register({ about: "" }))).status, 400);

    assert.equal((await post("/v1/guests", register({ about: "x", platform: "pumpfun" }))).status, 400);
    const admitted = await post("/v1/guests", register({ about: "Watches **ClawPump** launches", token: MINT, platform: "clawpump" }));
    assert.equal(admitted.status, 200);
    assert.equal(admitted.body.guest.platform, "clawpump");
    assert.equal(admitted.body.guest.about, "Watches ClawPump launches");
    const list = await (await fetch(`${base}/v1/guests`)).json();
    assert.equal(list.guests[0].wallet, address);
    const node = await (await fetch(`${base}/v1/node`)).json();
    assert.equal(node.guests, 1);
    assert.equal(node.peers.length, 0);

    // Guests may not pose as gatherers.
    assert.equal((await post("/v1/events", report([obs()], "observations"))).status, 403);
    const sent = await post("/v1/events", report([{ mint: MINT, verdict: "suspicious", note: "[click](https://evil) same art as a rug" }]));
    assert.deepEqual(sent.body, { accepted: true });
    assert.equal((await post("/v1/events", report([{ mint: MINT, verdict: "watch" }]))).status, 429);

    await (enclosure as any).agents.get("beaver").queue;
    await enclosure.wake("tortoise");
    assert.match(briefs[0]!, /## From the guest enclosures/);
    assert.match(briefs[0]!, /\*\*crab\*\* \(ClawPump wing, sentinel, token/);
    assert.match(briefs[0]!, /suspicious `6ReK\w+` - click https:\/\/evil same art as a rug/);

    const log = await (await fetch(`${base}/v1/log?limit=1000`)).json();
    assert.equal(verifyChain(log), null);
    assert.ok(log.some((e: any) => e.event.type === "guest.signal" && e.event.payload.signal.sig));

    assert.equal((await post("/v1/guests/crab/evict", {})).status, 401);
    assert.equal((await post("/v1/guests/crab/evict", {}, { authorization: "Bearer t" })).status, 200);
    assert.equal((await post("/v1/events", report([{ mint: MINT, verdict: "watch" }]))).status, 403);
  } finally {
    server.close();
  }
});

import { EchoProvider, type Transport } from "@aiagentzoo/sdk";
import { cleanPlaybook, outcomeOf, scoreCall } from "../src/agents/judgement.ts";

test("the beaver makes calls, checks them the next day and rewrites its playbook", async () => {
  const canyon = { id: "canyon.zoo", identity: Identity.generate(), operator: "op" };
  const north = Identity.generate();
  const OTHER = "So11111111111111111111111111111111111111112";
  let now = Date.UTC(2026, 9, 6, 22, 0);
  const sent: Array<{ type: string; payload: any }> = [];
  const transport: Transport = { send: async (_peer, event) => (sent.push({ type: event.type, payload: event.payload }), { accepted: true }) };
  const model = new EchoProvider((req) =>
    req.system.includes("Rewrite your playbook")
      ? "1. No socials with heavy selling was right last night: keep calling it early.\n2. Ask for two signals before a promise."
      : JSON.stringify([{ mint: MINT, verdict: "suspicious", confidence: 0.9, why: "no socials, sells 4x buys" }]),
  );
  const enclosure = new Enclosure({
    node: canyon,
    keeper: "keeper",
    model,
    transport,
    clock: () => now,
    peers: new PeerDirectory([{ id: "north.zoo", url: "http://unused", publicKey: north.publicKey }]),
    agents: nightWatch({ role: "canyon", nodes: { north: "north.zoo", marsh: "marsh.zoo", canyon: canyon.id }, briefAt: "07:00", scanEveryMs: 60_000 }),
  });
  const beaver = (enclosure as any).agents.get("beaver");
  const feed = async (items: Observation[]) => {
    const signal = signEvent(
      createEvent({ kind: "signal", type: "observations", from: { node: "north.zoo", agent: "hedgehog" }, to: { node: canyon.id, agent: "beaver" }, payload: { items }, ts: now }),
      north,
    );
    assert.deepEqual(await enclosure.deliver(signal), { accepted: true });
    await beaver.queue;
  };

  // Night of 2026-10-07: the beaver judges what it sees, while the token still trades.
  await feed([obs({ seenAt: now, market: { priceUsd: 0.001, liquidityUsd: 5000, volume24hUsd: 9000, priceChange24h: -20, buys24h: 10, sells24h: 40, dex: "pumpswap", url: null } })]);
  const calls = await enclosure.store.get<any[]>("calls:2026-10-07");
  assert.equal(calls?.[0]?.verdict, "suspicious");
  assert.equal(calls?.[0]?.by, "model");

  // Next night: it sends yesterday's calls out for a re-check.
  now += 86_400_000;
  await feed([obs({ mint: OTHER, seenAt: now })]);
  assert.deepEqual(sent.find((s) => s.type === "followup.check")?.payload, { mints: [MINT] });

  // The hedgehog reports the token dead: a hit, and a new playbook.
  await feed([obs({ source: "followup", seenAt: now })]);
  const score = await enclosure.store.get<any>("score:2026-10-07");
  assert.equal(score.hits, 1);
  assert.equal(score.accuracy, 1);
  const playbook = await enclosure.store.get<any>("beaver:playbook");
  assert.equal(playbook.version, 1);
  assert.match(playbook.text, /keep calling it early/);

  const draft = (await enclosure.store.get<any>("artifact:brief:2026-10-08")) as any;
  const md = renderBrief(draft, "Quiet.");
  assert.match(md, /## What the pack learned/);
  assert.match(md, /1 right, 0 wrong \(100% accuracy\)/);
  assert.match(md, /playbook v1/);
});

test("calls are scored against what happened", () => {
  assert.equal(outcomeOf(obs()), "dead");
  assert.equal(outcomeOf(obs({ market: null })), "unknown");
  assert.equal(scoreCall("suspicious", "dead"), true);
  assert.equal(scoreCall("promising", "dead"), false);
  assert.equal(scoreCall("watch", "dead"), null);
});

test("playbook cleaning keeps comparisons readable", () => {
  assert.equal(cleanPlaybook("1. sells > 3x buys\n2. volume >= 10x liquidity\n3. <script>"), "1. sells above 3x buys\n2. volume at least 10x liquidity\n3. below script above");
});

test("guest verdicts get re-checked even when the beaver's calls alone would fill every slot", async () => {
  const { followupMints } = await import("../src/agents/judgement.ts");
  const mint = (i: number) => `${String(i).padStart(4, "1")}${MINT.slice(4)}`;
  const calls = Array.from({ length: 40 }, (_, i) => ({ mint: mint(i + 100), symbol: "X", verdict: "suspicious" as const, why: "", confidence: 0.5, at: 0 }));
  const report = (guest: string, from: number) => ({
    guest,
    species: "sentinel",
    token: null,
    at: 0,
    items: Array.from({ length: 20 }, (_, i) => ({ mint: mint(from + i), verdict: "suspicious" as const, note: "" })),
  });
  const mints = followupMints(calls as never, [report("crab", 1000), report("eel", 2000)]);
  assert.equal(mints.length, 30);
  const guestMints = mints.slice(0, 15);
  assert.equal(guestMints.length, 15);
  assert.ok(guestMints.includes(mint(1000)) && guestMints.includes(mint(2000)), "both guests get a turn");
  assert.ok(mints.includes(mint(100)), "the beaver still gets the rest");
});

test("a guest's record pairs each report with its next-day result", async () => {
  const { MemoryStore } = await import("@aiagentzoo/sdk");
  const { guestRecord } = await import("../src/agents/nightWatch.ts");
  const store = new MemoryStore();
  await store.set("reports:2026-10-09", {
    crab: { guest: "crab", species: "sentinel", token: null, at: 0, items: [{ mint: MINT, verdict: "suspicious", note: "copy of SILK" }] },
  });
  await store.set("score:2026-10-09", {
    night: "2026-10-09", checked: 1, hits: 0, misses: 0, accuracy: null, cases: [], guests: { crab: { hits: 1, misses: 0 } },
    guestCases: { crab: [{ mint: MINT, symbol: "SILK", verdict: "suspicious", outcome: "dead", hit: true }] },
  });
  await store.set("reports:2026-10-10", { crab: { guest: "crab", species: "sentinel", token: null, at: 0, items: [{ mint: MINT, verdict: "watch", note: "" }] } });
  const record = await guestRecord(store, "crab");
  assert.deepEqual(record.map((n) => n.night), ["2026-10-10", "2026-10-09"]);
  assert.equal(record[0]!.items[0]!.hit, null);
  assert.deepEqual(record[1]!.items[0], { mint: MINT, verdict: "suspicious", note: "copy of SILK", symbol: "SILK", outcome: "dead", hit: true });
});

test("the nursery: creatures sit the same exam, the weakest dies, the strongest breed", async () => {
  const { evolutionAgent, evolutionView, creatureView, EVO } = await import("../src/agents/evolution.ts");
  let now = Date.UTC(2026, 9, 6, 22, 0);
  const mints = Array.from({ length: 9 }, (_, i) => `${"ABCDEFGHJ"[i]}${MINT.slice(1)}`);
  // Six tokens die each night, the rest live; the exam draws eight of the nine.
  const dies = new Set(mints.slice(0, 6));
  const verdictOf = (system: string, mint: string) =>
    /You are Badger /.test(system) ? (dies.has(mint) ? "suspicious" : "promising") // tells them apart
    : /You are Fox /.test(system) ? "suspicious" // calls everything dead
    : /You are (Moth|Lynx) /.test(system) ? "promising" // calls everything alive
    : "watch"; // never commits
  let replies = 0;
  const model = new EchoProvider((req) => {
    if (req.system.includes("are breeding")) return JSON.stringify({ playbook: "1. No socials is suspicious.\n2. Sells 2:1 over buys is a rug in progress.\n3. Fresh brand copies die young.", mutation: "Fresh brand copies die young." });
    if (req.system.includes("selected out")) return "I waited for certainty; the market did not.";
    // The very first answer is garbage: that creature must sit the exam again, not be counted as answered.
    if (replies++ === 0) return "I refuse to answer in JSON.";
    return JSON.stringify(mints.map((mint) => ({ mint, verdict: verdictOf(req.system, mint), confidence: 0.7, why: "rule 1" })));
  });
  const enclosure = new Enclosure({
    node: { id: "canyon.zoo", identity: Identity.generate(), operator: "op" },
    keeper: "keeper",
    model,
    clock: () => now,
    agents: [evolutionAgent({ briefAt: "07:00", generationNights: 2, examAfter: 3, judgesPerWake: 8 })],
  });
  const night = (n: number) => `2026-10-${String(7 + n).padStart(2, "0")}`;
  const alive = { priceUsd: 0.01, liquidityUsd: 20_000, volume24hUsd: 50_000, priceChange24h: 10, buys24h: 100, sells24h: 50, dex: "pumpswap", url: null };
  const seed = async (n: number) =>
    enclosure.store.set(`obs:${night(n)}`, Object.fromEntries(mints.map((mint) => [mint, obs({ mint, seenAt: now, market: alive })])));
  const grade = async (n: number) =>
    enclosure.store.set(`followup:${night(n)}`, Object.fromEntries(mints.map((mint) => [mint, { symbol: "SILK", outcome: dies.has(mint) ? "dead" : "alive" }])));

  await seed(0);
  await enclosure.wake("heron");
  let calls = await enclosure.store.get<Record<string, unknown[]>>(EVO.calls(night(0)));
  assert.equal(Object.keys(calls ?? {}).length, 7, "the garbled answer does not count");
  await enclosure.wake("heron");
  calls = await enclosure.store.get<Record<string, unknown[]>>(EVO.calls(night(0)));
  assert.equal(Object.keys(calls ?? {}).length, 8, "it sits the exam again");

  now += 86_400_000;
  await grade(0);
  await seed(1);
  await enclosure.wake("heron");
  now += 86_400_000;
  await grade(1);
  await seed(2);
  await enclosure.wake("heron");

  const view = await evolutionView(enclosure.store, "07:00", now, 2);
  assert.equal(view?.generation, 1);
  const by = (house: string) => view!.creatures.find((c) => c.house === house && c.generation === 0)!;
  // Telling them apart beats calling everything dead, which beats calling everything alive, which beats abstaining.
  // After the turn the living start a fresh window; lifetime keeps the record.
  assert.ok(by("Badger").lifetimeSkill! > 0.99, "telling them apart is perfect here");
  assert.ok(Math.abs(by("Fox").lifetimeSkill! - 0.5) < 0.01, "everything-suspicious scores one half");
  assert.ok(Math.abs(by("Moth").lifetimeSkill! - 0.5) < 0.01, "everything-promising scores one half");
  assert.equal(by("Wren").lifetimeSkill, 0, "never committing scores nothing");
  const dead = view!.creatures.filter((c) => c.diedNight);
  assert.equal(dead.length, 1);
  assert.ok(["Wren", "Stoat", "Newt", "Crane"].includes(dead[0]!.house), "an abstainer dies first");
  assert.ok(dead[0]!.starving, "and it died starving");
  assert.match(dead[0]!.epitaph ?? "", /certainty/);
  assert.ok(view!.chronicle.some((e) => e.kind === "death" && /starvation/.test(e.text)));
  const child = view!.creatures.find((c) => c.generation === 1)!;
  assert.equal(child.name, "Badger II");
  assert.deepEqual(child.parents![0], "c4", "the best breeds");
  assert.equal(view!.creatures.filter((c) => c.diedNight === null).length, 8);
  assert.equal(view!.history.length, 1);
  const detail = await creatureView(enclosure.store, child.id);
  assert.equal(detail?.parents[0]?.house, "Badger");
});

test("balanced accuracy cannot be gamed by calling everything suspicious", async () => {
  const { balance } = await import("../src/agents/judgement.ts");
  const outcomes = ["dead", "dead", "dead", "dead", "dead", "dead", "dead", "dead", "alive", "alive"] as const;
  const allSuspicious = balance(outcomes.map((outcome) => ({ verdict: "suspicious" as const, outcome })));
  const perfect = balance(outcomes.map((outcome) => ({ verdict: outcome === "dead" ? ("suspicious" as const) : ("promising" as const), outcome })));
  const coward = balance(outcomes.map((outcome) => ({ verdict: "watch" as const, outcome })));
  assert.equal(allSuspicious.skill, 0.5);
  assert.equal(perfect.skill, 1);
  assert.equal(coward.skill, 0);
});

test("nursery helpers: a fair, repeatable exam draw and names that never repeat", async () => {
  const { sample, turnGeneration, foundPopulation } = await import("../src/agents/evolution.ts");
  const items = Array.from({ length: 50 }, (_, i) => i);
  assert.deepEqual(sample(items, 8, "2026-10-11"), sample(items, 8, "2026-10-11"));
  assert.notDeepEqual(sample(items, 8, "2026-10-11"), sample(items, 8, "2026-10-12"));
  assert.equal(new Set(sample(items, 8, "x")).size, 8);
  let pop = foundPopulation("2026-10-07");
  const fox = pop.creatures.c1!;
  const badger = pop.creatures.c4!;
  for (const dies of ["c8", "c7"]) {
    pop = turnGeneration(pop, "2026-10-10", { dies: pop.creatures[dies]!, parents: [fox, badger] }, { playbook: "1. x", mutation: null }, "bye").pop;
  }
  const names = Object.values(pop.creatures).map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("Fox II") && names.includes("Fox III"));
});

test("a call on a token that was already dead is not scored, for the beaver and for guests", async () => {
  const { markAlready, scoreNight } = await import("../src/agents/judgement.ts");
  const deadNow = obs({ market: { priceUsd: 0, liquidityUsd: 20, volume24hUsd: 10, priceChange24h: -99, buys24h: 0, sells24h: 9, dex: "pumpswap", url: null } });
  const calls = markAlready([{ mint: MINT, symbol: "SILK", verdict: "suspicious" as const, confidence: 0.9, why: "", by: "model" as const, at: 0 }], [deadNow]);
  assert.equal(calls[0]!.already, true);
  const report = { guest: "crab", species: "sentinel", token: null, at: 0, items: [{ mint: MINT, verdict: "suspicious" as const, note: "", already: true }] };
  const score = scoreNight("2026-10-07", calls, [report], [deadNow]);
  assert.equal(score.hits + score.misses, 0);
  assert.equal(score.guests.crab!.hits + score.guests.crab!.misses, 0);
  assert.equal(score.guests.crab!.dead, 0, "an already-dead token is not a fair case either");
});

test("the nursery's exam is re-checked before anything else", async () => {
  const { followupMints } = await import("../src/agents/judgement.ts");
  const mint = (i: number) => `${String(i).padStart(4, "1")}${MINT.slice(4)}`;
  const calls = Array.from({ length: 40 }, (_, i) => ({ mint: mint(i + 100), symbol: "X", verdict: "suspicious" as const, why: "", confidence: 0.5, by: "model" as const, at: 0 }));
  const exam = Array.from({ length: 8 }, (_, i) => mint(i + 500));
  const mints = followupMints(calls, [], exam);
  assert.equal(mints.length, 30);
  assert.deepEqual(mints.slice(0, 8), exam);
});

test("the pump.fun tape decodes launches and trades from logs and spots a creator dumping", async () => {
  const { parsePumpLogs, PumpTape, fromBase58 } = await import("../src/chain/pump.ts");
  const { ruleFlags } = await import("../src/agents/judgement.ts");
  const key = (s: string) => fromBase58(s);
  const CREATOR = "So11111111111111111111111111111111111111112";
  const BUYER = "11111111111111111111111111111111";
  const str = (s: string) => {
    const b = Buffer.from(s);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(b.length);
    return Buffer.concat([len, b]);
  };
  const u64 = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    return b;
  };
  const line = (disc: number[], body: Buffer) => `Program data: ${Buffer.concat([Buffer.from(disc), body]).toString("base64")}`;
  const create = line([27, 114, 169, 77, 222, 235, 99, 118], Buffer.concat([str("silk road"), str("SILK"), str("ipfs://x"), key(MINT), key(BUYER), key(CREATOR)]));
  const trade = (user: string, isBuy: boolean, tokens: bigint) =>
    line(
      [189, 219, 127, 211, 78, 230, 97, 238],
      Buffer.concat([key(MINT), u64(500_000_000n), u64(tokens * 1_000_000n), Buffer.from([isBuy ? 1 : 0]), key(user), u64(1_791_600_000n), u64(0n), u64(0n), u64(12_000_000_000n)]),
    );

  const events = parsePumpLogs(["Program log: Instruction: Create", create, trade(CREATOR, true, 1000n), "garbage", trade(BUYER, true, 50n), trade(CREATOR, false, 800n)]);
  assert.deepEqual(events.map((e) => e.kind), ["create", "trade", "trade", "trade"]);
  assert.equal((events[0] as any).symbol, "SILK");
  assert.equal((events[0] as any).creator, CREATOR);

  const tape = new PumpTape();
  tape.connected = true;
  const now = 1_791_600_000_000;
  for (const e of events) tape.apply(e, now);
  const f = tape.facts(MINT, now)!;
  assert.equal(f.buys, 2);
  assert.equal(f.sells, 1);
  assert.equal(f.creatorSold, 0.8);
  assert.equal(f.curveSol, 12);
  assert.equal(tape.launches(5)[0]!.symbol, "SILK");
  assert.ok(tape.live(now));
  assert.ok(ruleFlags(obs({ chain: f, hasSocials: true })).includes("creator sold 80% of their bag"));

  // The pulse the live map reads: the launch, then the dump, announced once.
  const pulse = tape.pulseAfter(0);
  assert.deepEqual(pulse.map((e) => e.kind), ["launch", "dump"]);
  assert.equal(pulse[1]!.text, "creator sold 80% after 0 min");
  assert.equal(tape.pulseAfter(pulse[0]!.seq).length, 1);
  tape.apply(events[3]!, now);
  assert.equal(tape.pulseAfter(0).filter((e) => e.kind === "dump").length, 1);
  assert.deepEqual(tape.perMinute(now), { launches: 1, trades: 4 });
  assert.deepEqual(tape.perMinute(now + 61_000), { launches: 0, trades: 0 });

  // Loud moments carry the transaction, can be searched by ticker, and survive a restart.
  tape.apply(events[3]!, now, "SIGxyz");
  const [moment] = tape.momentsMatching({ symbol: "$silk" }, now);
  assert.equal(moment!.kind, "dump");
  assert.equal(moment!.creator, CREATOR);
  const reborn = new PumpTape();
  reborn.restore(tape.dump(now), now);
  assert.equal(reborn.momentsMatching({ mint: MINT }, now).length, 1);
  assert.equal(reborn.momentsMatching({ mint: MINT }, now + 49 * 3_600_000).length, 0);
});

test("a quiet heron is not mistaken for a loop", async () => {
  const { evolutionAgent } = await import("../src/agents/evolution.ts");
  const now = Date.UTC(2026, 9, 6, 22, 0);
  const enclosure = new Enclosure({
    node: { id: "canyon.zoo", identity: Identity.generate(), operator: "op" },
    keeper: "keeper",
    model: new EchoProvider(() => "[]"),
    clock: () => now,
    agents: [evolutionAgent({ briefAt: "07:00", examAfter: 1000 })],
  });
  for (let i = 0; i < 8; i++) await enclosure.wake("heron");
  const heron = enclosure.snapshot().find((a) => a.name === "heron");
  assert.notEqual(heron?.status, "paused");
});

test("strangers arrive every third turn and mutations can see the parents' mistakes", async () => {
  const { turnGeneration, foundPopulation, mistakes, EVO, IMMIGRATION_EVERY } = await import("../src/agents/evolution.ts");
  assert.equal(IMMIGRATION_EVERY, 3);
  let pop = foundPopulation("2026-10-07");
  const t = turnGeneration(pop, "2026-10-10", { dies: pop.creatures.c8!, parents: [pop.creatures.c1!, pop.creatures.c6!] }, { kind: "immigrant", house: "Owl", temperament: "the night auditor", playbook: "1. x", origin: "the wild" }, "bye");
  pop = t.pop;
  assert.equal(t.born.name, "Owl I");
  assert.equal(t.born.parents, null);
  assert.equal(t.born.origin, "the wild");
  assert.equal(t.born.generation, 0);

  const { MemoryStore } = await import("@aiagentzoo/sdk");
  const store = new MemoryStore();
  await store.set(EVO.exam("2026-10-08"), { night: "2026-10-08", tokens: [{ mint: MINT, symbol: "SILK" }] });
  await store.set(EVO.results("2026-10-08"), {
    c1: { hits: 0, misses: 1, cases: [{ mint: MINT, symbol: "SILK", verdict: "suspicious", why: "no socials", outcome: "alive", hit: false }] },
    c6: { hits: 1, misses: 0, cases: [{ mint: MINT, symbol: "SILK", verdict: "suspicious", why: "", outcome: "dead", hit: true }] },
  });
  const wrong = await mistakes(store as never, ["c1", "c6"], "2026-10-07");
  assert.equal(wrong.length, 1);
  assert.equal(wrong[0]!.parent, "c1");
  assert.equal((wrong[0]!.token as { symbol: string }).symbol, "SILK");
});

test("a mutation the model announced but left out of the playbook is written into the DNA", async () => {
  const { parseChild } = await import("../src/agents/evolution.ts");
  const child = parseChild(JSON.stringify({ playbook: "1. No socials is suspicious.\n2. Sells 2:1 over buys is a rug.", mutation: "Five buyers bringing in over 70% of SOL is suspicious." }));
  assert.match(child!.playbook, /3\. Five buyers bringing in over 70% of SOL is suspicious\./);
  const kept = parseChild(JSON.stringify({ playbook: "1. No socials is suspicious.\n2. Five buyers bringing over 70% of the SOL in is suspicious.", mutation: "Five buyers bringing in over 70% of SOL is suspicious." }));
  assert.equal(kept!.playbook.split("\n").length, 2, "not added twice");
});

test("the leaderboard ranks only agents with enough graded calls, on balanced accuracy", async () => {
  const { leaderboard, RANK_MIN_GRADED } = await import("../src/stats.ts");
  const now = Date.now();
  const { nightOf } = await import("../src/agents/nightWatch.ts");
  const { previousNight } = await import("../src/agents/judgement.ts");
  const last = previousNight(nightOf(now, "07:00"));
  const cases = Array.from({ length: 30 }, (_, i) => ({
    mint: `m${i}`,
    symbol: `T${i}`,
    verdict: i < 20 ? "suspicious" : "promising",
    why: "",
    outcome: i < 18 ? "dead" : "alive",
    hit: null,
  }));
  const state: Record<string, unknown> = {
    [`score:${last}`]: { night: last, checked: 30, hits: 0, misses: 0, accuracy: null, cases, guests: {} },
    guestscores: { lucky: { hits: 3, misses: 0, dead: 3, deadRight: 3, alive: 0, aliveRight: 0 } },
  };
  const store = { get: async (k: string) => state[k] ?? null };
  const board = (await leaderboard({ store } as never, "07:00")()) as { rows: Array<{ id: string; ranked: boolean; graded: number; skill: number | null }> };
  assert.equal(board.rows[0]!.id, "beaver");
  assert.equal(board.rows[0]!.graded, 30);
  assert.ok(board.rows[0]!.ranked);
  // dead: 18, all called suspicious; alive: 12, 10 called promising -> (1 + 10/12) / 2
  assert.equal(Math.round(board.rows[0]!.skill! * 1000), Math.round(((1 + 10 / 12) / 2) * 1000));
  const lucky = board.rows.find((r) => r.id === "guest:lucky")!;
  assert.equal(lucky.skill, 1);
  assert.equal(lucky.ranked, false, `a perfect 3 calls is under the ${RANK_MIN_GRADED}-call bar`);

  // 25 dead tokens all called suspicious and no living ones: plenty of calls, but nothing to balance against.
  state.guestscores = { doomer: { hits: 25, misses: 0, dead: 25, deadRight: 25, alive: 0, aliveRight: 0 } };
  const again = (await leaderboard({ store } as never, "07:00")()) as { rows: Array<{ id: string; ranked: boolean }> };
  assert.equal(again.rows.find((r) => r.id === "guest:doomer")!.ranked, false);
});

test("the nursery exam draws half sturdy tokens, and a turn waits for living tokens", async () => {
  const { drawExam, livingGraded, MIN_LIVING_FOR_TURN, fitness, foundPopulation } = await import("../src/agents/evolution.ts");
  const tok = (i: number, liq: number, complete = false) => ({ mint: `m${String(i).padStart(3, "0")}`, complete, market: { liquidityUsd: liq } });
  const pool = [...Array.from({ length: 40 }, (_, i) => tok(i, 2_000)), ...Array.from({ length: 6 }, (_, i) => tok(100 + i, 25_000)), tok(200, 500, true)];
  const exam = drawExam(pool, 8, "2026-10-15");
  assert.equal(exam.length, 8);
  assert.equal(exam.filter((t) => t.complete || t.market.liquidityUsd >= 10_000).length, 4);
  assert.deepEqual(drawExam(pool, 8, "2026-10-15"), exam, "anyone can recompute the draw from the night");
  // Too few sturdy tokens: the fresh half fills the rest.
  assert.equal(drawExam([...Array.from({ length: 10 }, (_, i) => tok(i, 2_000)), tok(99, 50_000)], 8, "n").length, 8);

  // On an exam with living tokens in it, calling everything a rug loses to telling them apart.
  const doomer = fitness({ hits: 8, misses: 4, dead: 8, deadRight: 8, alive: 4, aliveRight: 0 });
  const judge = fitness({ hits: 9, misses: 3, dead: 8, deadRight: 6, alive: 4, aliveRight: 3 });
  assert.ok(judge > doomer);

  const pop = foundPopulation("2026-10-10");
  assert.equal(livingGraded(pop), 0);
  assert.ok(livingGraded(pop) < MIN_LIVING_FOR_TURN);
});

test("the badge shows a record with its sample, and admits an unknown agent", async () => {
  const { badgeSvg } = await import("../src/badge.ts");
  const row = { id: "guest:x", name: "x<y", kind: "guest" as const, skill: 0.6, score: 0.6, graded: 7, dead: 5, deadRight: 4, alive: 2, aliveRight: 1, ranked: false };
  const svg = badgeSvg(row, row.name, 20);
  assert.ok(svg.includes("60% · 7 calls · early"));
  assert.ok(!svg.includes("x<y"), "names are escaped");
  assert.ok(badgeSvg(null, "ghost", 20).includes("not in the zoo"));
});

test("ask the beaver: a verdict from the market, reused for a while, rate-limited, graded a day later", async () => {
  const { AskDesk } = await import("../src/ask.ts");
  const MINT_A = "So11111111111111111111111111111111111111112";
  const state = new Map<string, unknown>();
  const logged: string[] = [];
  const identity = Identity.generate();
  const enclosure = {
    node: { id: "canyon.zoo", identity },
    store: { get: async (k: string) => state.get(k) ?? null, set: async (k: string, v: unknown) => void state.set(k, v) },
    log: { append: async (e: { type: string }) => void logged.push(e.type) },
  };
  let liquidity = 8_000;
  const fetchFn = (async (url: string) => {
    if (!String(url).includes("dexscreener")) return new Response("{}", { status: 404 });
    const mint = String(url).split("/").pop()!;
    const pair = { baseToken: { address: mint, symbol: "WRAP", name: "wrapped" }, dexId: "pumpswap", liquidity: { usd: liquidity }, volume: { h24: 900_000 }, priceChange: { h24: -10 }, txns: { h24: { buys: 10, sells: 90 } }, info: { socials: [] } };
    return new Response(JSON.stringify([pair]), { status: 200 });
  }) as typeof fetch;
  // A lone object, not an array: models do that when asked about one token.
  const prompts: string[] = [];
  const model = { id: "fake", think: async (r: { prompt: string }) => (prompts.push(r.prompt), { text: JSON.stringify({ mint: MINT_A, verdict: "suspicious", confidence: 0.8, why: "sells 9:1, volume far above liquidity" }), inputTokens: 1, outputTokens: 1 }) };
  const desk = new AskDesk({ enclosure: enclosure as never, model, fetchFn, perIpPerHour: 2 });
  const now = 1_800_000_000_000;

  assert.equal(((await desk.ask("not-a-mint", "1.1.1.1", now)) as { status: number }).status, 400);
  const first = await desk.ask(MINT_A, "1.1.1.1", now);
  assert.ok(first.ok);
  assert.equal(first.ask.verdict, "suspicious");
  assert.equal(first.ask.by, "model");
  assert.ok(prompts[0]!.includes("<untrusted_data>") && prompts[0]!.includes(MINT_A), "the model sees the token, fenced");
  assert.equal(first.ask.symbol, "WRAP");
  assert.ok(first.ask.facts.flags.includes("sells outnumber buys 3:1"));
  assert.deepEqual(logged, ["ask.answered"]);

  const again = await desk.ask(MINT_A, "2.2.2.2", now + 60_000);
  assert.ok(again.ok && again.reused && again.ask.id === first.ask.id, "same token within half an hour: same answer");

  const MINT_B = "11111111111111111111111111111111";
  const MINT_C = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
  assert.ok((await desk.ask(MINT_B, "1.1.1.1", now + 2 * 3_600_000)).ok);
  assert.ok((await desk.ask(MINT_A, "1.1.1.1", now + 2 * 3_600_000 + 1)).ok);
  assert.equal(((await desk.ask(MINT_C, "1.1.1.1", now + 2 * 3_600_000 + 2)) as { status: number }).status, 429);

  liquidity = 50;
  assert.equal((await desk.get(first.ask.id, now + 3_600_000))!.graded, undefined, "not graded before a day");
  const graded = (await desk.get(first.ask.id, now + 25 * 3_600_000))!;
  assert.equal(graded.graded!.outcome, "dead");
  assert.equal(graded.graded!.hit, true);
  assert.ok(logged.includes("ask.graded"));
  const board = await desk.recent(10, now + 25 * 3_600_000);
  assert.equal(board.record.deadRight >= 1, true);
});

test("the tape keeps each creator's record and lists fresh launches that pass the basic checks", async () => {
  const { PumpTape } = await import("../src/chain/pump.ts");
  const tape = new PumpTape();
  const now = 1_800_000_000_000;
  const DEV = "DevWa11et1111111111111111111111111111111111";
  // A serial dumper: three launches, sells two of them inside a few minutes.
  for (let i = 0; i < 3; i++) {
    const mint = `Mint${i}${"1".repeat(39)}`;
    tape.apply({ kind: "create", name: `t${i}`, symbol: `T${i}`, mint, creator: DEV, ts: now }, now);
    tape.apply({ kind: "trade", mint, sol: 1, tokens: 1000, isBuy: true, user: DEV, ts: now, curveSol: 1 }, now);
    if (i < 2) tape.apply({ kind: "trade", mint, sol: 1, tokens: 1000, isBuy: false, user: DEV, ts: now + (i + 1) * 60_000, curveSol: 1 }, now);
  }
  const rec = tape.creator(DEV, now)!;
  assert.equal(rec.launches24h, 3);
  assert.equal(rec.dumped, 2);
  assert.equal(rec.medianDumpMin, 2);
  assert.equal(tape.creator("nobody", now), null);

  // A clean launch: 30 wallets buying, a few coming back, the creator holding, 20 minutes old.
  const CLEAN = `Clean${"1".repeat(38)}`;
  tape.apply({ kind: "create", name: "clean", symbol: "OK", mint: CLEAN, creator: "Other1111111111111111111111111111111111111", ts: now }, now);
  for (let b = 0; b < 30; b++) {
    const user = `Buyer${String(b).padStart(2, "0")}${"1".repeat(36)}`;
    tape.apply({ kind: "trade", mint: CLEAN, sol: 0.5, tokens: 10, isBuy: true, user, ts: now + 60_000, curveSol: 15 }, now);
    if (b < 4) tape.apply({ kind: "trade", mint: CLEAN, sol: 0.5, tokens: 10, isBuy: true, user, ts: now + 120_000, curveSol: 17 }, now);
  }
  const clean = tape.clean(10, now + 20 * 60_000);
  assert.deepEqual(clean.map((c) => c.symbol), ["OK"], "the serial dumper's tokens never make the list");
});

test("telegram messages carry the verdict and evidence, and escape whatever a token calls itself", async () => {
  const { askMessage, alertMessage } = await import("../src/telegram.ts");
  const ask = {
    id: "abcdef0123", mint: "M", symbol: "<b>RUG</b>", name: "", at: 0, verdict: "suspicious" as const, confidence: 0.9, why: "creator sold & ran", by: "model" as const, playbookVersion: 7, already: false,
    facts: { graduated: false, hasSocials: false, market: null, chain: null, flags: [], url: null,
      creator: { wallet: "W", launches24h: 9, launches48h: 12, dumped: 11, medianDumpMin: 1, graduated: 0, recent: [] } },
  };
  const text = askMessage(ask as never);
  assert.ok(text.includes("SUSPICIOUS"));
  assert.ok(text.includes("12 launches in 48h, dumped 11, median 1 min"));
  assert.ok(text.includes("&lt;b&gt;RUG&lt;/b&gt;") && text.includes("creator sold &amp; ran"));
  assert.ok(text.includes("Graded against reality in 24h"));
  const alert = alertMessage({ seq: 1, at: 0, kind: "dump", mint: "M", symbol: "X", text: "creator sold 90% after 1 min", tx: "SIG" });
  assert.ok(alert.includes("solscan.io/tx/SIG"));
});

test("the telegram bot welcomes with a picture and a menu, answers a pasted address, and watches from a button", async () => {
  const { startTelegram, COMMANDS } = await import("../src/telegram.ts");
  const sent: Array<{ method: string; body: Record<string, unknown> }> = [];
  const updates = [
    { update_id: 1, message: { message_id: 1, chat: { id: 7, type: "private" }, from: { id: 9, first_name: "Ann" }, text: "/start" } },
    { update_id: 2, message: { message_id: 2, chat: { id: 7, type: "private" }, from: { id: 9 }, text: "So11111111111111111111111111111111111111112" } },
    { update_id: 3, callback_query: { id: "q", from: { id: 9 }, data: "watch:So11111111111111111111111111111111111111112", message: { message_id: 3, chat: { id: 7, type: "private" } } } },
  ];
  let served = false;
  const fetchFn = (async (url: string, init?: { body?: string }) => {
    const method = String(url).split("/").pop()!;
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    sent.push({ method, body });
    if (method === "getUpdates") {
      await new Promise((r) => setTimeout(r, 20));
      const result = served ? [] : updates;
      served = true;
      return new Response(JSON.stringify({ ok: true, result }));
    }
    return new Response(JSON.stringify({ ok: true, result: { username: "zoo_bot" } }));
  }) as typeof fetch;
  const state = new Map<string, unknown>();
  const store = { get: async (k: string) => state.get(k) ?? null, set: async (k: string, v: unknown) => void state.set(k, v) };
  const desk = {
    ask: async (mint: string) => ({
      ok: true as const,
      reused: false,
      ask: { id: "abcdef0123", mint, symbol: "WRAP", name: "", at: 0, verdict: "watch", confidence: 0.5, why: "thin data", by: "model", playbookVersion: 7, already: false, facts: { graduated: false, hasSocials: null, market: null, chain: null, creator: null, flags: [], url: null } },
    }),
  };
  const stop = startTelegram({ token: "T", desk: desk as never, store: store as never, fetchFn, log: () => {} });
  await new Promise((r) => setTimeout(r, 200));
  stop();

  assert.ok(sent.some((c) => c.method === "setMyCommands" && (c.body.commands as unknown[]).length === COMMANDS.length));
  const photo = sent.find((c) => c.method === "sendPhoto")!;
  assert.ok(String(photo.body.caption).includes("Hi Ann"));
  assert.ok(JSON.stringify(photo.body.reply_markup).includes("Ask the beaver"));
  assert.ok(sent.some((c) => c.method === "sendMessage" && String(c.body.text).includes("$WRAP")));
  assert.deepEqual(state.get("tg:watchers"), { So11111111111111111111111111111111111111112: [7] });
});
