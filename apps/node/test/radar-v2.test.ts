import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { featuresV2, RadarV2, scoreV2, V2, type V2History, type V2Row } from "../src/chain/radar-v2.ts";

/** Real 5- and 20-minute readings with the history build.js gave them, and the features and logit train.py computed. */
const rows = JSON.parse(readFileSync(new URL("./fixtures/radar-v2-rows.json", import.meta.url), "utf8")) as Array<{
  r5: V2Row;
  m20: V2Row;
  h: V2History;
  f: Record<string, number | null>;
  z: number;
}>;
const close = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

test("v2 features and score match train.py on real readings", () => {
  for (const r of rows) {
    const f = featuresV2(r.r5, r.m20, r.h);
    for (const c of V2.cols) {
      const want = r.f[c] ?? null;
      if (want === null) assert.ok(Number.isNaN(f[c]), `${c} missing`);
      else close(f[c] ?? NaN, want, c);
    }
    close(scoreV2(V2, f).z, r.z, "z");
  }
  // The export's own probe: the same logit sklearn gave.
  const probe = (V2 as unknown as { probe: { f: Record<string, number>; z: number } }).probe;
  close(scoreV2(V2, probe.f).z, probe.z, "probe");
});

/** A history.db with only what v2 reads, filled with the counts the fixture's history stands for. */
function memory(mint: string, createdAt: number) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tokens (id INTEGER PRIMARY KEY, mint TEXT, creator_id INTEGER, created_at INTEGER, funder TEXT, graduated_at INTEGER, cap_peak REAL, dev_dumped_at INTEGER);
    CREATE TABLE wallet_tokens (wallet_id INTEGER, token_id INTEGER, role INTEGER, took INTEGER, at INTEGER);`);
  const ins = db.prepare("INSERT INTO tokens (mint, creator_id, created_at, funder, graduated_at, cap_peak, dev_dumped_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const id = Number(ins.run(mint, 1, createdAt, "F", null, null, null).lastInsertRowid);
  // An earlier coin by the same creator, 7 h before: graduated, so a runner once its 6 h are up.
  const old = Number(ins.run("old", 1, createdAt - 7 * 3_600_000, "F", createdAt - 6.9 * 3_600_000, 2000, null).lastInsertRowid);
  const wt = db.prepare("INSERT INTO wallet_tokens VALUES (?, ?, ?, 0, 0)");
  wt.run(10, id, 1);
  wt.run(11, id, 2);
  wt.run(10, old, 1);
  return db;
}

test("v2 reads history point in time, picks over the threshold and writes the entry cap 25 s later", () => {
  const top = rows[0]!;
  const db = memory(top.r5.mint, top.r5.createdAt);
  const file = join(mkdtempSync(join(tmpdir(), "v2-")), "radar-v2.jsonl");
  const later: Array<() => void> = [];
  const v2 = new RadarV2(file, db, () => 500, V2, (fn) => later.push(fn));
  const h = v2.history(top.r5.mint)!;
  assert.deepEqual(
    { eN: h.eN, bN: h.bN, eKnown: h.eKnown, eRR: h.eRR, cN: h.cN, cK: h.cK, cR: h.cR, cG: h.cG, fN: h.fN, fK: h.fK },
    { eN: 1, bN: 1, eKnown: 1, eRR: 1, cN: 1, cK: 1, cR: 1, cG: 1, fN: 1, fK: 1 },
  );
  // From here the fixture's own history stands in for the store, so the scores are train.py's.
  v2.history = () => top.h;
  // A 20-minute reading without its 5-minute one is not scored; then the pair is.
  assert.equal(v2.consider({ ...top.m20, min: 20 }, { symbol: "X" }), null);
  assert.equal(v2.consider({ ...top.r5, min: 5 }, { symbol: "X" }), null);
  const pick = v2.consider({ ...top.m20, min: 20 }, { symbol: "X" });
  assert.ok(pick && pick.p >= V2.threshold);
  assert.equal(later.length, 1);
  later[0]!();
  const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[0].kind, "pick");
  assert.equal(lines[1].kind, "entry");
  assert.equal(lines[1].capAtEntry, 500);
  assert.equal(lines[1].at, pick.at + 25_000);
  // A low reading, a graduated one or a skipped coin never picks; nor do 1-3 or 5-minute readings on their own.
  const low = rows[3]!;
  v2.history = () => low.h;
  v2.consider({ ...low.r5, min: 5 }, { symbol: "L" });
  assert.equal(v2.consider({ ...low.m20, min: 20 }, { symbol: "L" }), null);
  v2.history = () => top.h;
  v2.consider({ ...top.r5, min: 5 }, { symbol: "X" });
  assert.equal(v2.consider({ ...top.m20, min: 20, graduated: true }, { symbol: "X" }), null);
  assert.equal(v2.consider({ ...top.m20, min: 3 }, { symbol: "X" }), null);
});
