import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { featuresOf, judge, type MarkRow, Radar } from "../src/chain/radar.ts";
import { organicOf } from "../src/chain/organic.ts";
import { BUYERS_KEEP_MS, ensureBuyers, pruneBuyers, writeBuyers } from "../src/chain/radar-buyers.ts";
import { QualityReader } from "../src/chain/wallet-quality.ts";

const rows = JSON.parse(readFileSync(new URL("./fixtures/radar-marks.json", import.meta.url), "utf8")) as Array<{ x: MarkRow; prior: { n: number; g: number }; early: number[] }>;
const pick = rows.find((r) => judge(featuresOf(r.x, { prior: r.prior.n, priorG: r.prior.g, early: r.early })).tier)!;
const H = 3_600_000;
const M = 60_000;
const solFor = (cap: number) => Math.sqrt(cap * 32.19) - 30;

function memory() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tokens (id INTEGER PRIMARY KEY, mint TEXT, symbol TEXT, creator_id INTEGER, created_at INTEGER, graduated_at INTEGER, cap_peak REAL, cap_peak_at INTEGER);
    CREATE TABLE wallet_tokens (wallet_id INTEGER, token_id INTEGER, role INTEGER, took INTEGER, at INTEGER);`);
  const ins = db.prepare("INSERT INTO tokens (mint, symbol, creator_id, created_at, graduated_at) VALUES (?, ?, 7, ?, ?)");
  for (let i = 0; i < pick.prior.n; i++) ins.run(`old${i}`, "O", pick.x.createdAt - 1000 - i, i < pick.prior.g ? pick.x.createdAt - 500 : null);
  const id = Number(ins.run(pick.x.mint, "RUN", pick.x.createdAt, null).lastInsertRowid);
  for (const w of pick.early) db.prepare("INSERT INTO wallet_tokens VALUES (?, ?, 1, 0, 0)").run(w, id);
  return db;
}

test("organic label: big tickets, money flowing in and holders staying read organic", () => {
  const o = organicOf({ buyers: 41, buys: 60, sells: 30, solIn: 37, solOut: 5, creatorFeesSol: 4, held30: { held: 26, of: 30 }, wallets: { of: 30, fresh: 2, seasoned: 20 } })!;
  assert.equal(o.tag, "organic");
  assert.equal(o.lines.length, 3);
  assert.match(o.lines[0]!, /^41 buyers at 0.9 SOL each on average$|seasoned|still hold|flowing/);
  assert.ok(o.lines.some((l) => /still flowing in|still hold|seasoned/.test(l)));
});

test("organic label: many tiny buyers, sells catching up and fresh wallets read pumped", () => {
  const o = organicOf({ buyers: 300, buys: 400, sells: 390, solIn: 15, solOut: 14.5, buys5: 200, sells5: 120, held30: { held: 0, of: 30 }, wallets: { of: 30, fresh: 18, seasoned: 1 } })!;
  assert.equal(o.tag, "pumped");
  assert.ok(o.lines.includes("300 buyers at 0.05 SOL each, looks botted"));
  assert.ok(o.lines.includes("sells caught up with buys after minute 5") || o.lines.includes("none of the first 30 buyers still hold"));
  assert.equal(organicOf({ buyers: 0, buys: 0, sells: 0, solIn: 0 }), null);
});

test("organic label: a middling coin is mixed", () => {
  const o = organicOf({ buyers: 100, buys: 150, sells: 120, solIn: 70 })!;
  assert.equal(o.tag, "mixed");
  assert.ok(o.lines.length >= 1);
});

test("the slim buyer record writes one coin in one transaction and prunes past 14 days", () => {
  const db = new DatabaseSync(":memory:");
  ensureBuyers(db);
  const now = Date.now();
  writeBuyers(db, "OLD", now - BUYERS_KEEP_MS - 1, [{ wallet: "a", afterMs: 1, sol: 1, tok: 10, holding: true }]);
  assert.equal(writeBuyers(db, "NEW", now, Array.from({ length: 120 }, (_, i) => ({ wallet: `w${i}`, afterMs: i, sol: 0.5, tok: 100, holding: i % 2 === 0 }))), 100);
  assert.equal(pruneBuyers(db, now), 1);
  assert.equal((db.prepare("select count(*) n from radar_buyers where mint='NEW'").get() as { n: number }).n, 100);
});

test("wallet quality from history: fresh, seasoned and unseen", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE wallets (wallet TEXT, first_seen INTEGER); CREATE TABLE wallet_pnl (wallet TEXT, mint TEXT, sol_in REAL, sol_out REAL, first_ts INTEGER, last_ts INTEGER);`);
  const at = 100 * 86_400_000;
  db.prepare("insert into wallets values ('vet', ?)").run(at - 30 * 86_400_000);
  db.prepare("insert into wallets values ('kid', ?)").run(at - 3_600_000);
  const p = db.prepare("insert into wallet_pnl values ('vet', ?, 1, 2, ?, ?)");
  for (let i = 0; i < 60; i++) p.run(`m${i}`, at - 1000 - i, at);
  const q = new QualityReader(db).read([{ wallet: "vet", at }, { wallet: "kid", at }, { wallet: "ghost", at }]);
  assert.equal(q.seasoned, 1);
  assert.equal(q.fresh, 2);
  assert.equal(q.unseen, 1);
  assert.equal(q.pnlUp, 1);
});

test("the radar labels at minute 20, keeps wallet quality, and writes the cap at +1/2/6/24 h once", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-organic-"));
  const file = join(dir, "radar.jsonl");
  const radar = new Radar(file, memory());
  const s = radar.consider(pick.x, { symbol: "RUN" }, pick.x.at)!;
  assert.ok(s && radar.has(pick.x.mint));
  radar.setQuality(pick.x.mint, { of: 30, fresh: 20, seasoned: 1, unseen: 10, medianPrior: 0, pnlUp: 0, pnlDown: 0, medianAgeDays: null });
  const c5 = s.capAtSignal;
  const at20 = pick.x.at + 15 * M;
  radar.consider({ ...pick.x, min: 20, at: at20, curveSol: solFor(c5 * 1.5), creatorSoldPct: 10, buyers: 300, buys: 400, sells: 395, solIn: 15, solOut: 14 } as MarkRow, { symbol: "RUN", held30: { held: 1, of: 30 } }, at20);
  assert.equal(s.stage, "confirmed");
  assert.equal(s.organic?.tag, "pumped");
  assert.ok(s.organic!.lines.some((l) => /brand new wallets|looks botted/.test(l)));
  let cap: number | null = 200;
  const live = () => (cap == null ? null : { cap, graduated: false });
  radar.refresh(live, at20 + 30 * M);
  assert.equal(s.outcome?.capAt1h, undefined);
  radar.refresh(live, at20 + H + M);
  assert.equal(s.outcome?.capAt1h, 200);
  cap = 300;
  radar.refresh(live, at20 + H + 2 * M);
  assert.equal(s.outcome?.capAt1h, 200, "written once");
  cap = null;
  radar.refresh(live, at20 + 25 * H);
  assert.equal(s.outcome?.capAt2h, null, "the coin left the tape");
  assert.equal(s.outcome?.capAt24h, null);
  // A restart reads the label, the wallet quality and the checkpoints back.
  const again = new Radar(file, memory());
  again.load(at20 + 25 * H);
  const r = again.signals(at20 + 25 * H)[0]!;
  assert.equal(r.organic?.tag, "pumped");
  assert.equal(r.wallets?.fresh, 20);
  assert.equal(r.outcome?.capAt1h, 200);
  assert.equal(r.outcome?.capAt24h, null);
});
