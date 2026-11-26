import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { FROZEN, featuresOf, judge, type MarkRow, Radar, reasonsOf, scoreOf } from "../src/chain/radar.ts";

/** Real 5-minute readings from north's chain-marks.jsonl, with the long-memory inputs and the scores trial.js gave them on the VPS. */
const rows = JSON.parse(readFileSync(new URL("./fixtures/radar-marks.json", import.meta.url), "utf8")) as Array<{
  x: MarkRow;
  prior: { n: number; g: number };
  early: number[];
  scores: Record<"RB" | "G" | "R3" | "R10", number>;
}>;

test("radar scores real readings exactly as trial.js did", () => {
  assert.ok(rows.length >= 4);
  for (const r of rows) {
    const f = featuresOf(r.x, { prior: r.prior.n, priorG: r.prior.g, early: r.early });
    for (const k of ["RB", "G", "R3", "R10"] as const) assert.equal(scoreOf(FROZEN.models[k], f), r.scores[k], `${r.x.mint} ${k}`);
  }
});

test("tiers follow the frozen cut-offs, reasons are plain words", () => {
  for (const r of rows) {
    const f = featuresOf(r.x, { prior: r.prior.n, priorG: r.prior.g, early: r.early });
    const j = judge(f);
    const strong = r.scores.RB >= FROZEN.models.RB.top05 || r.scores.G >= FROZEN.models.G.top05;
    const watch = r.scores.RB >= FROZEN.models.RB.top1 || r.scores.G >= FROZEN.models.G.top1;
    assert.equal(j.tier, strong ? "strong" : watch ? "watch" : null);
    const reasons = reasonsOf(FROZEN.models.RB, f);
    assert.ok(reasons.length <= 3);
    for (const s of reasons) assert.doesNotMatch(s, /—|NaN|undefined/);
  }
});

/** A history.db with only what the radar reads, filled so the lookup gives the fixture's inputs. */
function memory(r: (typeof rows)[number]) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tokens (id INTEGER PRIMARY KEY, mint TEXT, creator_id INTEGER, created_at INTEGER, graduated_at INTEGER, cap_peak REAL, cap_peak_at INTEGER);
    CREATE TABLE wallet_tokens (wallet_id INTEGER, token_id INTEGER, role INTEGER, took INTEGER, at INTEGER);`);
  const ins = db.prepare("INSERT INTO tokens (mint, creator_id, created_at, graduated_at) VALUES (?, 7, ?, ?)");
  for (let i = 0; i < r.prior.n; i++) ins.run(`old${i}`, r.x.createdAt - 1000 - i, i < r.prior.g ? r.x.createdAt - 500 : null);
  const id = Number((ins.run(r.x.mint, r.x.createdAt, null) as { lastInsertRowid: number | bigint }).lastInsertRowid);
  // A later launch of the same dev does not count as prior.
  ins.run("later", r.x.createdAt + 1000, null);
  for (const w of r.early) db.prepare("INSERT INTO wallet_tokens VALUES (?, ?, 1, 0, 0)").run(w, id);
  db.prepare("INSERT INTO wallet_tokens VALUES (999999, ?, 2, 0, 0)").run(id);
  return db;
}

test("live radar reads the long memory like trial.js and signals once, with outcome and record", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-"));
  const file = join(dir, "radar.jsonl");
  const r = rows.find((o) => o.prior.n > 0 && o.scores.RB >= FROZEN.models.RB.top1) ?? rows[0]!;
  const db = memory(r);
  const radar = new Radar(file, db);
  assert.deepEqual(radar.lookup(r.x.mint), { prior: r.prior.n, priorG: r.prior.g, early: r.early });
  const s = radar.consider(r.x, { symbol: "TEST" }, r.x.at);
  assert.ok(s);
  assert.equal(s.scores.RB, Math.round(r.scores.RB * 1000) / 1000);
  assert.equal(radar.consider(r.x, { symbol: "TEST" }, r.x.at), null, "one signal per coin");
  assert.equal(new Radar(null, db).consider(r.x, { symbol: "X", skip: true }), null, "mayhem and non-SOL skipped");
  assert.equal(new Radar(null, db).consider({ ...r.x, graduated: true }, { symbol: "X" }), null);
  assert.equal(new Radar(null, db).consider({ ...r.x, min: 20 }, { symbol: "X" }), null);

  // The coin ran to 3x the cap at the signal and graduated.
  radar.refresh(() => ({ cap: s.capAtSignal * 3, graduated: true }), r.x.at + 60_000);
  assert.equal(s.outcome?.peakX, 3);
  assert.equal(s.outcome?.graduated, true);
  // A lower cap later does not lower the peak.
  radar.refresh(() => ({ cap: s.capAtSignal, graduated: false }), r.x.at + 120_000);
  assert.equal(s.outcome?.peakX, 3);

  const back = new Radar(file, db);
  assert.equal(back.load(r.x.at + 2 * 3_600_000), 1);
  const again = back.signals(r.x.at + 2 * 3_600_000)[0]!;
  assert.equal(again.outcome?.peakX, 3);
  assert.equal(back.signals(r.x.at + 30 * 60_000, 60 * 60_000).length, 0, "the public hour holds it back");
  const st = back.stats(r.x.at + 25 * 3_600_000);
  assert.equal(st.all.n, 1);
  assert.equal(st.all.x2, 1);
  assert.equal(st.all.x5, 0);
  assert.equal(st.all.graduated, 1);
  // Past a week it leaves memory.
  back.refresh(() => null, r.x.at + 8 * 24 * 3_600_000);
  assert.equal(back.size, 0);
});
