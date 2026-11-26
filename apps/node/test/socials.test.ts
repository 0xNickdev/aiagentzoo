import assert from "node:assert/strict";
import { test } from "node:test";
import { SocialsRegistry, socialsOf } from "../src/chain/socials.ts";
import { PumpTape } from "../src/chain/pump.ts";
import { type OddsInputs, oddsOf } from "../src/chain/odds.ts";

const pad = (s: string) => s.padEnd(44, "s");
const URI = `https://ipfs.io/ipfs/Qm${"d".repeat(44)}`;
const BASE: Omit<OddsInputs, "social"> = { still5: true, dumped5: false, devSold5: false, priorLaunches: 0, priorDumped: 0, priorGraduated: 0, launchShare: 0.05, devShare: 0.03, buyers1m: 8, buyers5: 30, insiders: false, wash: 0, crew2: false, ring3: false, mayhem: false, funderExchange: false, funderMany: false };

test("odds flicker: the social input stays as first read, through gateway misses and the check's account filters", async () => {
  const tape = new PumpTape();
  const now = Date.now();
  const mint = pad("Flick");
  // A coin linking a famous account: the check leaves the account out, the odds still count the link.
  tape.apply({ kind: "create", name: "Doge Father", symbol: "DOGEF", mint, creator: pad("Dev"), ts: now - 60_000, uri: URI }, now - 60_000);
  let up = true;
  const reg = new SocialsRegistry(tape, (async () => {
    if (!up) throw new Error("gateway timeout");
    return Response.json({ twitter: "https://x.com/elonmusk" });
  }) as unknown as typeof fetch);
  assert.equal(await reg.read(mint, URI), true);
  const reads: number[] = [];
  const ask = () => reads.push(oddsOf({ ...BASE, social: reg.linksSocial(mint) }, "5min").run);
  ask();
  // Every gateway times out on a re-read (the feed re-reads coins without a picture every minute).
  up = false;
  await reg.read(mint, URI);
  ask();
  // An empty record from elsewhere does not take the link away either.
  reg.add(mint, socialsOf({}));
  ask();
  assert.equal(new Set(reads).size, 1, `odds moved between reads: ${reads.join(", ")}`);
  assert.equal(reg.linksSocial(mint), true);
  // The old input (filtered account records) said no link at all for this coin: the jump the odds showed.
  assert.deepEqual(reg.forMint(mint), []);
  assert.notEqual(oddsOf({ ...BASE, social: false }, "5min").run, reads[0]);
  // A coin never read, or read with nothing linked, stays without.
  assert.equal(reg.linksSocial(pad("Never")), false);
});

test("socials memory: account -> launches kept 90 days on disk, read back after the tape forgets, dumps written, older pruned", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { checkToken } = await import("../src/chain/check.ts");
  const db = new DatabaseSync(":memory:");
  const now = Date.now();
  const day = 24 * 3_600_000;
  const tape = new PumpTape();
  const reg = new SocialsRegistry(tape);
  reg.attach(db);
  // Three launches by three devs on @OldCrew; their metadata is read at launch, before anyone sold.
  for (let i = 0; i < 3; i++) {
    const mint = pad(`Old${i}`);
    const dev = pad(`OldDev${Math.min(i, 1)}`);
    const at = now - 30 * 60_000 + i * 60_000;
    tape.apply({ kind: "create", name: "o", symbol: `O${i}`, mint, creator: dev, ts: at }, at);
    tape.apply({ kind: "trade", mint, sol: 1, tokens: 1e7, isBuy: true, user: dev, ts: at, curveSol: 1 }, at);
    reg.add(mint, socialsOf({ twitter: "https://x.com/OldCrew" }));
    tape.apply({ kind: "trade", mint, sol: 1, tokens: 1e7, isBuy: false, user: dev, ts: at + 60_000, curveSol: 0.1 }, at + 60_000);
  }
  // The hourly prune writes the dumps seen since.
  reg.prune(now);
  const rows = db.prepare("SELECT mint, dumped_after_min FROM social_links WHERE account = 'x:@oldcrew' ORDER BY mint").all() as Array<{ dumped_after_min: number | null }>;
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.dumped_after_min === 1));
  // A restart weeks later: a fresh tape knows none of them, the disk still does.
  const later = new PumpTape();
  const reg2 = new SocialsRegistry(later);
  reg2.attach(db);
  const fresh = pad("NewOne");
  later.apply({ kind: "create", name: "n", symbol: "NEW", mint: fresh, creator: pad("NewDev"), ts: now }, now);
  later.apply({ kind: "trade", mint: fresh, sol: 1, tokens: 1e7, isBuy: true, user: pad("NewDev"), ts: now, curveSol: 1 }, now);
  reg2.add(fresh, socialsOf({ twitter: "https://x.com/OldCrew" }));
  const [rec] = reg2.forMint(fresh);
  assert.equal(rec!.launches, 3);
  assert.equal(rec!.fastDumps, 3);
  assert.equal(rec!.windowDays, 90);
  const c = checkToken(fresh, { symbol: "NEW", facts: later.facts(fresh)!, creatorRecord: later.creator(pad("NewDev")) }, { socials: reg2.forMint(fresh) });
  assert.match(c.reasons.join(" "), /\(@OldCrew\) is also on 3 other launches from the last 90 days; their dev sold within 5 minutes on 3/);
  // An old coin no longer in memory still answers what it linked.
  assert.equal(reg2.forMint(pad("Old0"))[0]!.social.label, "@OldCrew");
  // Past 90 days, gone.
  reg2.prune(now + 91 * day);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM social_links").get() as { n: number }).n, 0);
});

test("borrowed names: someone else's X account on launches by many devs is a note, not a reason; one that names the coin still counts", async () => {
  const { checkToken } = await import("../src/chain/check.ts");
  const tape = new PumpTape();
  const reg = new SocialsRegistry(tape);
  const now = Date.now();
  // @blknoiz06 in the metadata of 29 launches by 23 devs, most of them dumped in the first minute.
  const launch = (mint: string, dev: string, symbol: string, at: number, handle: string, dump: boolean) => {
    tape.apply({ kind: "create", name: symbol, symbol, mint, creator: dev, ts: at }, at);
    tape.apply({ kind: "trade", mint, sol: 1, tokens: 1e7, isBuy: true, user: dev, ts: at, curveSol: 1 }, at);
    if (dump) tape.apply({ kind: "trade", mint, sol: 1, tokens: 1e7, isBuy: false, user: dev, ts: at + 30_000, curveSol: 0.1 }, at + 30_000);
    reg.add(mint, socialsOf({ twitter: `https://x.com/${handle}` }));
  };
  for (let i = 0; i < 28; i++) launch(pad(`Blk${i}`), pad(`BDev${i % 23}`), `B${i}`, now - (90 - i) * 60_000, "blknoiz06", true);
  const mint = pad("BlkLast");
  launch(mint, pad("BDevLast"), "LAST", now - 60_000, "blknoiz06", false);
  const [rec] = reg.forMint(mint);
  assert.equal(rec!.borrowed, true);
  assert.equal(rec!.devs, 24);
  const c = checkToken(mint, { symbol: "LAST", facts: tape.facts(mint)!, creatorRecord: tape.creator(pad("BDevLast")) }, { socials: reg.forMint(mint) });
  assert.doesNotMatch(c.reasons.join(" "), /blknoiz06/);
  assert.ok(c.notes.includes("this X account (@blknoiz06) appears on 29 launches by 24 different devs; it is likely borrowed"), c.notes.join(" | "));
  // Few devs on the account: theirs, and it still counts against the coin.
  for (let i = 0; i < 3; i++) launch(pad(`Crew${i}`), pad(`CDev${i % 2}`), `C${i}`, now - (50 - i) * 60_000, "crewcalls", true);
  const crew = pad("CrewLast");
  launch(crew, pad("CDev2"), "CNEXT", now - 60_000, "crewcalls", false);
  const cc = checkToken(crew, { symbol: "CNEXT", facts: tape.facts(crew)!, creatorRecord: tape.creator(pad("CDev2")) }, { socials: reg.forMint(crew) });
  assert.match(cc.reasons.join(" "), /\(@crewcalls\) is also on 3 other launches/);
  // An account named after this coin ties back to it: counted however many devs used it before.
  for (let i = 0; i < 6; i++) launch(pad(`Moo${i}`), pad(`MDev${i}`), `X${i}`, now - (40 - i) * 60_000, "moonfrog", true);
  const own = pad("MooOwn");
  launch(own, pad("MDevOwn"), "FROG", now - 60_000, "moonfrog", false);
  const [ownRec] = reg.forMint(own);
  assert.equal(ownRec!.tiesBack, true);
  assert.equal(ownRec!.borrowed, false);
});
