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
