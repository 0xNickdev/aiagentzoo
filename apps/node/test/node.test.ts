import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { assertSigned, createEvent, Enclosure, FeedLedger, Identity, PeerDirectory, signEvent, verifyChain } from "@aiagentzoo/sdk";
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
    // A malformed report is refused without costing the slot.
    assert.equal((await post("/v1/events", report([{ mint: MINT, verdict: "maybe" }]))).body.accepted, false);
    const sent = await post("/v1/events", report([{ mint: MINT, verdict: "suspicious", note: "[click](https://evil) same art as a rug" }]));
    assert.equal(sent.body.accepted, true);
    // No contact on file: every answer asks the people behind the agent for one.
    assert.match(sent.body.notice, /add payload\.contact/);
    assert.equal((await post("/v1/events", report([{ mint: MINT, verdict: "watch" }]))).status, 429);

    // The guest leaves a contact by registering again with the same wallet: what it leaves out stays on file.
    assert.equal((await post("/v1/guests", register({ about: "Watches ClawPump launches", contact: "https://evil.example/x" }))).status, 400);
    await new Promise((r) => setTimeout(r, 5));
    const again = await post("/v1/guests", register({ about: "Watches ClawPump launches", contact: "@crabdev" }));
    assert.equal(again.status, 200);
    assert.equal(again.body.guest.contact, "https://x.com/crabdev");
    assert.equal(again.body.guest.token, MINT, "a field left out keeps its value");
    assert.equal(again.body.guest.webhook, undefined, "the webhook is never shown");
    assert.equal(again.body.notice, null, "with a contact and no warden message there is nothing to say");
    // The warden's message reaches every guest from now on; only the warden can set it.
    assert.equal((await post("/v1/guests/notice", { text: "hi" })).status, 401);
    const set = await post("/v1/guests/notice", { text: "We are running a builders call on Friday." }, { authorization: "Bearer t" });
    assert.equal(set.body.notice, "We are running a builders call on Friday.");
    const denied = await post("/v1/events", report([{ mint: MINT, verdict: "watch" }]));
    assert.equal(denied.body.notice, "ZOOAI AGENCY: We are running a builders call on Friday.");

    await (enclosure as any).agents.get("beaver").queue;
    await enclosure.wake("tortoise");
    assert.match(briefs[0]!, /## From the guest enclosures/);
    assert.match(briefs[0]!, /## Agent of the week so far\n_No guest agent graded in the week of/);
    assert.match(briefs[0]!, /\*\*crab\*\* \(ClawPump wing, sentinel, token/);
    assert.match(briefs[0]!, /suspicious `6ReK\w+` - click https:\/\/evil same art as a rug/);

    const log = await (await fetch(`${base}/v1/log?limit=1000`)).json();
    assert.equal(verifyChain(log), null);
    assert.ok(log.some((e: any) => e.event.type === "guest.signal" && e.event.payload.signal.sig));

    // A webhook to hear about grades: public hosts only, and never shown to anyone else.
    assert.equal((await post("/v1/guests", register({ about: "x", webhook: "https://localhost/hook" }))).status, 400);
    assert.equal((await post("/v1/guests", register({ about: "x", webhook: "https://canyon.railway.internal/x" }))).status, 400);
    assert.equal((await post("/v1/guests", register({ about: "Watches ClawPump launches", webhook: "https://hooks.example.com/zoo" }))).status, 200);
    assert.equal("webhook" in (await (await fetch(`${base}/v1/guests/crab`)).json()), false);
    const { notifyGraded } = await import("../src/notify.ts");
    const { nightOf } = await import("../src/agents/nightWatch.ts");
    const { previousNight } = await import("../src/agents/judgement.ts");
    const at = Date.UTC(2026, 9, 16, 12);
    const graded = previousNight(nightOf(at, "07:00"));
    await enclosure.store.set(`score:${graded}`, {
      night: graded, checked: 1, hits: 0, misses: 0, accuracy: null, cases: [],
      guests: { crab: { hits: 1, misses: 0, dead: 1, deadRight: 1, alive: 0, aliveRight: 0 } },
      guestCases: { crab: [{ mint: MINT, symbol: "SILK", verdict: "suspicious", outcome: "dead", hit: true }] },
    });
    const hooks: any[] = [];
    const hook = (async (url: string, init: RequestInit) => {
      hooks.push({ url, event: JSON.parse(String(init.body)) });
      return new Response("ok");
    }) as typeof fetch;
    assert.equal(await notifyGraded(enclosure, guests, "07:00", at, hook), 1);
    assert.equal(hooks[0].url, "https://hooks.example.com/zoo");
    assert.equal(hooks[0].event.type, "guest.graded");
    assert.equal(hooks[0].event.payload.cases[0].hit, true);
    assertSigned(hooks[0].event, canyon.identity.publicKey);
    // Told once per batch of grades.
    assert.equal(await notifyGraded(enclosure, guests, "07:00", at, hook), 0);

    assert.equal((await post("/v1/guests/crab/evict", {})).status, 401);
    assert.equal((await post("/v1/guests/crab/evict", {}, { authorization: "Bearer t" })).status, 200);
    assert.equal((await post("/v1/events", report([{ mint: MINT, verdict: "watch" }]))).status, 403);
  } finally {
    server.close();
  }
});

import { EchoProvider, type Transport } from "@aiagentzoo/sdk";
import { cleanPlaybook, curveCapOf, outcomeOf, scoreCall } from "../src/agents/judgement.ts";

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
  // On the bonding curve DexScreener gives no liquidity; the curve's cap in SOL decides.
  const DAY = 24 * 3_600_000;
  const curve = (curveCapSol: number | null, priceChange24h = 0, seenAt = DAY) =>
    obs({ seenAt, market: { priceUsd: null, liquidityUsd: null, curveCapSol, volume24hUsd: 0, priceChange24h, buys24h: 0, sells24h: 0, dex: "pumpfun", url: null } });
  assert.equal(outcomeOf(curve(120)), "alive");
  assert.equal(outcomeOf(curve(28)), "dead");
  assert.equal(outcomeOf(curve(50)), "unknown");
  assert.equal(outcomeOf(curve(120, -85)), "dead");
  assert.equal(outcomeOf(curve(null)), "unknown");
  // Every launch opens under the dead line, so a token minutes old is not dead by its curve.
  assert.equal(outcomeOf(curve(28, 0, 60_000)), "unknown");
  // DexScreener never listed it: the chain tape decides, by the SOL in the curve or the pool.
  const chain = (over: Record<string, unknown>) => obs({ market: null, chain: { ageMin: 1440, buys: 5, curveSol: 0.5, graduated: false, poolSol: null, ...over } as never });
  assert.equal(outcomeOf(chain({})), "dead");
  assert.equal(outcomeOf(chain({ curveSol: 30 })), "alive");
  assert.equal(outcomeOf(chain({ curveSol: 10 })), "unknown");
  assert.equal(outcomeOf(chain({ curveSol: null, buys: 0 })), "dead");
  assert.equal(outcomeOf(chain({ ageMin: 20 })), "unknown");
  assert.equal(outcomeOf(chain({ graduated: true, poolSol: 0.1 })), "dead");
  assert.equal(outcomeOf(chain({ graduated: true, poolSol: 60 })), "alive");
  assert.equal(Math.round(curveCapOf(0) * 10) / 10, 28);
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
  // The holders voted a gene and the week's best human picked a name: both go to this turn's newborn.
  const { GENE } = await import("../src/agents/evolution.ts");
  await enclosure.store.set(GENE.pending, { week: "2026-10-05", rule: "Suspicious when chain.creatorSold is above 0.5." });
  await enclosure.store.set(GENE.name, { week: "2026-10-05", wallet: "w", name: "Ember" });
  await enclosure.wake("heron");
  assert.equal(await enclosure.store.get(GENE.pending), undefined, "the gene is used once");

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
  assert.equal(child.name, "Ember");
  assert.ok(view!.chronicle.some((e) => e.kind === "birth" && /chosen by \$ZOOAGENCY holders: Suspicious when chain.creatorSold/.test(e.text) && /Named Ember/.test(e.text)));
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
  // Two dumps is not yet a wall entry; a third puts the dev on it.
  assert.equal(tape.ruggers(10, now).length, 0);

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

test("mini app initData is trusted only with Telegram's signature and only for a day", async () => {
  const { verifyInitData } = await import("../src/telegram.ts");
  const { createHmac } = await import("node:crypto");
  const token = "123:ABC";
  const now = 1_800_000_000_000;
  const sign = (fields: Record<string, string>) => {
    const check = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(token).digest();
    const hash = createHmac("sha256", secret).update(check).digest("hex");
    return new URLSearchParams({ ...fields, hash }).toString();
  };
  const fields = { auth_date: String(now / 1000), user: JSON.stringify({ id: 42, first_name: "Ann" }), query_id: "q" };
  assert.equal(verifyInitData(sign(fields), token, now), 42);
  assert.equal(verifyInitData(sign(fields), "999:other", now), null, "another bot's token");
  assert.equal(verifyInitData(sign(fields).replace("42", "43"), token, now), null, "tampered user");
  assert.equal(verifyInitData(sign(fields), token, now + 25 * 3_600_000), null, "too old");
});

test("the tape spots a launch-block bundle, and the bundle's wallets trace back to one funder", async () => {
  const { PumpTape } = await import("../src/chain/pump.ts");
  const { ruleFlags } = await import("../src/agents/judgement.ts");
  const tape = new PumpTape();
  const now = 1_800_000_000_000;
  const MINT = `Bndl${"1".repeat(39)}`;
  const DEV = `Dev${"1".repeat(40)}`;
  tape.apply({ kind: "create", name: "b", symbol: "BNDL", mint: MINT, creator: DEV, ts: now }, now, "tx0", 500);
  tape.apply({ kind: "trade", mint: MINT, sol: 1, tokens: 30_000_000, isBuy: true, user: DEV, ts: now, curveSol: 1 }, now, "tx1", 500);
  for (let i = 0; i < 5; i++) {
    tape.apply({ kind: "trade", mint: MINT, sol: 2, tokens: 40_000_000, isBuy: true, user: `W${i}${"1".repeat(41)}`, ts: now, curveSol: 3 }, now, `b${i}`, 500 + (i % 2));
  }
  // A buyer three blocks later is just early, not bundled.
  tape.apply({ kind: "trade", mint: MINT, sol: 1, tokens: 20_000_000, isBuy: true, user: `Late${"1".repeat(39)}`, ts: now, curveSol: 4 }, now, "late", 503);
  const f = tape.facts(MINT, now)!;
  assert.equal(f.bundleWallets, 5, "the creator's own buy is not counted, nor the late buyer");
  assert.equal(f.bundleShare, 0.2);
  assert.ok(ruleFlags({ mint: MINT, symbol: "BNDL", name: "", source: "pump", createdAt: now, creator: DEV, hasSocials: null, complete: false, marketCapUsd: null, market: null, seenAt: now, scout: "raven", chain: f }).some((r) => r.startsWith("bundled: 5 wallets took 20%")));
  assert.equal(tape.token(MINT)!.bundle.length, 5);

  process.env.SOLANA_RPC_URL = "http://rpc.test";
  const { traceFunders } = await import(`../src/chain/funders.ts?t=${Date.now()}`);
  const FUNDER = `Fund${"1".repeat(39)}`;
  const fetchFn = (async (_url: string, init?: { body?: string }) => {
    const req = JSON.parse(init!.body!) as { method: string; params: [string] };
    if (req.method === "getSignaturesForAddress") return new Response(JSON.stringify({ result: [{ signature: `sig-${req.params[0]}` }] }));
    const wallet = req.params[0].slice(4);
    const source = wallet.startsWith("W0") || wallet.startsWith("W1") || wallet.startsWith("W2") ? FUNDER : `Other${wallet}`;
    return new Response(JSON.stringify({ result: { transaction: { message: { instructions: [{ program: "system", parsed: { type: "transfer", info: { source, destination: wallet, lamports: 2_100_000_000 } } }] } } } }));
  }) as typeof fetch;
  const report = (await traceFunders(MINT, tape.token(MINT)!.bundle.map((b) => b.wallet), fetchFn, now))!;
  assert.equal(report.linked, 3);
  assert.equal(report.groups[0]!.funder, FUNDER);
  delete process.env.SOLANA_RPC_URL;
});

test("holder report leaves pools out of wallet shares and finds what the creator still holds", async () => {
  process.env.SOLANA_RPC_URL = "http://rpc.test";
  const { holderReport } = await import(`../src/chain/holders.ts?t=${Date.now()}`);
  const fetchFn = (async (url: string, init?: { body?: string }) => {
    if (String(url).includes("pump.fun")) return new Response(JSON.stringify({ creator: "Dev" }));
    const { method, params } = JSON.parse(init!.body!) as { method: string; params: unknown[] };
    const ok = (result: unknown) => new Response(JSON.stringify({ result }));
    if (method === "getTokenSupply") return ok({ value: { uiAmount: 1000 } });
    if (method === "getTokenLargestAccounts") return ok({ value: [{ address: "ta-pool", uiAmount: 400 }, { address: "ta-w1", uiAmount: 150 }, { address: "ta-w2", uiAmount: 50 }] });
    if (method === "getMultipleAccounts") {
      const keys = params[0] as string[];
      // Real wallet addresses: a holder has to be a point on the curve.
      const wallet: Record<string, string> = { "ta-w1": "CogH8XVFdLBkYpdJH8CHoJKrBZxwuU95LFvQCeWYbm6N", "ta-w2": "8TPACXaKotSZ7WXktfmKDRhgoypyGXNzo1ctr2YBzxLc" };
      if (keys[0]!.startsWith("ta-")) return ok({ value: keys.map((k) => ({ data: { parsed: { info: { owner: k === "ta-pool" ? "Pool" : wallet[k] } } } })) });
      return ok({ value: keys.map((k) => (k === "Pool" ? { owner: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA" } : { owner: "11111111111111111111111111111111" })) });
    }
    if (method === "getTokenAccountsByOwner") return ok({ value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: 120 } } } } } }] });
    return ok(null);
  }) as typeof fetch;
  const r = (await holderReport("MINT", fetchFn, 1))!;
  assert.equal(r.programShare, 0.4, "the pool is not a holder");
  assert.equal(r.top10Share, 0.2);
  assert.equal(r.topShare, 0.15);
  assert.equal(r.creatorShare, 0.12);
  delete process.env.SOLANA_RPC_URL;
});

test("the beaver's record counts the tokens it warned about that then died", async () => {
  const { beaverRecord } = await import("../src/stats.ts");
  const { nightOf } = await import("../src/agents/nightWatch.ts");
  const { previousNight } = await import("../src/agents/judgement.ts");
  const last = previousNight(nightOf(Date.now(), "07:00"));
  const cases = [
    { mint: "a", symbol: "A", verdict: "suspicious", why: "", outcome: "dead", hit: true },
    { mint: "b", symbol: "B", verdict: "suspicious", why: "", outcome: "dead", hit: true, already: true },
    { mint: "c", symbol: "C", verdict: "promising", why: "", outcome: "dead", hit: false },
    { mint: "d", symbol: "D", verdict: "suspicious", why: "", outcome: "alive", hit: false },
  ];
  const store = { get: async (k: string) => (k === `score:${last}` ? { night: last, cases } : null) };
  const r = await beaverRecord({ store } as never, "07:00")();
  assert.equal(r.warnedDead, 1, "already-dead tokens don't count");
  assert.equal(r.nights.length, 1);
  assert.equal(r.calls.length, 3);
});

test("agent of the week runs Monday to Sunday", async () => {
  const { weekOf } = await import("../src/stats.ts");
  assert.equal(weekOf("2026-10-15"), "2026-10-12", "a Thursday belongs to the week starting Monday");
  assert.equal(weekOf("2026-10-12"), "2026-10-12");
  assert.equal(weekOf("2026-10-18"), "2026-10-12", "Sunday closes it");
});

test("humans vs the beaver: answers to tonight's exam, graded by the same re-check as the nursery", async () => {
  const { submitAnswers, humansView } = await import("../src/humans.ts");
  const { nightOf } = await import("../src/agents/nightWatch.ts");
  const { previousNight } = await import("../src/agents/judgement.ts");
  const now = Date.now();
  const night = nightOf(now, "07:00");
  const state = new Map<string, unknown>([[`evo:exam:${night}`, { night, tokens: [{ mint: "A" }, { mint: "B" }] }]]);
  const store = { get: async (k: string) => state.get(k) ?? null, set: async (k: string, v: unknown) => void state.set(k, v) };
  const r = await submitAnswers(store as never, "W1", [{ mint: "A", verdict: "suspicious" }, { mint: "Z", verdict: "promising" }, { mint: "B", verdict: "maybe" }], "07:00", now);
  assert.ok(r.ok && r.answered === 1, "only tonight's tokens with a real verdict count");

  // Yesterday's answers, graded by yesterday's re-check.
  const y = previousNight(night);
  state.set(`humans:${y}`, { W1: { A: "suspicious", B: "promising" } });
  state.set(`followup:${y}`, { A: { symbol: "A", outcome: "dead" }, B: { symbol: "B", outcome: "dead" } });
  const view = await humansView(store as never, "07:00", "W1", now);
  const me = view.standings.find((s) => s.you)!;
  // Yesterday may fall in last week on a Monday; then this week is empty and last week holds it.
  if (me) {
    assert.equal(me.dead, 2);
    assert.equal(me.deadRight, 1);
  }
  assert.deepEqual(view.mine, { A: "suspicious" });
});

test("the tape follows a token onto PumpSwap after it graduates", async () => {
  const { parsePumpLogs, PumpTape, fromBase58 } = await import("../src/chain/pump.ts");
  // Real logs from mainnet: a pool created at graduation, and a sell on another pool.
  const realPool =
    "Program data: sTEM0qB2p3QMcdBqAAAAAAAA0q9yz37jvAP9dQ1p9yvq4yFeIB6S+4C1zGyv5MfUfXXo1yD4PLkKGAlLGE6lyUJ8wIYMn9hOrq7xxqON3ANfnwabiFf+q4GE+2h/Y0YYwDXaxDncGus7VZig8AAAAAABBglKdVSlDLsAAOY4SugTAAAASnVUpQy7AADmOEroEwAAAGQAAAAAAAAAT/JrWdADAADr8WtZ0AMAAP5uYT+VxA1pOv+m2cNuMkZ98bV19KRNDzNNsURxSU0QA4v0h3a/ShiHYI+Ox05iwcbpTsZLVnWg9S/kTQcLYncrjF/kd2zGaiJaWXOMa5wo4Rfj9sTIGuByEV+Hw3GqSp5StczG5IPAFrEaXjUe5UN/oQyAnYt3oMGZmeaXqEWIb1LC83tr8MvNIMlZWHFG/j2yPQJxVdI1NPk/MkmvpgQqAAAAAAAAAAAAAAE=";
  const realSell =
    "Program data: Pi83CqUD3CovcdBqAAAAABkaUl4BAAAAd8piXdX1AQAZGlJeAQAAADdBQP+s5wMA568N9aIAAABPTx3M/6kGAQwtWRb3LwIAGQAAAAAAAACYJLJgZgEAAAUAAAAAAAAAuG3wrEcAAAB0CKe1kC4CALyatghJLgIARdq8folYGiZgs8xYV4Fu5R5hivgdSvWEpFJwUyXUDOZEgAMe6AHxidtaU/9QdEAQ+3KCTi/4ky8ebR8WSdG5MTdS4IgTCT2TGl4EcxRbqvuSq9lLzJQOs8JCyKq3QlerhTWFkd2+V3gQvzFGNuCfmhW3UqHe2j1T3idKaWgPm95KwvjQ3Vy8l+MonBl8tQYqVPPZVrnOblEV+WVnqlyz5ryFgGo/TURi+0sX74LE2NiJZ56XysFhBl168zXVUH8BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIgTAAAAAAAA3DZ41iMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const GRAD = "Gfur7siWmL1SjkBit3mA4rJ1PqBGJzje5ZwQZkqapump";
  const POOL = "8RsrWtfzSd9Wzy1BMmU18w2UR397UQGz7tDwtK7mJ79t";
  const [pool] = parsePumpLogs([realPool]);
  assert.deepEqual(pool, { kind: "pool", mint: GRAD, pool: POOL });
  const [sell] = parsePumpLogs([realSell]) as any[];
  assert.equal(sell.kind, "swap");
  assert.equal(sell.isBuy, false);
  assert.equal(sell.pool, "5hgao1gkk4742tsPbJaJoXtKViRNVYw6KPEn2Jvm4HaM");
  assert.equal(sell.user, "5cPwQhFCDMAzuJ8w5TGLTbVvmTbaM2TuZ3r7jNyvXXpL");

  const CREATOR = "So11111111111111111111111111111111111111112";
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
  const create = line([27, 114, 169, 77, 222, 235, 99, 118], Buffer.concat([str("grad"), str("GRAD"), str("ipfs://x"), fromBase58(GRAD), fromBase58(CREATOR), fromBase58(CREATOR)]));
  const buy = line([189, 219, 127, 211, 78, 230, 97, 238], Buffer.concat([fromBase58(GRAD), u64(1_000_000_000n), u64(10_000_000n * 1_000_000n), Buffer.from([1]), fromBase58(CREATOR), u64(1_791_600_000n)]));
  // A PumpSwap trade: timestamp, 13 amounts (base, limit, 4 reserves, quote, 5 fees, what the user paid or got), pool, user.
  // The reserves are from before the swap; the pool's SOL after it is reserves plus or minus the quote with the LP fee.
  const swap = (isBuy: boolean, user: string, tokens: bigint, lamports: bigint, poolLamports: bigint, pool = POOL) => {
    const f = [tokens * 1_000_000n, 0n, 0n, 0n, 0n, poolLamports, lamports, 0n, 0n, 0n, 0n, lamports, lamports];
    const disc = isBuy ? [103, 244, 82, 31, 44, 245, 119, 119] : [62, 47, 55, 10, 165, 3, 220, 42];
    return line(disc, Buffer.concat([u64(1_791_600_100n), ...f.map(u64), fromBase58(pool), fromBase58(user)]));
  };

  const tape = new PumpTape();
  const now = 1_791_600_000_000;
  const events = parsePumpLogs([create, buy, realPool, swap(true, "11111111111111111111111111111111", 1_000n, 2_000_000_000n, 90_000_000_000n), swap(false, CREATOR, 6_000_000n, 3_000_000_000n, 88_000_000_000n)]);
  for (const e of events) tape.apply(e, now);
  const f = tape.facts(GRAD, now)!;
  assert.equal(f.graduated, true);
  assert.equal(f.ammBuys, 1);
  assert.equal(f.ammSells, 1);
  assert.equal(f.ammSolIn, 2);
  assert.equal(f.ammSolOut, 3);
  assert.equal(f.poolSol, 85);
  // The creator bought 10M on the curve and sold 6M on PumpSwap: a dump after graduation still counts.
  assert.equal(f.creatorSold, 0.6);
  assert.deepEqual(tape.pulseAfter(0).map((e) => e.kind), ["launch", "graduated", "dump"]);

  // A deploy restarts the node: the tape comes back from its snapshot, pools and creators included.
  const reborn = new PumpTape();
  assert.equal(reborn.load(tape.snapshot(), now), 1);
  assert.deepEqual(reborn.facts(GRAD, now), f);
  assert.equal(reborn.creator(CREATOR, now)?.launches48h, 1);
  reborn.apply(parsePumpLogs([swap(true, "11111111111111111111111111111111", 1n, 1_000_000_000n, 89_000_000_000n)])[0]!, now);
  assert.equal(reborn.facts(GRAD, now)!.ammBuys, 2);
  // Someone opens a second, tiny SOL pool for the token: its trades count, but it does not stand in for the main pool.
  const SIDE = "5hgao1gkk4742tsPbJaJoXtKViRNVYw6KPEn2Jvm4HaM";
  reborn.apply({ kind: "pool", mint: GRAD, pool: SIDE }, now);
  reborn.apply(parsePumpLogs([swap(false, "11111111111111111111111111111111", 1n, 100_000_000n, 500_000_000n, SIDE)])[0]!, now);
  assert.equal(reborn.facts(GRAD, now)!.ammSells, 2);
  assert.equal(reborn.facts(GRAD, now)!.poolSol, 90);
  assert.equal(reborn.pulseAfter(0).filter((e) => e.kind === "drained").length, 0);
  // The pool falls from 90 SOL to 5: drained, announced once.
  for (const lamports of [5_000_000_000n, 4_000_000_000n]) reborn.apply(parsePumpLogs([swap(false, "11111111111111111111111111111111", 1n, 1n, lamports)])[0]!, now);
  assert.deepEqual(reborn.pulseAfter(0).filter((e) => e.kind === "drained").map((e) => e.text), ["pool drained to 5.0 SOL after graduation"]);
  // Two days on, nothing old comes back.
  assert.equal(new PumpTape().load(tape.snapshot(), now + 49 * 3_600_000), 0);
});

test("holders hear about a watched token's dump first, everyone else after the head start", async () => {
  const { planAlerts, linkCode, redeemCode, HOLDER_HEAD_START_MS } = await import("../src/telegram.ts");
  const state = new Map<string, unknown>();
  const store = { get: async (k: string) => state.get(k) ?? null, set: async (k: string, v: unknown) => void state.set(k, v), delete: async (k: string) => void state.delete(k) } as any;
  const now = 1_800_000_000_000;
  // The site makes a code for a signed-in wallet; the bot ties the chat to it once.
  const code = await linkCode(store, "HolderWallet111", now);
  assert.match(code, /^[A-Z0-9X]{6}$/);
  assert.equal(await redeemCode(store, 1, code.toLowerCase(), now), "HolderWallet111");
  assert.equal(await redeemCode(store, 2, code, now), null, "used once");
  assert.equal(await redeemCode(store, 2, await linkCode(store, "W", now), now + 16 * 60_000), null, "expired");

  const dump = { seq: 5, at: now, kind: "dump" as const, mint: MINT, symbol: "SILK", text: "creator sold 90% after 3 min", creator: "c" };
  const launch = { ...dump, seq: 4, kind: "launch" as const };
  const plan = await planAlerts([launch, dump], { [MINT]: [1, 2] }, async (chat) => state.get(`tg:wallet:${chat}`) === "HolderWallet111", now);
  assert.equal(plan.length, 2);
  const [holder, other] = [plan.find((p) => p.chat === 1)!, plan.find((p) => p.chat === 2)!];
  assert.equal(holder.at, now);
  assert.match(holder.text, /^⚡/);
  assert.equal(other.at, now + HOLDER_HEAD_START_MS);
  assert.match(other.text, /Holders saw this 10 min ago/);
});

test("holders vote the nursery's next gene with their balance, and the week's best human names the newborn", async () => {
  const { openVote, castVote, closeWeek, geneView, nameNewborn } = await import("../src/gene.ts");
  const { GENE, EVO } = await import("../src/agents/evolution.ts");
  const state = new Map<string, unknown>();
  const store = {
    get: async (k: string) => state.get(k),
    set: async (k: string, v: unknown) => void state.set(k, structuredClone(v)),
    delete: async (k: string) => void state.delete(k),
    keys: async (p = "") => [...state.keys()].filter((k) => k.startsWith(p)).sort(),
  } as any;
  // A model proposes three rules aimed at the nursery's mistakes.
  state.set(EVO.population, { generation: 1, lastGenerationNight: null, nextId: 3, creatures: {
    c1: { id: "c1", name: "Fox I", house: "Fox", generation: 0, parents: null, temperament: "t", playbook: "1. x", mutation: null, bornNight: "n", diedNight: null, epitaph: null, lifetime: {}, window: {} },
  } });
  const model = { id: "m", think: async () => ({ text: '["Suspicious when chain.creatorSold is above 0.5 in the first hour.", "Promising needs chain.repeatBuyers of 10 or more.", "Watch any token with chain.bundleShare above 0.2."]', inputTokens: 0, outputTokens: 0 }) };
  const week = "2026-10-19";
  const vote = (await openVote(store, week, model))!;
  assert.deepEqual(vote.candidates.map((c) => c.id), ["a", "b", "c"]);
  assert.equal((await openVote(store, week, model))!.candidates[0]!.rule, vote.candidates[0]!.rule, "opened once");

  assert.equal((await castVote(store, week, "whale", "d", 9e6)).ok, false);
  await castVote(store, week, "whale", "a", 9_000_000);
  await castVote(store, week, "two", "b", 3_000_000);
  await castVote(store, week, "three", "b", 2_000_000);
  assert.deepEqual((await geneView(store, "07:00", "two", Date.UTC(2026, 9, 21, 12))).tally, { a: 9_000_000, b: 5_000_000, c: 0 });

  // The whale sold after voting: at the close only what it still holds counts, and b wins.
  const closed = (await closeWeek(store, week, async (w) => (w === "whale" ? 1_000_000 : 5_000_000)))!;
  assert.equal(closed.closed!.winner!.id, "b");
  assert.deepEqual(state.get(GENE.pending), { week, rule: "Promising needs chain.repeatBuyers of 10 or more." });
  assert.equal((await castVote(store, week, "late", "a", 1)).ok, false, "closed");

  // Naming: only the week's best human, one capitalised word.
  state.set(GENE.name, { week, wallet: "winner", name: null });
  assert.equal((await nameNewborn(store, "someone", "Ember")).ok, false);
  assert.equal((await nameNewborn(store, "winner", "ember fire")).ok, false);
  assert.equal((await nameNewborn(store, "winner", "Ember")).ok, true);
  assert.equal((state.get(GENE.name) as any).name, "Ember");
});

test("the morning brief tells the weekly contest: the leader, and what the rest still need", async () => {
  const { weekText } = await import("../src/agents/nightWatch.ts");
  const w = { start: "2026-10-19", end: "2026-10-25", minGraded: 20, minSide: 3, rows: [
    { name: "crabby", score: 0.72, graded: 31, dead: 22, alive: 9, ranked: true },
    { name: "zhu-dd", score: 0.61, graded: 12, dead: 12, alive: 0, ranked: false },
    { name: "owlet", score: 0.55, graded: 25, dead: 24, alive: 1, ranked: false },
  ] };
  const text = weekText(w);
  assert.match(text, /^\*\*crabby\*\* leads the week of 2026-10-19 to 2026-10-25\./);
  assert.match(text, /1\. \*\*crabby\*\* - 72% over 31 graded calls\n/);
  assert.match(text, /zhu-dd\*\* - 61% over 12 graded calls · 8 more graded to qualify/);
  assert.match(text, /owlet\*\* - 55% over 25 graded calls · 2 more living to qualify/);
  assert.match(weekText({ ...w, rows: [w.rows[1]!] }), /^Nobody qualifies yet/);
});

test("the bot answers a Chinese client in Chinese, and /lang switches the chat", async () => {
  const { startTelegram } = await import("../src/telegram.ts");
  const sent: Array<{ method: string; body: Record<string, unknown> }> = [];
  const updates = [
    { update_id: 1, message: { message_id: 1, chat: { id: 8, type: "private" }, from: { id: 8, first_name: "Li", language_code: "zh-hans" }, text: "/start" } },
    { update_id: 2, message: { message_id: 2, chat: { id: 8, type: "private" }, from: { id: 8, language_code: "zh-hans" }, text: "/lang" } },
    { update_id: 3, message: { message_id: 3, chat: { id: 8, type: "private" }, from: { id: 8, language_code: "zh-hans" }, text: "/help" } },
  ];
  let served = false;
  const fetchFn = (async (url: string, init?: { body?: string }) => {
    const method = String(url).split("/").pop()!;
    sent.push({ method, body: init?.body ? JSON.parse(init.body) : {} });
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
  const stop = startTelegram({ token: "T", desk: {} as never, store: store as never, fetchFn, log: () => {} });
  await new Promise((r) => setTimeout(r, 200));
  stop();
  assert.match(String(sent.find((c) => c.method === "sendPhoto")!.body.caption), /Li，你好，欢迎来到 ZOOAI AGENCY/);
  assert.ok(sent.some((c) => c.method === "setMyCommands" && c.body.language_code === "zh" && JSON.stringify(c.body).includes("海狸")));
  // /lang flips this chat to English, and later answers follow it.
  assert.equal(state.get("tg:lang:8"), "en");
  const texts = sent.filter((c) => c.method === "sendMessage").map((c) => String(c.body.text));
  assert.ok(texts.some((x) => x.includes("Language: English")));
  assert.ok(texts.some((x) => x.startsWith("<b>Commands</b>")));
});

test("the beaver's reasons come back from one numbered translation, missing lines stay English", async () => {
  const { numberedLines, parseNumbered } = await import("../src/translate.ts");
  assert.equal(numberedLines(["creator sold  90%", "no socials"]), "1. creator sold 90%\n2. no socials");
  assert.deepEqual(parseNumbered("1. 开发者砸盘 90%\n2) no socials\n3、 越界", 2), ["开发者砸盘 90%", null]);
});

test("the pre-trade check says avoid, caution or pass in plain words, and never vouches for a token it never saw", async () => {
  const { checkToken, RateGate } = await import("../src/chain/check.ts");
  const facts = (over: Record<string, unknown> = {}) => ({
    ageMin: 45, buys: 80, sells: 30, buyers: 60, solIn: 20, solOut: 5, curveSol: 15, creatorSold: 0, creatorLaunches24h: 1, graduated: false,
    top5Share: 0.3, repeatBuyers: 8, trades15m: 50, bundleWallets: 0, bundleShare: 0, poolSol: null, ammBuys: 0, ammSells: 0, ammSolIn: 0, ammSolOut: 0, ...over,
  }) as never;
  const rec = (over: Record<string, unknown> = {}) => ({ wallet: "w", launches24h: 1, launches48h: 1, dumped: 0, medianDumpMin: null, graduated: 0, recent: [], ...over }) as never;
  const clean = checkToken("M", { symbol: "OK", facts: facts(), creatorRecord: rec() });
  assert.equal(clean.verdict, "pass");
  assert.equal(clean.proceed, true);
  assert.deepEqual(clean.reasons, []);
  assert.match(clean.notes.join(" "), /not a call that the price goes up/);

  const dumped = checkToken("M", { symbol: "D", facts: facts({ creatorSold: 1 }), creatorRecord: rec() });
  assert.equal(dumped.verdict, "avoid");
  assert.equal(dumped.proceed, false);
  assert.match(dumped.reasons[0]!, /creator sold 100%/);

  const serial = checkToken("M", { symbol: "S", facts: facts({ creatorLaunches24h: 40 }), creatorRecord: rec({ launches48h: 40, dumped: 38, medianDumpMin: 0 }) });
  assert.equal(serial.verdict, "avoid");
  assert.match(serial.reasons[0]!, /dumped 38 of their 40 launches in 48 hours, usually 0 min after launch/);

  assert.equal(checkToken("M", { symbol: "B", facts: facts({ bundleWallets: 6, bundleShare: 0.4 }), creatorRecord: rec() }).verdict, "avoid");
  assert.equal(checkToken("M", { symbol: "Z", facts: facts({ ageMin: 600, curveSol: 0.2 }), creatorRecord: rec() }).verdict, "avoid");
  // Paired with another token, the curve is not in SOL: no dead-curve call.
  assert.equal(checkToken("M", { symbol: "Q", facts: facts({ ageMin: 600, curveSol: null, quote: "Q1" }), creatorRecord: rec() }).verdict, "pass");

  // Minutes in, a sniper hears pass with a note, unless the creator's own record already speaks.
  const fresh = checkToken("M", { symbol: "F", facts: facts({ ageMin: 2, buyers: 3, top5Share: 1 }), creatorRecord: rec() });
  assert.equal(fresh.verdict, "pass");
  assert.match(fresh.notes[0]!, /only 2 min old/);
  assert.equal(checkToken("M", { symbol: "F", facts: facts({ ageMin: 2 }), creatorRecord: rec({ launches48h: 9, dumped: 8, medianDumpMin: 1 }) }).verdict, "avoid");

  // Holders on request: a creator who never sold but holds nothing moved the bag.
  const moved = checkToken("M", { symbol: "H", facts: facts({ creatorSold: 0 }), creatorRecord: rec() }, { holders: { top10Share: 0.3, topShare: 0.05, programShare: 0.6, creator: "c", creatorShare: 0 } });
  assert.equal(moved.verdict, "caution");
  assert.match(moved.reasons[0]!, /bag moved to other wallets/);
  assert.deepEqual(moved.holders, { top10Pct: 30, topWalletPct: 5, creatorHoldsPct: 0 });
  const whale = checkToken("M", { symbol: "W", facts: facts(), creatorRecord: rec() }, { holders: { top10Share: 0.6, topShare: 0.35, programShare: 0.2, creator: null, creatorShare: null } });
  assert.match(whale.reasons[0]!, /one wallet holds 35%/);
  const noRpc = checkToken("M", { symbol: "N", facts: facts(), creatorRecord: rec() }, { holders: null });
  assert.equal(noRpc.verdict, "pass");
  assert.match(noRpc.notes.join(" "), /holders could not be read/);

  const unseen = checkToken("M", null, { stream: { live: false, lastEventSecAgo: 300 } });
  assert.equal(unseen.verdict, "unknown");
  assert.equal(unseen.proceed, null);
  assert.match(unseen.notes[0]!, /stream is down/);

  const gate = new RateGate(2);
  assert.equal(gate.take("a", 0), 0);
  assert.equal(gate.take("a", 1), 0);
  assert.ok(gate.take("a", 2) > 0);
  assert.equal(gate.take("b", 2), 0);
  assert.equal(gate.take("a", 60_001), 0);
});

test("the creator check keeps its own record: what it would have said five minutes in, against the next day", async () => {
  const { PumpTape } = await import("../src/chain/pump.ts");
  const tape = new PumpTape();
  const now = 1_792_200_000_000;
  const born = now - 30 * 3_600_000;
  const BAD = "So11111111111111111111111111111111111111112";
  const GOOD = "11111111111111111111111111111112";
  const create = (mint: string, creator: string, at: number) => tape.apply({ kind: "create", name: mint, symbol: mint.slice(0, 4), mint, creator, ts: at }, at);
  const trade = (mint: string, user: string, isBuy: boolean, tokens: number, at: number, curveSol: number) =>
    tape.apply({ kind: "trade", mint, sol: 1, tokens, isBuy, user, ts: at, curveSol }, at);
  // A creator who dumped in the first minute and is back at the opening line a day later.
  create("Bad1111111111111111111111111111111111111111", BAD, born);
  trade("Bad1111111111111111111111111111111111111111", BAD, true, 1_000_000, born, 1);
  trade("Bad1111111111111111111111111111111111111111", BAD, false, 1_000_000, born + 60_000, 0.1);
  // A clean launch that ends the day far up the curve.
  create("Good111111111111111111111111111111111111111", GOOD, born);
  trade("Good111111111111111111111111111111111111111", "Buyer11111111111111111111111111111111111111", true, 5_000_000, born + 30 * 60_000, 40);
  // Too young to grade.
  create("Young11111111111111111111111111111111111111", GOOD, now - 3_600_000);
  const r = tape.checkRecord(now);
  assert.deepEqual(r.flaggedAvoid, { n: 1, dead: 1, alive: 0, unknown: 0 });
  assert.deepEqual(r.notFlagged, { n: 1, dead: 0, alive: 1, unknown: 0 });
  assert.equal(r.avoidBecause.dumped, 1);
});

test("a pump.fun launch paired with another token is tracked, but its amounts are never read as SOL", async () => {
  const { parsePumpLogs, PumpTape } = await import("../src/chain/pump.ts");
  // Real CreateV2 event from mainnet: META, paired with OTC (MukLD...pump) instead of SOL.
  const createV2 =
    "Program data: G3KpTd7rY3YEAAAATWV0YQQAAABNRVRBUAAAAGh0dHBzOi8vaXBmcy5pby9pcGZzL2JhZmtyZWllNTZidjRqMnBxZWh5c2RnbnAzZ2podW5ueDNqb2dlYXR5YW5rNzdqdHJ4cHY2eG1sd3d1QWxz18ddr7sq/rsjufRrIG4CLndr7j7MzZJFIX4pr1J9HnyOhQVUy0f/k4+Vsl7znVnVVk/QM2AY/chxCvLvNavK85lK16L4NnmZGte9MB+mlla1dsuwqdB7XMw4/pNeq8rzmUrXovg2eZka170wH6aWVrV2y7Cp0HtczDj+k17cJNFqAAAAAAAQ2EfjzwMAQDKin1YAAAAAeMX7UdECAACAxqR+jQMABt324e51j94YQl285GzN2rYa/E2DuQ0n/r35KNihi/wAAAVbQewvE0/oSDZZk1EOc+yvWUFcu1gGKlY2RWejfTXPQDKin1YAAAAsAQAAAAAAAAAA";
  const [ev] = parsePumpLogs([createV2]) as any[];
  assert.equal(ev.kind, "create");
  assert.equal(ev.mint, "5QPR9T9ZMwKcGLWwGWWajRLuEyasNEZxLkaCmRwWeoGV");
  assert.equal(ev.quote, "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump");
  const tape = new PumpTape();
  const now = 1_792_091_400_000;
  tape.apply(ev, now);
  tape.apply({ kind: "trade", mint: ev.mint, sol: 500, tokens: 1e6, isBuy: true, user: "11111111111111111111111111111111", ts: now, curveSol: 400 }, now);
  const f = tape.facts(ev.mint, now)!;
  assert.equal(f.quote, "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump");
  assert.equal(f.curveSol, null);
  assert.equal(tape.pulseAfter(0).filter((e) => e.kind === "whale").length, 0);
});

test("clean launches leave out bundled launch blocks", async () => {
  const { PumpTape } = await import("../src/chain/pump.ts");
  const now = 1_792_300_000_000;
  const born = now - 30 * 60_000;
  const make = (mint: string, creator: string, bundled: boolean) => {
    const tape = new PumpTape();
    tape.apply({ kind: "create", name: mint, symbol: mint.slice(0, 4), mint, creator, ts: born }, born, undefined, 100);
    // Three wallets in the launch block take 30% of the supply between them.
    if (bundled) for (const w of ["Aa111111111111111111111111111111", "Bb111111111111111111111111111111", "Cc111111111111111111111111111111"]) {
      tape.apply({ kind: "trade", mint, sol: 1, tokens: 100_000_000, isBuy: true, user: w, ts: born, curveSol: 3 }, born, undefined, 101);
    }
    for (let i = 0; i < 30; i++) {
      const w = `Buyer${String(i).padStart(2, "0")}${"1".repeat(27)}`;
      for (let k = 0; k < 2; k++) tape.apply({ kind: "trade", mint, sol: 0.5, tokens: 1_000_000, isBuy: true, user: w, ts: born + 60_000 * (i + 1), curveSol: 10 }, born, undefined, 500 + i);
    }
    return tape.clean(20, now).map((c) => c.mint);
  };
  assert.deepEqual(make("Clean11111111111111111111111111111111111111", "Dev11111111111111111111111111111", false), ["Clean11111111111111111111111111111111111111"]);
  assert.deepEqual(make("Bundle1111111111111111111111111111111111111", "Dev11111111111111111111111111111", true), []);
});

test("the watchdog speaks once when something breaks and once when it heals", async () => {
  const { Watchdog } = await import("../src/watchdog.ts");
  const dog = new Watchdog({ briefAt: "07:00" });
  const t0 = Date.parse("2026-10-16T00:24:00Z");
  const entry = (type: string, payload: Record<string, unknown>, agent = "beaver") => ({ seq: 1, prevHash: "", hash: "", event: { v: 1, id: "x", kind: "trace", type, from: { node: "canyon.zoo", agent }, payload, ts: t0 } }) as never;
  const fail = entry("judge.fallback", { reason: "OpenAI 429: You have no credits remaining." });
  assert.deepEqual(dog.onEntry(fail, t0), []);
  assert.deepEqual(dog.onEntry(fail, t0 + 60_000), []);
  const alert = dog.onEntry(fail, t0 + 120_000);
  assert.equal(alert.length, 1);
  assert.match(alert[0]!, /model is not answering: 3 failures/);
  assert.match(alert[0]!, /no credits remaining/);
  // Said once, not on every failure after.
  assert.deepEqual(dog.onEntry(fail, t0 + 180_000), []);
  // A rule call is not a recovery; a model call is.
  assert.deepEqual(dog.onEntry(entry("calls.made", { by: "rules" }), t0 + 200_000), []);
  assert.match(dog.onEntry(entry("calls.made", { by: "model" }), t0 + 40 * 60_000)[0]!, /model is answering again, after 38 min\./);
  // A playbook kept because nothing changed is not a failure.
  assert.deepEqual(dog.onEntry(entry("playbook.kept", { reason: "no new cases" }), t0), []);

  // The stream: silent for over five minutes, then back.
  assert.deepEqual(dog.onStream({ connected: true, lastEventAt: t0 - 60_000 }, t0), []);
  assert.match(dog.onStream({ connected: true, lastEventAt: t0 - 9 * 60_000 }, t0)[0]!, /silent: no event for 9 min/);
  assert.deepEqual(dog.onStream({ connected: false, lastEventAt: t0 - 20 * 60_000 }, t0 + 60_000), []);
  assert.match(dog.onStream({ connected: true, lastEventAt: t0 + 4 * 60_000 }, t0 + 4 * 60_000)[0]!, /flowing again/);
  assert.deepEqual(dog.onStream(null, t0), []);

  // A node: three misses in a row before anyone is woken.
  assert.deepEqual(dog.onNode("marsh.zoo", false, t0), []);
  assert.deepEqual(dog.onNode("marsh.zoo", false, t0), []);
  assert.match(dog.onNode("marsh.zoo", false, t0)[0]!, /marsh.zoo is not answering/);
  assert.match(dog.onNode("marsh.zoo", true, t0 + 10 * 60_000)[0]!, /marsh.zoo is back up/);

  // The brief: due 07:00, late after 07:20, and quiet once it is out.
  const day = "2026-10-16";
  assert.deepEqual(dog.onClock(Date.parse(`${day}T07:10:00Z`)), []);
  assert.match(dog.onClock(Date.parse(`${day}T07:25:00Z`))[0]!, /brief for 2026-10-16 is not out, 25 min after 07:00/);
  assert.deepEqual(dog.onClock(Date.parse(`${day}T07:27:00Z`)), []);
  const out = entry("artifact.published", { content: { night: day } }, "tortoise");
  assert.match(dog.onEntry(out, Date.parse(`${day}T07:30:00Z`))[0]!, /brief is out/);
  assert.deepEqual(dog.onClock(Date.parse(`${day + "T08:00:00Z"}`)), []);

  // Restarted after dawn: the brief already out is known from the index, no false alarm.
  const restarted = new Watchdog({ briefAt: "07:00" });
  restarted.seenBrief(day);
  assert.deepEqual(restarted.onClock(Date.parse(`${day}T07:36:00Z`)), []);
});

test("the brief counts the whole night, and flags tokens from chain facts when socials are unknown", async () => {
  const { buildSections } = await import("../src/agents/nightWatch.ts");
  const now = 1_792_300_000_000;
  const items = Array.from({ length: 25 }, (_, i) => ({
    ...obs({ mint: `M${String(i).padStart(43, "1")}`, symbol: `T${i}`, hasSocials: null, complete: i < 14, seenAt: now }),
    chain: { ageMin: 30, buys: 5, sells: 9, buyers: 4, solIn: 1, solOut: 1, curveSol: 0.1, creatorSold: 1, creatorLaunches24h: 12, graduated: false, top5Share: 1, repeatBuyers: 0, trades15m: 3, bundleWallets: 0, bundleShare: 0, poolSol: null, ammBuys: 0, ammSells: 0, ammSolIn: 0, ammSolOut: 0 },
  }));
  const s = buildSections("2026-10-17", items as never, now);
  assert.equal(s.graduated.length, 10);
  assert.deepEqual(s.counts, { graduated: 14, wentToZero: 25, suspicious: 25 });
  assert.equal(s.suspicious.length, 10);
  assert.match(s.suspicious[0]!.reasons.join(", "), /creator sold 100% of their bag, creator launched 12 tokens today/);
});

test("the koi hunts survivors among clean launches, picks few, and is graded on them the next night", async () => {
  const { koiCandidates, parseKoi, scoreKoi, KOI_PER_NIGHT, seeker } = await import("../src/agents/koi.ts");
  const launch = (mint: string, over: Record<string, unknown> = {}) => ({
    mint, symbol: mint.slice(0, 4), name: mint, ageMin: 60, buyers: 80, repeatBuyers: 12, top5Share: 0.3, creatorSold: 0, curveSol: 25, graduated: false, ...over,
  });
  const clean = [
    launch("Busy11111111111111111111111111111111111111", { buyers: 200, repeatBuyers: 40 }),
    launch("Quiet1111111111111111111111111111111111111", { buyers: 21, repeatBuyers: 3 }),
    launch("Young1111111111111111111111111111111111111", { ageMin: 12 }),
    launch("Thin11111111111111111111111111111111111111", { buyers: 19 }),
    launch("Flat11111111111111111111111111111111111111", { curveSol: 3 }),
    launch("Grad11111111111111111111111111111111111111", { curveSol: null, graduated: true }),
  ] as never[];
  const asked = koiCandidates(clean, new Set(["Grad11111111111111111111111111111111111111"]));
  assert.deepEqual(asked.map((c: { mint: string }) => c.mint.slice(0, 5)), ["Busy1", "Quiet"]);

  // Only mints it was shown, at most two a wake, reasons cleaned.
  const reply = '[{"mint":"Busy11111111111111111111111111111111111111","why":"200 buyers, 40 came back, creator holds"},{"mint":"Nope1111111111111111111111111111111111111","why":"x"},{"mint":"Quiet1111111111111111111111111111111111111","why":"steady"},{"mint":"Busy11111111111111111111111111111111111111","why":"dup"}]';
  const picks = parseKoi(reply, asked, 5);
  assert.deepEqual(picks.map((p: { mint: string }) => p.mint.slice(0, 5)), ["Busy1", "Quiet"]);
  assert.equal(parseKoi("[]", asked, 5).length, 0);
  assert.equal(parseKoi("no idea", asked, 5).length, 0);
  assert.ok(KOI_PER_NIGHT <= 8);

  const score = scoreKoi("2026-10-17", picks, { [picks[0]!.mint]: { symbol: "Busy", outcome: "alive" }, [picks[1]!.mint]: { symbol: "Quie", outcome: "dead" } });
  assert.deepEqual({ alive: score.alive, dead: score.dead, unknown: score.unknown }, { alive: 1, dead: 0 + 1, unknown: 0 });

  // A seeker reads and thinks; it cannot signal, fetch the open web or publish.
  assert.ok(seeker.capabilities.has("model:think") && seeker.capabilities.has("sources:read"));
  assert.ok(!seeker.capabilities.has("signal:send") && !seeker.capabilities.has("net:fetch") && !seeker.capabilities.has("artifact:publish"));
});

test("the koi's picks are re-checked first, next to the nursery's exam", async () => {
  const { followupMints } = await import("../src/agents/judgement.ts");
  const calls = Array.from({ length: 40 }, (_, i) => ({ mint: `C${i}`, symbol: "C", verdict: "suspicious", confidence: 0.6, why: "", by: "model", at: 0 })) as never;
  const picked = followupMints(calls, [], ["E1", "E2", "K1"], 10);
  assert.deepEqual(picked.slice(0, 3), ["E1", "E2", "K1"]);
  assert.equal(picked.length, 10);
});

test("holder keys: shown once, stored as a hash, replaced by a new one, and lifting limits only while the wallet holds", async () => {
  const { issueKey, walletOfKey, keyFrom, isKeyShaped, HoldingCache, HOLDING_TTL_MS } = await import("../src/chain/keys.ts");
  const { MemoryStore } = await import("@aiagentzoo/sdk");
  const store = new MemoryStore();
  const W = "So11111111111111111111111111111111111111112";
  const k1 = await issueKey(store, W);
  assert.ok(isKeyShaped(k1));
  assert.equal(await walletOfKey(store, k1), W);
  // The key itself is never stored.
  assert.ok(!(await store.keys()).some((k: string) => k.includes(k1.slice(3))));
  const k2 = await issueKey(store, W);
  assert.equal(await walletOfKey(store, k1), null);
  assert.equal(await walletOfKey(store, k2), W);
  assert.equal(await walletOfKey(store, "zk_nope"), null);

  assert.equal(keyFrom({ authorization: `Bearer ${k2}` }, new URLSearchParams()), k2);
  assert.equal(keyFrom({}, new URLSearchParams(`key=${k2}`)), k2);
  assert.equal(keyFrom({ authorization: "Bearer other" }, new URLSearchParams()), null);

  let balance = true;
  let reads = 0;
  const cache = new HoldingCache(async () => (reads++, balance));
  assert.equal(await cache.holds(W, 0), true);
  balance = false;
  assert.equal(await cache.holds(W, 1000), true);
  assert.equal(reads, 1);
  assert.equal(await cache.holds(W, HOLDING_TTL_MS + 1), false);
});

test("tape counts every buyer past the first 100 and keeps the count across a restart", async () => {
  const { PumpTape } = await import("../src/chain/pump.ts");
  const now = Date.now();
  const tape = new PumpTape();
  const mint = "Busy11111111111111111111111111111111111111";
  tape.apply({ kind: "create", name: "busy", symbol: "BUSY", mint, creator: "Dev1111111111111111111111111111111111111111", ts: now }, now);
  for (let i = 0; i < 250; i++) {
    const user = `Buyer${String(i).padStart(4, "0")}111111111111111111111111111111111`;
    tape.apply({ kind: "trade", mint, sol: 0.1, tokens: 1000, isBuy: true, user, ts: now, curveSol: 5 }, now);
    // A second buy from the same wallet is not a new buyer, hashed or not.
    if (i % 50 === 0) tape.apply({ kind: "trade", mint, sol: 0.1, tokens: 1000, isBuy: true, user, ts: now, curveSol: 5 }, now);
  }
  assert.equal(tape.facts(mint, now)!.buyers, 250);
  assert.equal(tape.facts(mint, now)!.buyersMore, undefined);
  const reborn = new PumpTape();
  reborn.load(tape.snapshot(), now);
  assert.equal(reborn.facts(mint, now)!.buyers, 250);
});

test("tape sees snipers still holding, wallets churning the volume, and bump bots", async () => {
  const { PumpTape } = await import("../src/chain/pump.ts");
  const t0 = Date.now() - 20 * 60_000;
  const tape = new PumpTape();
  const mint = "Snipe1111111111111111111111111111111111111";
  const dev = "Dev1111111111111111111111111111111111111111";
  const w = (n: string) => `${n}${"1".repeat(44 - n.length)}`;
  const trade = (user: string, isBuy: boolean, sol: number, tokens: number, at: number, tx?: string) =>
    tape.apply({ kind: "trade", mint, sol, tokens, isBuy, user, ts: at, curveSol: 10 }, at, tx);
  tape.apply({ kind: "create", name: "s", symbol: "S", mint, creator: dev, ts: t0 }, t0);
  trade(dev, true, 1, 30_000_000, t0);
  // Three snipers in the first seconds take 30% of the supply; one sells half of theirs later.
  trade(w("SnipA"), true, 2, 100_000_000, t0 + 1_000);
  trade(w("SnipB"), true, 2, 100_000_000, t0 + 2_000);
  trade(w("SnipC"), true, 2, 100_000_000, t0 + 4_000);
  trade(w("SnipC"), false, 1, 50_000_000, t0 + 60_000);
  // A late buyer is not early.
  trade(w("Late"), true, 1, 20_000_000, t0 + 30_000);
  // A churner buys and sells back three times.
  for (let i = 0; i < 3; i++) {
    trade(w("Churn"), true, 1, 10_000_000, t0 + 90_000 + i * 1000);
    trade(w("Churn"), false, 1, 10_000_000, t0 + 90_500 + i * 1000);
  }
  // A bump bot buys and sells in one transaction, twice.
  trade(w("Bump"), true, 0.01, 1000, t0 + 100_000, "tx1");
  trade(w("Bump"), false, 0.01, 1000, t0 + 100_000, "tx1");
  trade(w("Bump"), true, 0.01, 1000, t0 + 110_000, "tx2");
  trade(w("Bump"), false, 0.01, 1000, t0 + 110_000, "tx2");
  // Six minutes in, a trade writes down the five-minute numbers.
  trade(w("Late"), true, 0.5, 1_000_000, t0 + 6 * 60_000);
  const f = tape.facts(mint)!;
  assert.equal(f.earlyWallets, 3);
  assert.equal(f.earlyShare, 0.3);
  assert.equal(f.earlyHeld, 0.25);
  assert.equal(f.bumps, 2);
  // The churner's 6 SOL and the bump bot's 0.04 of 15.54 SOL traded both ways.
  assert.equal(f.washShare, 0.389);
  const reborn = new PumpTape();
  reborn.load(tape.snapshot());
  assert.equal(reborn.facts(mint)!.earlyHeld, 0.25);
});

test("a Mayhem Mode launch is read from the create event and its shares are of two billion", async () => {
  const { parsePumpLogs, PumpTape, fromBase58 } = await import("../src/chain/pump.ts");
  // The same real CreateV2 event as above, with is_mayhem_mode (the byte two before the quote mint) switched on.
  const raw = Buffer.from(
    "G3KpTd7rY3YEAAAATWV0YQQAAABNRVRBUAAAAGh0dHBzOi8vaXBmcy5pby9pcGZzL2JhZmtyZWllNTZidjRqMnBxZWh5c2RnbnAzZ2podW5ueDNqb2dlYXR5YW5rNzdqdHJ4cHY2eG1sd3d1QWxz18ddr7sq/rsjufRrIG4CLndr7j7MzZJFIX4pr1J9HnyOhQVUy0f/k4+Vsl7znVnVVk/QM2AY/chxCvLvNavK85lK16L4NnmZGte9MB+mlla1dsuwqdB7XMw4/pNeq8rzmUrXovg2eZka170wH6aWVrV2y7Cp0HtczDj+k17cJNFqAAAAAAAQ2EfjzwMAQDKin1YAAAAAeMX7UdECAACAxqR+jQMABt324e51j94YQl285GzN2rYa/E2DuQ0n/r35KNihi/wAAAVbQewvE0/oSDZZk1EOc+yvWUFcu1gGKlY2RWejfTXPQDKin1YAAAAsAQAAAAAAAAAA",
    "base64",
  );
  const at = raw.indexOf(Buffer.from(fromBase58("MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump")));
  assert.ok(at > 0);
  assert.equal(raw[at - 2], 0);
  const [plain] = parsePumpLogs([`Program data: ${raw.toString("base64")}`]) as any[];
  assert.equal(plain.mayhem, undefined);
  raw[at - 2] = 1;
  const [ev] = parsePumpLogs([`Program data: ${raw.toString("base64")}`]) as any[];
  assert.equal(ev.mayhem, true);
  const tape = new PumpTape();
  const now = 1_792_091_400_000;
  tape.apply(ev, now);
  for (const n of ["A", "B", "C"]) tape.apply({ kind: "trade", mint: ev.mint, sol: 1, tokens: 200_000_000, isBuy: true, user: `${n}${"1".repeat(43)}`, ts: ev.ts ?? now, curveSol: 3 }, now);
  const f = tape.facts(ev.mint, now)!;
  assert.equal(f.mayhem, true);
  assert.equal(f.earlyHeld, 0.3);
});

test("first-second wallets that keep sniping one creator are the creator's crew; bots that snipe everything are not", async () => {
  const { PumpTape } = await import("../src/chain/pump.ts");
  const { checkToken } = await import("../src/chain/check.ts");
  const tape = new PumpTape();
  const t0 = Date.now() - 60 * 60_000;
  const dev = `Dev${"1".repeat(41)}`;
  const w = (n: string) => `${n}${"1".repeat(44 - n.length)}`;
  const crew = [w("CrewA"), w("CrewB"), w("CrewC")];
  const bot = w("Bot");
  let i = 0;
  const launch = (creator: string, buyers: string[]) => {
    const mint = `M${i}z`.padEnd(44, "z");
    const at = t0 + i * 60_000;
    i += 1;
    tape.apply({ kind: "create", name: "x", symbol: `X${i}`, mint, creator, ts: at }, at);
    for (const b of buyers) tape.apply({ kind: "trade", mint, sol: 0.5, tokens: 10_000_000, isBuy: true, user: b, ts: at + 1_000, curveSol: 2 }, at);
    return mint;
  };
  // The bot snipes twenty strangers' launches, and the dev's too.
  for (let k = 0; k < 20; k++) launch(w(`Other${k}`), [bot]);
  for (let k = 0; k < 3; k++) launch(dev, [...crew, bot]);
  const last = launch(dev, [...crew, bot]);
  const f = tape.facts(last)!;
  assert.equal(f.creatorCrew, 3);
  assert.equal(f.ringWallets, 3);
  assert.equal(f.serialSnipers, 1);
  const check = checkToken(last, { symbol: "X", facts: f, creatorRecord: tape.creator(dev) });
  assert.equal(check.verdict, "avoid");
  assert.match(check.reasons.join(" "), /creator's own wallets/);
  // A stranger's launch sniped only by the bot has no crew and no ring.
  const g = tape.facts(launch(w("Fresh"), [bot]))!;
  assert.equal(g.creatorCrew, 0);
  assert.equal(g.ringWallets, 0);
  assert.equal(tape.sniper(bot)!.snipes48h, 25);
  // Rebuilt after a restart.
  const reborn = new PumpTape();
  reborn.load(tape.snapshot());
  assert.equal(reborn.facts(last)!.creatorCrew, 3);
});

test("a creator funded by the wallet that funded a row of ruggers is called out; an exchange funding everyone is not", async () => {
  const { PumpTape } = await import("../src/chain/pump.ts");
  const { Lineage } = await import("../src/chain/lineage.ts");
  const { checkToken } = await import("../src/chain/check.ts");
  const tape = new PumpTape();
  const t0 = Date.now() - 3 * 3_600_000;
  const pad = (n: string) => n.padEnd(44, "z");
  let i = 0;
  const launch = (creator: string, dump: boolean) => {
    const mint = pad(`L${i++}x`);
    const at = t0 + i * 60_000;
    tape.apply({ kind: "create", name: "x", symbol: "X", mint, creator, ts: at }, at);
    tape.apply({ kind: "trade", mint, sol: 1, tokens: 1e7, isBuy: true, user: creator, ts: at, curveSol: 1 }, at);
    if (dump) tape.apply({ kind: "trade", mint, sol: 1, tokens: 1e7, isBuy: false, user: creator, ts: at + 30_000, curveSol: 0.1 }, at);
    return mint;
  };
  const boss = pad("Boss");
  const exchange = pad("Exchange");
  const fundedBy: Record<string, string> = {};
  for (const r of ["RugA", "RugB"]) {
    fundedBy[pad(r)] = boss;
    for (let k = 0; k < 3; k++) launch(pad(r), true);
  }
  const fresh = pad("Fresh");
  fundedBy[fresh] = boss;
  const mint = launch(fresh, false);
  // Two strangers who withdrew from the same exchange.
  fundedBy[pad("StrangerA")] = exchange;
  fundedBy[pad("StrangerB")] = exchange;
  for (let k = 0; k < 3; k++) launch(pad("StrangerA"), true);
  const other = launch(pad("StrangerB"), false);
  // A fake RPC: each wallet's one signature is the transfer that funded it; the exchange has a thousand a day.
  const fetchFn = (async (_url: string, init: { body: string }) => {
    const { method, params } = JSON.parse(init.body);
    const now = Math.floor(Date.now() / 1000);
    if (method === "getSignaturesForAddress") {
      const w = params[0] as string;
      if (w === exchange) return Response.json({ result: Array.from({ length: 1000 }, () => ({ signature: "s", blockTime: now - 60 })) });
      if (w === boss) return Response.json({ result: [{ signature: "b", blockTime: now - 60 }] });
      return Response.json({ result: [{ signature: `sig:${w}`, blockTime: now - 600 }] });
    }
    if (method === "getTransaction") {
      const w = String(params[0]).slice(4);
      const source = fundedBy[w];
      return Response.json({ result: { transaction: { message: { instructions: [{ program: "system", parsed: { type: "transfer", info: { source, destination: w, lamports: 1e9 } } }] } } } });
    }
    return Response.json({ result: null });
  }) as unknown as typeof fetch;
  const lin = new Lineage(tape, fetchFn);
  for (const w of Object.keys(fundedBy)) await lin.trace(w);
  const v = lin.view(fresh)!;
  assert.equal(v.funder, boss);
  assert.equal(v.funderIsHot, false);
  assert.equal(v.siblings.length, 2);
  assert.equal(v.siblingDumped48h, 6);
  const c = checkToken(mint, { symbol: "X", facts: tape.facts(mint)!, creatorRecord: tape.creator(fresh) }, { lineage: v });
  assert.equal(c.verdict, "avoid");
  assert.match(c.reasons[0]!, /funded 2 other launchers; they dumped 6 of their 6 launches/);
  const s = lin.view(pad("StrangerB"))!;
  assert.equal(s.funderIsHot, true);
  assert.equal(s.siblings.length, 0);
  assert.notEqual(checkToken(other, { symbol: "X", facts: tape.facts(other)!, creatorRecord: tape.creator(pad("StrangerB")) }, { lineage: s }).verdict, "avoid");
  // Kept across a restart.
  const again = new Lineage(tape, fetchFn);
  again.load(lin.snapshot());
  assert.equal(again.view(fresh)!.siblings.length, 2);
});

test("the bot's x-ray reads the same in English and Chinese, every reason translated", async () => {
  const { xrayMessage } = await import("../src/telegram.ts");
  const { inLang } = await import("../src/tg-i18n.ts");
  const x = {
    mint: "M",
    symbol: "LOB",
    check: {
      verdict: "avoid" as const,
      reasons: ["3 of the wallets in the first 5 seconds keep sniping this creator's other launches: they are the creator's own wallets", "at least 41% of the trading is wallets selling back what they just bought: volume, not holders"],
      notes: ["who funded the creator is not traced yet: it is queued"],
      facts: { ageMin: 20, earlyWallets: 8, earlyHeldPct: 23, churnPct: 41, bumps: 12, creatorCrew: 3, ringWallets: 2, serialSnipers: 3 },
    },
    early: [{ bought: 0.2 }, { bought: 0.12 }],
    funding: { funder: "Boss1111111111111111111111111111111111111111", funderIsHot: false, siblings: [1, 2, 3, 4], siblingLaunches48h: 19, siblingDumped48h: 17 },
  };
  const en = inLang("en", () => xrayMessage(x));
  assert.match(en, /🔴 <b>\$LOB<\/b> · <b>AVOID<\/b>/);
  assert.match(en, /8 wallets took 32%, still hold 23%/);
  assert.match(en, /funded 4 other creators, 17 dumps in 48h/);
  const zh = inLang("zh", () => xrayMessage(x));
  assert.match(zh, /远离/);
  assert.match(zh, /它们就是开发者自己的小号/);
  assert.match(zh, /刷量/);
  assert.match(zh, /已排队/);
  assert.doesNotMatch(zh, /wallets|creator/);
});

test("a sibling node on the private network gets the holder allowance for the check; the internet does not", async () => {
  const { tape } = await import("../src/chain/pump.ts");
  const enclosure = new Enclosure({ node: { id: "north.zoo", identity: Identity.generate(), operator: "op" }, keeper: "keeper", tools: [], agents: [] });
  const server = createNodeServer({ enclosure });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const mint = "Peer".padEnd(44, "z");
  tape.apply({ kind: "create", name: "p", symbol: "P", mint, creator: "Dev".padEnd(44, "z"), ts: Date.now() });
  try {
    const peer = (await (await fetch(`${base}/v1/check/${mint}`)).json()) as { access: { tier: string }; verdict: string };
    assert.equal(peer.access.tier, "holder");
    const outside = (await (await fetch(`${base}/v1/check/${mint}`, { headers: { "x-forwarded-for": "203.0.113.9" } })).json()) as { access: { tier: string } };
    assert.equal(outside.access.tier, "free");
    const xray = (await (await fetch(`${base}/v1/xray/${mint}`)).json()) as { symbol: string; early: unknown[]; check: { verdict: string } };
    assert.equal(xray.symbol, "P");
    assert.deepEqual(xray.early, []);
  } finally {
    server.close();
  }
});

test("a sniper who sells in the PumpSwap pool after graduation no longer counts as holding", async () => {
  const { PumpTape } = await import("../src/chain/pump.ts");
  const tape = new PumpTape();
  const t0 = Date.now() - 60 * 60_000;
  const mint = "Grad".padEnd(44, "z");
  const sniper = "Snipe".padEnd(44, "z");
  const pool = "Pool".padEnd(44, "z");
  tape.apply({ kind: "create", name: "g", symbol: "G", mint, creator: "Dev".padEnd(44, "z"), ts: t0 }, t0);
  for (const u of [sniper, "Other".padEnd(44, "z")]) tape.apply({ kind: "trade", mint, sol: 3, tokens: 150_000_000, isBuy: true, user: u, ts: t0 + 1_000, curveSol: 6 }, t0);
  assert.equal(tape.facts(mint)!.earlyHeld, 0.3);
  tape.apply({ kind: "pool", mint, pool }, t0 + 30 * 60_000);
  tape.apply({ kind: "swap", pool, isBuy: false, sol: 9, tokens: 150_000_000, user: sniper, ts: t0 + 31 * 60_000, poolSol: 80 }, t0 + 31 * 60_000);
  assert.equal(tape.facts(mint)!.earlyHeld, 0.15);
  assert.ok(tape.earlyOf(mint)!.find((e) => e.wallet === sniper)!.exitSec! > 0);
});

test("LaunchLab and Meteora's curve are read from real mainnet transactions: the trader, the token, what moved", async () => {
  const { readFileSync } = await import("node:fs");
  const { fromRpc, parseLaunchpads } = await import("../src/chain/launchpads.ts");
  const { fromBase58, PumpTape } = await import("../src/chain/pump.ts");
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/launchpads.json", import.meta.url), "utf8")) as Array<{ what: string; tx: any }>;
  const parse = (what: string, ts = 0) => parseLaunchpads(fromRpc(fixtures.find((f) => f.what === what)!.tx, fromBase58), ts) as any[];

  // LaunchLab, a token with a 1% transfer fee: the seller paid 3,013,119 from their account, the curve got 1% less.
  const [sell] = parse("ll:sell");
  assert.equal(sell.kind, "trade");
  assert.equal(sell.isBuy, false);
  assert.equal(sell.user, "CogH8XVFdLBkYpdJH8CHoJKrBZxwuU95LFvQCeWYbm6N");
  assert.equal(sell.mint, "F69v8Ah1uTejFJwUDzZFoJkkH3J1QmDeEyJzvaTK2KLV");
  assert.ok(Math.abs(sell.tokens - 3_013_119.18) < 0.01);
  // Paired with a token other than SOL: no curve in SOL.
  assert.equal(sell.curveSol, null);
  const [buy] = parse("ll:buy");
  assert.equal(buy.isBuy, true);
  assert.equal(buy.user, "9mNmRTg3BLRtXrsM3pxAvqEFU5uh9ZtrVU6jDAf6gfhs");
  assert.ok(Math.abs(buy.tokens - 9_506_726.22) < 0.01);

  // Meteora: the launch, then the first buy, routed through a temporary account closed in the same transaction.
  const [create] = parse("dbc:create", 1_000);
  assert.deepEqual(create, { kind: "create", venue: "dbc", name: "VAK", symbol: "VAK", mint: "3UNs3RobwhxDqRcYAgNV5fKKdCf4sJPCfeh3CSDBRYbt", creator: "GDEUpEgzz3w6uff4pLAHjt94QdaWnn5jWaehU2G7yruo", ts: 1_000, supply: 1_000_000_000 });
  const [first] = parse("dbc:buy", 3_000);
  assert.equal(first.user, "8TPACXaKotSZ7WXktfmKDRhgoypyGXNzo1ctr2YBzxLc");
  assert.equal(first.sol, 0.5);
  assert.ok(Math.abs(first.curveSol - 0.5213) < 0.001);

  // On the tape: an x-ray like any pump.fun launch, but kept out of the judges' pump.fun-only night and record.
  const tape = new PumpTape();
  const now = Date.now();
  tape.apply({ ...(create as any), ts: now - 60_000 }, now);
  tape.apply({ ...first, ts: now - 58_000 }, now);
  const f = tape.facts(create.mint, now)!;
  assert.equal(f.venue, "dbc");
  assert.equal(f.buyers, 1);
  assert.equal(f.earlyWallets, 1);
  assert.equal(f.curveSol, null);
  assert.equal(tape.launches(10, now).length, 0);
  assert.equal(tape.token(create.mint, now)!.creator, "GDEUpEgzz3w6uff4pLAHjt94QdaWnn5jWaehU2G7yruo");
});

test("the stream's own transaction format reads the same as the RPC's", async () => {
  const { readFileSync } = await import("node:fs");
  const { fromRpc, fromYellowstone, parseLaunchpads } = await import("../src/chain/launchpads.ts");
  const { fromBase58 } = await import("../src/chain/pump.ts");
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/launchpads.json", import.meta.url), "utf8")) as Array<{ what: string; tx: any }>;
  for (const { what, tx } of fixtures) {
    // The same transaction as Yellowstone sends it: keys and data as bytes, address-table keys apart.
    const ix = (i: any) => ({ programIdIndex: i.programIdIndex, accounts: Uint8Array.from(i.accounts), data: new Uint8Array(fromBase58(i.data)) });
    const bal = (b: any) => ({ accountIndex: b.accountIndex, mint: b.mint, owner: b.owner, uiTokenAmount: { decimals: b.uiTokenAmount.decimals, uiAmount: b.uiTokenAmount.uiAmount ?? 0 } });
    const ys = {
      transaction: { message: { accountKeys: tx.transaction.message.accountKeys.map((k: string) => new Uint8Array(fromBase58(k))), instructions: tx.transaction.message.instructions.map(ix) } },
      meta: {
        innerInstructions: (tx.meta.innerInstructions ?? []).map((g: any) => ({ index: g.index, instructions: g.instructions.map(ix) })),
        loadedWritableAddresses: (tx.meta.loadedAddresses?.writable ?? []).map((k: string) => new Uint8Array(fromBase58(k))),
        loadedReadonlyAddresses: (tx.meta.loadedAddresses?.readonly ?? []).map((k: string) => new Uint8Array(fromBase58(k))),
        preTokenBalances: (tx.meta.preTokenBalances ?? []).map(bal),
        postTokenBalances: (tx.meta.postTokenBalances ?? []).map(bal),
      },
    };
    assert.deepEqual(parseLaunchpads(fromYellowstone(ys)!, 5), parseLaunchpads(fromRpc(tx, fromBase58), 5), what);
  }
});

test("a wallet is a point on the curve; a launchpad's authority, owning its vault, is not", async () => {
  const { isOnCurve } = await import("../src/chain/curve.ts");
  const { fromBase58 } = await import("../src/chain/pump.ts");
  // Meteora's and LaunchLab's pool authorities, from the mainnet fixtures: they own the curves' vaults.
  assert.equal(isOnCurve(fromBase58("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM")), false);
  assert.equal(isOnCurve(fromBase58("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh")), false);
  // Traders' wallets.
  assert.equal(isOnCurve(fromBase58("CogH8XVFdLBkYpdJH8CHoJKrBZxwuU95LFvQCeWYbm6N")), true);
  assert.equal(isOnCurve(fromBase58("8TPACXaKotSZ7WXktfmKDRhgoypyGXNzo1ctr2YBzxLc")), true);
});

test("the record's five-minute reading is taken between 5 and 10 minutes in, never from a late first trade", async () => {
  const { PumpTape } = await import("../src/chain/pump.ts");
  const now = Date.now();
  const day = 30 * 3_600_000;
  const tape = new PumpTape();
  const w = (n: string) => n.padEnd(44, "z");
  const launch = (mint: string, laterTradeMin: number) => {
    const t0 = now - day;
    tape.apply({ kind: "create", name: "x", symbol: "X", mint, creator: w(`Dev${mint}`), ts: t0 }, t0);
    for (const s of ["SnipeA", "SnipeB"]) tape.apply({ kind: "trade", mint, sol: 1, tokens: 150_000_000, isBuy: true, user: w(s), ts: t0 + 1_000, curveSol: 1 }, t0);
    tape.apply({ kind: "trade", mint, sol: 0.1, tokens: 1_000, isBuy: true, user: w("Late"), ts: t0 + laterTradeMin * 60_000, curveSol: 1 }, t0);
  };
  launch(w("OnTime"), 6);
  launch(w("Stale"), 600);
  const r = tape.checkRecord(now);
  assert.equal(r.signals.stillTrading.n, 1, "only the token traded 6 minutes in has a reading");
  assert.equal(r.signals.insidersHold25.n, 1);
});

test("a guest's contact is a link people can open, to X, Telegram or GitHub only", async () => {
  const { contactUrl } = await import("../src/guests.ts");
  assert.equal(contactUrl("@sniff_dev"), "https://x.com/sniff_dev");
  assert.equal(contactUrl("twitter.com/sniff_dev"), "https://x.com/sniff_dev");
  assert.equal(contactUrl("https://t.me/sniffbot"), "https://t.me/sniffbot");
  assert.equal(contactUrl("github.com/sniff-labs/"), "https://github.com/sniff-labs");
  assert.equal(contactUrl("https://evil.example/claim"), false);
  assert.equal(contactUrl("x.com/a/status/1"), false);
  assert.equal(contactUrl("javascript:alert(1)"), false);
});

test("an X account reused across launches whose devs sold within minutes is named in the check, a famous tweet is not", async () => {
  const { socialsOf, SocialsRegistry } = await import("../src/chain/socials.ts");
  const { PumpTape } = await import("../src/chain/pump.ts");
  const { checkToken } = await import("../src/chain/check.ts");
  assert.deepEqual(socialsOf({ twitter: "https://x.com/elonmusk/status/2111734982611751330" }), [], "someone's tweet is not the token's account");
  assert.equal(socialsOf({ twitter: "https://twitter.com/RugCrew_" })[0]!.key, "x:@rugcrew_");
  assert.equal(socialsOf({ twitter: "https://x.com/i/communities/1912345678901234567" })[0]!.kind, "x-community");
  assert.equal(socialsOf({ telegram: "https://t.me/rugcrewchat" })[0]!.key, "telegram:rugcrewchat");
  assert.deepEqual(socialsOf({ twitter: "javascript:alert(1)", telegram: "https://evil.example/t" }), []);

  const tape = new PumpTape();
  const now = Date.now();
  const pad = (s: string) => s.padEnd(44, "z");
  const meta = (handle: string) => ({ twitter: `https://x.com/${handle}` });
  // One X account on four launches by four fresh wallets; three of them sold everything in the first minute.
  const reg = new SocialsRegistry(tape, (async (url: string) => Response.json(meta(String(url).includes("Clean") ? "honestdev" : "RugCrew_"))) as unknown as typeof fetch);
  for (let i = 0; i < 4; i++) {
    const mint = pad(`Rug${i}x`);
    const dev = pad(`Dev${i}x`);
    const at = now - (60 - i) * 60_000;
    tape.apply({ kind: "create", name: "r", symbol: `R${i}`, mint, creator: dev, ts: at, uri: `https://ipfs.io/ipfs/Qm${"a".repeat(44)}${i}` }, at);
    tape.apply({ kind: "trade", mint, sol: 1, tokens: 1e7, isBuy: true, user: dev, ts: at, curveSol: 1 }, at);
    if (i < 3) tape.apply({ kind: "trade", mint, sol: 1, tokens: 1e7, isBuy: false, user: dev, ts: at + 40_000, curveSol: 0.1 }, at);
    await reg.read(mint, `https://ipfs.io/ipfs/Qm${"a".repeat(44)}${i}`);
  }
  const fresh = pad("Rug3x");
  const [linked] = reg.forMint(fresh);
  assert.equal(linked!.social.label, "@RugCrew_");
  assert.equal(linked!.launches, 3, "the other launches, not this one");
  assert.equal(linked!.fastDumps, 3);
  const c = checkToken(fresh, { symbol: "R3", facts: tape.facts(fresh)!, creatorRecord: tape.creator(pad("Dev3x")) }, { socials: reg.forMint(fresh) });
  assert.equal(c.verdict, "avoid");
  assert.match(c.reasons.join(" "), /X account this token links to \(@RugCrew_\) is also on 3 other launches from the last 48 hours; their dev sold within 5 minutes on 3/);
  assert.equal(reg.reused()[0]!.fastDumps, 3);
  // Refused by every gateway: the reader is told to back off.
  const shut = new SocialsRegistry(tape, (async () => new Response("no", { status: 403 })) as unknown as typeof fetch);
  assert.equal(await shut.read(fresh, `https://ipfs.io/ipfs/Qm${"b".repeat(44)}`), false);
  const gone = new SocialsRegistry(tape, (async () => new Response("no", { status: 404 })) as unknown as typeof fetch);
  assert.equal(await gone.read(fresh, `https://ipfs.io/ipfs/Qm${"c".repeat(44)}`), true, "missing metadata is not a refusal");
});
