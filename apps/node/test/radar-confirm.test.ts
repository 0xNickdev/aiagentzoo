import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { confirms, curveCap, FROZEN, featuresOf, judge, type MarkRow, Radar } from "../src/chain/radar.ts";
import { RecordBuilder } from "../src/chain/radar-record.ts";

const rows = JSON.parse(readFileSync(new URL("./fixtures/radar-marks.json", import.meta.url), "utf8")) as Array<{ x: MarkRow; prior: { n: number; g: number }; early: number[] }>;
const H = 3_600_000;
const M = 60_000;
/** The curve's SOL for a cap: the inverse of curveCap. */
const solFor = (cap: number) => Math.sqrt(cap * 32.19) - 30;

const pick = rows.find((r) => judge(featuresOf(r.x, { prior: r.prior.n, priorG: r.prior.g, early: r.early })).tier)!;

function memory(r: (typeof rows)[number], extra: Array<{ mint: string; createdAt: number; peak?: number; peakAt?: number; grad?: number | null }> = []) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tokens (id INTEGER PRIMARY KEY, mint TEXT, symbol TEXT, creator_id INTEGER, created_at INTEGER, graduated_at INTEGER, cap_peak REAL, cap_peak_at INTEGER);
    CREATE TABLE wallet_tokens (wallet_id INTEGER, token_id INTEGER, role INTEGER, took INTEGER, at INTEGER);`);
  const ins = db.prepare("INSERT INTO tokens (mint, symbol, creator_id, created_at, graduated_at, cap_peak, cap_peak_at) VALUES (?, ?, 7, ?, ?, ?, ?)");
  for (let i = 0; i < r.prior.n; i++) ins.run(`old${i}`, "O", r.x.createdAt - 1000 - i, i < r.prior.g ? r.x.createdAt - 500 : null, null, null);
  const id = Number(ins.run(r.x.mint, "RUN", r.x.createdAt, null, null, null).lastInsertRowid);
  for (const w of r.early) db.prepare("INSERT INTO wallet_tokens VALUES (?, ?, 1, 0, 0)").run(w, id);
  for (const e of extra) ins.run(e.mint, "X", e.createdAt, e.grad ?? null, e.peak ?? null, e.peakAt ?? null);
  return db;
}

test("the minute-20 rule: up 20% or graduated, and the dev sold under half", () => {
  assert.equal(confirms(100, { cap: 120, graduated: false, devSold: 0 }), true);
  assert.equal(confirms(100, { cap: 119.9, graduated: false, devSold: 0 }), false);
  assert.equal(confirms(100, { cap: 50, graduated: true, devSold: 10 }), true, "graduated by minute 20 confirms");
  assert.equal(confirms(100, { cap: 300, graduated: false, devSold: 50 }), false, "dev sold half: rejected");
  assert.equal(confirms(100, { cap: 300, graduated: true, devSold: 80 }), false);
  assert.equal(confirms(100, { cap: null, graduated: false, devSold: null }), false);
});

test("a candidate at minute five is confirmed at minute twenty, measured from the minute-20 cap, and survives a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-confirm-"));
  const file = join(dir, "radar.jsonl");
  const db = memory(pick);
  const radar = new Radar(file, db);
  const s = radar.consider(pick.x, { symbol: "RUN" }, pick.x.at)!;
  assert.ok(s);
  assert.equal(s.stage, "candidate");
  const c5 = s.capAtSignal;
  assert.equal(radar.signals(pick.x.at + M).length, 0, "a candidate is not a signal yet");
  assert.equal(radar.signals(pick.x.at + M, 0, "early").length, 1);
  assert.equal(radar.todayCount(pick.x.at + M), 0);

  const at20 = pick.x.at + 15 * M;
  const got = radar.consider({ ...pick.x, min: 20, at: at20, curveSol: solFor(c5 * 1.5), creatorSoldPct: 10 }, { symbol: "RUN" }, at20);
  assert.equal(got, s);
  assert.equal(s.stage, "confirmed");
  assert.equal(s.capAt5, c5);
  assert.ok(Math.abs(s.capAtSignal - c5 * 1.5) < 0.2);
  assert.equal(s.upX, 1.5);
  assert.equal(s.confirmedAt, at20);
  assert.equal(radar.signals(at20 + M).length, 1);
  assert.equal(radar.lastSignalAt(), at20);

  // Outcomes from the minute-20 cap: 3x the cap at minute five is 2x the cap at confirmation.
  radar.refresh(() => ({ cap: c5 * 3, graduated: false }), at20 + M);
  assert.equal(s.outcome?.peakX, 2);

  const back = new Radar(file, db);
  back.load(at20 + H);
  const again = back.signals(at20 + H)[0]!;
  assert.equal(again.stage, "confirmed");
  assert.equal(again.capAt5, c5);
  assert.equal(again.outcome?.peakX, 2);
  assert.equal(back.signals(at20 + 30 * M, 60 * M).length, 0, "the public hour counts from confirmation");
  assert.equal(back.stats(at20 + 25 * H).all.n, 1);
});

test("a coin graduated before minute twenty is confirmed at the tape's cap; a dev who sold half is rejected", () => {
  const db = memory(pick);
  const grad = new Radar(null, db, FROZEN, () => 420);
  const s = grad.consider(pick.x, { symbol: "RUN" }, pick.x.at)!;
  grad.consider({ ...pick.x, min: 20, at: pick.x.at + 15 * M, graduated: true, curveSol: 0, creatorSoldPct: 0 }, { symbol: "RUN" });
  assert.equal(s.stage, "confirmed");
  assert.equal(s.capAtSignal, 420);

  const dump = new Radar(null, db);
  const d = dump.consider(pick.x, { symbol: "RUN" }, pick.x.at)!;
  assert.equal(dump.consider({ ...pick.x, min: 20, at: pick.x.at + 15 * M, curveSol: solFor(d.capAtSignal * 4), creatorSoldPct: 60 }, { symbol: "RUN" }), null);
  assert.equal(d.stage, "rejected");
  assert.equal(dump.signals(pick.x.at + H).length, 0);
  assert.equal(dump.signals(pick.x.at + H, 0, "early")[0]?.stage, "rejected");

  const flat = new Radar(null, db);
  const f = flat.consider(pick.x, { symbol: "RUN" }, pick.x.at)!;
  flat.consider({ ...pick.x, min: 20, at: pick.x.at + 15 * M, curveSol: solFor(f.capAtSignal * 1.1), creatorSoldPct: 0 }, { symbol: "RUN" });
  assert.equal(f.stage, "rejected", "up only 10%");
});

test("backfill: the worker hands minute-20 marks of undecided candidates to the main thread", async () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-backfill-"));
  const file = join(dir, "radar.jsonl");
  const marks = join(dir, "marks.jsonl");
  const db = memory(pick);
  const radar = new Radar(file, db);
  const s = radar.consider(pick.x, { symbol: "RUN" }, pick.x.at)!;
  // The node was down at minute twenty: the mark is in the file but the radar never saw it.
  writeFileSync(marks, `${JSON.stringify(pick.x)}\n${JSON.stringify({ ...pick.x, min: 20, at: pick.x.at + 15 * M, curveSol: solFor(s.capAtSignal * 2), creatorSoldPct: 0 })}\n`);
  const b = new RecordBuilder(db, marks, file, { ...FROZEN, frozenAt: pick.x.createdAt - 1 });
  await b.update(pick.x.at + H);
  const rows20 = b.undecided();
  assert.equal(rows20.length, 1);
  const back = new Radar(file, db);
  back.load(pick.x.at + H);
  assert.equal(back.backfill(rows20), 1);
  assert.equal(back.signals(pick.x.at + H)[0]?.upX, 2);
  // Decided once: the next pass finds nothing to do.
  assert.equal(new RecordBuilder(db, marks, file, { ...FROZEN, frozenAt: pick.x.createdAt - 1 }).undecided().length, 0);
});

test("the confirmed record recomputes past picks through the minute-20 rule, from the minute-20 cap", async () => {
  const c5 = curveCap(pick.x.curveSol);
  const db = memory(pick);
  db.prepare("UPDATE tokens SET cap_peak=?, cap_peak_at=?, graduated_at=? WHERE mint=?").run(c5 * 6, pick.x.createdAt + 2 * H, pick.x.createdAt + H, pick.x.mint);
  const dir = mkdtempSync(join(tmpdir(), "record-confirm-"));
  const marks = join(dir, "marks.jsonl");
  writeFileSync(marks, `${JSON.stringify(pick.x)}\n${JSON.stringify({ ...pick.x, min: 20, at: pick.x.createdAt + 20 * M, curveSol: solFor(c5 * 2), creatorSoldPct: 5 })}\n`);
  const r = await new RecordBuilder(db, marks, null, { ...FROZEN, frozenAt: pick.x.createdAt - 1 }).update(pick.x.createdAt + 31 * H);
  assert.equal(r.picks.n, 1);
  assert.equal(r.top[0]?.multiple, 6, "the trial record stays from minute five");
  assert.equal(r.confirmed.n, 1);
  assert.equal(r.confirmed.x2, 1);
  assert.equal(r.confirmed.top[0]?.multiple, 3, "6x the minute-five cap is 3x the minute-20 cap");
  assert.ok(Math.abs(r.confirmed.top[0]!.capAtSignal - c5 * 2) < 0.2);
  assert.equal(r.confirmed.perDay, null, "under a graded day");

  // The dev sold half by minute twenty: the pick stays in the trial record, not in the confirmed one.
  writeFileSync(marks, `${JSON.stringify(pick.x)}\n${JSON.stringify({ ...pick.x, min: 20, at: pick.x.createdAt + 20 * M, curveSol: solFor(c5 * 2), creatorSoldPct: 70 })}\n`);
  const r2 = await new RecordBuilder(db, marks, null, { ...FROZEN, frozenAt: pick.x.createdAt - 1 }).update(pick.x.createdAt + 31 * H);
  assert.equal(r2.picks.n, 1);
  assert.equal(r2.confirmed.n, 0);
});

test("/v1/radar serves confirmed signals; candidates only for holders asking ?stage=early", async () => {
  const { radarRoutes } = await import("../src/routes/radar.ts");
  const db = memory(pick);
  const radar = new Radar(null, db);
  const now = Date.now();
  const x = { ...pick.x, at: now - 30 * M };
  const s = radar.consider(x, { symbol: "RUN" }, x.at)!;
  radar.consider({ ...x, min: 20, at: now - 15 * M, curveSol: solFor(s.capAtSignal * 1.3), creatorSoldPct: 0 }, { symbol: "RUN" });
  const other = { ...rows.find((r) => r !== pick)!.x, mint: "CAND", at: now - 2 * M };
  radar["list"].unshift({ ...s, mint: "CAND", stage: "candidate", at: other.at, confirmedAt: undefined, capAt5: 40, capAtSignal: 40 });

  const call = async (path: string, peer: boolean) => {
    let status = 0;
    let body = "";
    const req = { method: "GET", headers: peer ? {} : { "x-forwarded-for": "1.2.3.4" }, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage;
    const res = { writeHead: (c: number) => (status = c), end: (b: string) => (body = b), setHeader: () => {} } as unknown as ServerResponse;
    const ctx = { radar, checkGate: { take: () => 0 }, holding: { holds: async () => false } } as never;
    const u = new URL(`http://x${path}`);
    await radarRoutes(ctx, req, res, u, u.pathname);
    return { status, body: JSON.parse(body) as { access: string; signals: Array<{ mint: string; stage: string; capAt5: number; upX: number }>; candidates?: Array<{ mint: string }>; today: { signals: number } } };
  };
  const live = await call("/v1/radar", true);
  assert.equal(live.status, 200);
  assert.deepEqual(live.body.signals.map((x) => x.mint), [pick.x.mint]);
  assert.equal(live.body.signals[0]!.stage, "confirmed");
  assert.equal(live.body.signals[0]!.upX, 1.3);
  assert.equal(live.body.candidates, undefined);
  assert.equal(live.body.today.signals, 1);
  const early = await call("/v1/radar?stage=early", true);
  assert.deepEqual(early.body.candidates?.map((x) => x.mint), ["CAND", pick.x.mint]);
  const pub = await call("/v1/radar?stage=early", false);
  assert.equal(pub.status, 403);
  assert.equal(pub.body.candidates, undefined, "no candidates for the public");
  assert.equal(pub.body.signals.length, 0, "confirmed 15 min ago: still inside the public hour");
});

test("the bot says confirmed at minute 20 and how far it rose; a candidate says early, not confirmed", async () => {
  const { runnerAlert } = await import("../src/telegram.ts");
  const base = { mint: "So11111111111111111111111111111111111111112", symbol: "RUN", at: 0, capAtSignal: 80, tier: "watch" as const, reasons: ["269 buyers in 5 minutes", "149 SOL in"] };
  const c = runnerAlert({ ...base, stage: "confirmed", confirmedAt: 1, capAt5: 50, upX: 1.6 });
  assert.match(c, /Runner radar · confirmed at minute 20/);
  assert.match(c, /cap at minute 20/);
  assert.match(c, /up 1\.6x since minute 5/);
  assert.match(c, /• 269 buyers in 5 minutes/);
  assert.doesNotMatch(c, /—/);
  const e = runnerAlert({ ...base, stage: "candidate" });
  assert.match(e, /Runner radar · early, not confirmed/);
  assert.doesNotMatch(e, /since minute 5/);
});
