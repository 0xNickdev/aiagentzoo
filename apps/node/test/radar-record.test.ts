import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { curveCap, FROZEN, featuresOf, judge, type MarkRow } from "../src/chain/radar.ts";
import { RecordBuilder } from "../src/chain/radar-record.ts";

const rows = JSON.parse(readFileSync(new URL("./fixtures/radar-marks.json", import.meta.url), "utf8")) as Array<{ x: MarkRow; prior: { n: number; g: number }; early: number[] }>;
const H = 3_600_000;

test("track record grades picks 30 h on, from signal to peak, with clean graduations and a base rate", async () => {
  const pick = rows.find((r) => judge(featuresOf(r.x, { prior: r.prior.n, priorG: r.prior.g, early: r.early })).tier)!;
  const miss = rows.find((r) => !judge(featuresOf(r.x, { prior: r.prior.n, priorG: r.prior.g, early: r.early })).tier)!;
  assert.ok(pick && miss);
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tokens (id INTEGER PRIMARY KEY, mint TEXT, symbol TEXT, creator_id INTEGER, created_at INTEGER, graduated_at INTEGER, cap_peak REAL, cap_peak_at INTEGER);
    CREATE TABLE wallet_tokens (wallet_id INTEGER, token_id INTEGER, role INTEGER);`);
  const ins = db.prepare("INSERT INTO tokens (mint, symbol, creator_id, created_at, graduated_at, cap_peak, cap_peak_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  let creator = 1;
  const put = (r: (typeof rows)[number], symbol: string, peakX: number, grad: boolean) => {
    const c = creator++;
    for (let i = 0; i < r.prior.n; i++) ins.run(`${symbol}old${i}`, "O", c, r.x.createdAt - 1000 - i, i < r.prior.g ? r.x.createdAt - 500 : null, null, null);
    const c5 = curveCap(r.x.curveSol);
    const id = Number(ins.run(r.x.mint, symbol, c, r.x.createdAt, grad ? r.x.createdAt + H : null, c5 * peakX, r.x.createdAt + 2 * H).lastInsertRowid);
    for (const w of r.early) db.prepare("INSERT INTO wallet_tokens VALUES (?, ?, 1)").run(w, id);
  };
  put(pick, "RUN", 12, true);
  put(miss, "MISS", 1, false);
  const dir = mkdtempSync(join(tmpdir(), "record-"));
  const marks = join(dir, "marks.jsonl");
  const t0 = Math.max(pick.x.createdAt, miss.x.createdAt);
  writeFileSync(marks, `${JSON.stringify(pick.x)}\n${JSON.stringify({ ...pick.x, min: 20 })}\n`);
  const frozen = { ...FROZEN, frozenAt: Math.min(pick.x.createdAt, miss.x.createdAt) - 1 };
  const b = new RecordBuilder(db, marks, null, frozen);

  // Too young to grade.
  let r = await b.update(t0 + 10 * H);
  assert.equal(r.picks.n, 0);
  // A reading written in two pieces is read once it is whole.
  const line = JSON.stringify(miss.x);
  appendFileSync(marks, line.slice(0, 20));
  r = await b.update(t0 + 31 * H, async () => {}, 64);
  appendFileSync(marks, `${line.slice(20)}\n`);
  r = await b.update(t0 + 31 * H);
  assert.equal(r.base.n, 2, "both readings graded once");
  assert.equal(r.picks.n, 1);
  assert.equal(r.top.length, 1);
  const top = r.top[0]!;
  assert.equal(top.symbol, "RUN");
  assert.equal(top.multiple, 12);
  assert.equal(top.graduated, curveCap(pick.x.curveSol) * 12 >= 350);
  assert.equal(r.base.x10, 1);

  // Live signals a day old join the record; their own peak counts.
  const radar = join(dir, "radar.jsonl");
  writeFileSync(radar, `${JSON.stringify({ mint: "LIVE1", symbol: "LV", at: t0, createdAt: t0, capAtSignal: 50, tier: "watch" })}\n${JSON.stringify({ kind: "outcome", mint: "LIVE1", peakCap: 200, peakX: 4, graduated: true, checkedAt: t0 })}\n${JSON.stringify({ mint: "LIVE2", symbol: "NEW", at: t0 + 30 * H, createdAt: t0, capAtSignal: 50, tier: "watch" })}\n`);
  r = await new RecordBuilder(db, marks, radar, frozen).update(t0 + 31 * H);
  assert.equal(r.picks.n, 2, "the young live signal waits");
  const lv = r.top.find((x) => x.mint === "LIVE1")!;
  assert.equal(lv.multiple, 4);
  assert.equal(lv.live, true);
  assert.equal(lv.graduated, false, "not in the long memory: no clean graduation");
});
