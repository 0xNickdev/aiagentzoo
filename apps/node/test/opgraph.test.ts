import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HistoryStore } from "../src/chain/history.ts";
import { PumpTape } from "../src/chain/pump.ts";
import { OPGRAPH, OperatorGraph, operatorGraphWarning } from "../src/chain/opgraph.ts";
import { checkToken } from "../src/chain/check.ts";

const pad = (s: string) => s.padEnd(44, "g");

const tempStore = () => {
  const dir = mkdtempSync(join(tmpdir(), "zoo-opgraph-"));
  const store = new HistoryStore(join(dir, "history.db"));
  store.db.exec(`CREATE TABLE IF NOT EXISTS social_links (account TEXT NOT NULL, mint TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, label TEXT NOT NULL,
    creator TEXT NOT NULL, symbol TEXT NOT NULL, created_at INTEGER NOT NULL, dumped_after_min INTEGER, PRIMARY KEY (account, mint)) WITHOUT ROWID`);
  return { store, done: () => rmSync(dir, { recursive: true, force: true }) };
};

/** One launch by `dev`: snipers buy in the first second, the dev dumps after two minutes when `dump`. */
const launch = (store: HistoryStore, mint: string, dev: string, t0: number, opts: { funder?: string; snipers?: string[]; dump?: boolean } = {}) => {
  const t = new PumpTape();
  t.apply({ kind: "create", name: "x", symbol: "X", mint, creator: dev, ts: t0 }, t0, `c${mint}`, 100);
  t.apply({ kind: "trade", mint, sol: 1, tokens: 50_000_000, isBuy: true, user: dev, ts: t0, curveSol: 31 }, t0, `d${mint}`, 100);
  (opts.snipers ?? []).forEach((w, i) => t.apply({ kind: "trade", mint, sol: 1, tokens: 20_000_000, isBuy: true, user: w, ts: t0 + 500 + i, curveSol: 32 }, t0, `s${i}${mint}`, 101));
  if (opts.dump) t.apply({ kind: "trade", mint, sol: 1, tokens: 50_000_000, isBuy: false, user: dev, ts: t0 + 120_000, curveSol: 31 }, t0 + 120_000, `x${mint}`, 400);
  const rec = t.historyOf(mint, t0 + 10 * 60_000)!;
  store.write([{ ...rec, funder: opts.funder ?? null }], t0);
};

test("same funder joins launch wallets into one operator; its record is the dev's line", () => {
  const { store, done } = tempStore();
  try {
    const t0 = Date.now() - 3 * 3_600_000;
    const F = pad("Funder");
    for (let i = 0; i < 6; i++) launch(store, pad(`M${i}`), pad(`Dev${i}`), t0 + i * 60_000, { funder: F, dump: true });
    const g = new OperatorGraph(store.db);
    const r = g.update(Date.now());
    assert.equal(r.tokens, 6);
    const s = g.summary(pad("Dev5"))!;
    assert.equal(s.creators, 6);
    assert.equal(s.launches, 5, "the other wallets' launches");
    assert.equal(s.dumped, 5);
    assert.ok((s.ties.funder ?? 0) >= 5);
    const w = operatorGraphWarning(s, pad("Dev5"))!;
    assert.match(w.text, /same funder as 5 other launch wallets/);
    assert.equal(w.avoid, true);
    // A second run reads nothing again.
    assert.equal(g.update(Date.now()).tokens, 0);
  } finally {
    done();
  }
});

test("an X account shared by launches is evidence only: it never makes an operator", () => {
  const { store, done } = tempStore();
  try {
    const t0 = Date.now() - 3 * 3_600_000;
    for (let i = 0; i < 3; i++) {
      launch(store, pad(`A${i}`), pad(`Ad${i}`), t0 + i * 60_000, { dump: true });
      store.db.prepare("INSERT INTO social_links VALUES (?, ?, 'x', 'u', '@rug', ?, 'X', ?, 2)").run("x:@rug", pad(`A${i}`), pad(`Ad${i}`), t0 + i * 60_000);
    }
    const g = new OperatorGraph(store.db);
    g.update(Date.now());
    assert.equal(g.summary(pad("Ad2")), null);
    const edges = store.db.prepare("SELECT count(*) AS n FROM op_edges WHERE type = 'account'").get() as { n: number };
    assert.ok(Number(edges.n) >= 2);
  } finally {
    done();
  }
});

test("an account with an on-chain tie is named in the reason", () => {
  const { store, done } = tempStore();
  try {
    const t0 = Date.now() - 3 * 3_600_000;
    const F = pad("CrewFunder");
    for (let i = 0; i < 4; i++) {
      launch(store, pad(`B${i}`), pad(`Bd${i}`), t0 + i * 60_000, { funder: F, dump: true });
      if (i < 3) store.db.prepare("INSERT INTO social_links VALUES (?, ?, 'x', 'u', '@crew', ?, 'X', ?, 2)").run("x:@crew", pad(`B${i}`), pad(`Bd${i}`), t0 + i * 60_000);
    }
    const g = new OperatorGraph(store.db);
    g.update(Date.now());
    const s = g.summary(pad("Bd3"))!;
    assert.deepEqual(s.accounts, ["x:@crew"]);
    const w = operatorGraphWarning(s, pad("Bd3"))!;
    assert.match(w.text, /same funder/);
    assert.match(w.text, /same X @crew/);
  } finally {
    done();
  }
});

test("shared snipers never chain devs: they join two lone wallets at most and give no reason", () => {
  const { store, done } = tempStore();
  try {
    const t0 = Date.now() - 3 * 3_600_000;
    const snipers = [pad("S1"), pad("S2"), pad("S3")];
    for (let i = 0; i < 5; i++) launch(store, pad(`C${i}`), pad(`Cd${i}`), t0 + i * 60_000, { snipers, dump: true });
    const g = new OperatorGraph(store.db);
    g.update(Date.now());
    const sizes = g.sizes();
    assert.ok([...sizes.keys()].every((n) => n <= OPGRAPH.sniperJoinMax), `sizes ${[...sizes.keys()]}`);
    const edges = store.db.prepare("SELECT count(*) AS n FROM op_edges WHERE type = 'snipers'").get() as { n: number };
    assert.ok(Number(edges.n) >= 4, "kept as evidence");
    for (let i = 0; i < 5; i++) assert.equal(operatorGraphWarning(g.summary(pad(`Cd${i}`)), pad(`Cd${i}`)), null);
  } finally {
    done();
  }
});

test("two shared snipers are not enough, and busy snipers tie nothing", () => {
  const { store, done } = tempStore();
  try {
    const t0 = Date.now() - 3 * 3_600_000;
    launch(store, pad("E0"), pad("Ed0"), t0, { snipers: [pad("T1"), pad("T2")] });
    launch(store, pad("E1"), pad("Ed1"), t0 + 60_000, { snipers: [pad("T1"), pad("T2")] });
    const bots = [pad("Bot1"), pad("Bot2"), pad("Bot3")];
    for (let i = 0; i <= OPGRAPH.sniperMaxSnipes; i++) launch(store, pad(`G${i}`), pad(`Gd${i}`), t0 + 120_000 + i * 1_000, { snipers: bots });
    const g = new OperatorGraph(store.db);
    g.update(Date.now());
    assert.equal(g.summary(pad("Ed1")), null);
    assert.equal(g.summary(pad(`Gd${OPGRAPH.sniperMaxSnipes}`)), null);
  } finally {
    done();
  }
});

test("a group at the cap is too broad to move a verdict", () => {
  const graph = { id: "a", creators: OPGRAPH.maxMembers, members: [], launches: 100, dumped: 90, accounts: [], ties: { funder: 80 }, near: [], firstSeen: 0, tooBroad: true };
  assert.equal(operatorGraphWarning(graph), null);
  const sniperMostly = { ...graph, creators: 10, tooBroad: false, ties: { funder: 1, snipers: 9 } };
  assert.equal(operatorGraphWarning(sniperMostly), null);
});

test("a version bump empties the graph and a rebuild reads history again", () => {
  const { store, done } = tempStore();
  try {
    const t0 = Date.now() - 3 * 3_600_000;
    const F = pad("RFunder");
    for (let i = 0; i < 3; i++) launch(store, pad(`R${i}`), pad(`Rd${i}`), t0 + i * 60_000, { funder: F, dump: true });
    const g = new OperatorGraph(store.db);
    g.update(Date.now());
    assert.equal(g.outdated(), false);
    store.db.prepare("UPDATE op_state SET v = 1 WHERE k = 'version'").run();
    store.db.prepare("INSERT INTO op_members VALUES ('junk', 'junk', 0, 0)").run();
    assert.equal(g.outdated(), true);
    g.reset();
    assert.equal(g.rebuilding(), true);
    assert.equal(g.summary(pad("Rd2")), null, "silent while rebuilding");
    g.update(Date.now());
    g.rebuilt();
    assert.equal(g.summary(pad("Rd2"))!.creators, 3);
    assert.equal(g.idOf("junk"), null);
    assert.equal(g.rebuild(Date.now()), 3);
    assert.equal(g.outdated(), false);
  } finally {
    done();
  }
});

test("a funder paying too many devs is a service, and a fresh token waits to settle", () => {
  const { store, done } = tempStore();
  try {
    const t0 = Date.now() - 3 * 3_600_000;
    const HOT = pad("Hot");
    for (let i = 0; i < OPGRAPH.funderMaxDevs + 2; i++) launch(store, pad(`H${i}`), pad(`Hd${i}`), t0 + i * 1_000, { funder: HOT });
    const g = new OperatorGraph(store.db);
    g.update(Date.now());
    const s = g.summary(pad(`Hd${OPGRAPH.funderMaxDevs + 1}`));
    assert.equal(s, null);
    // Written just now: not read before it settles.
    launch(store, pad("Fresh"), pad("FreshDev"), Date.now(), { funder: pad("F2") });
    assert.equal(g.update(Date.now()).tokens, 0);
  } finally {
    done();
  }
});

test("the check names the operator and keeps an account-only record off", () => {
  const graph = { id: "a", creators: 4, members: [], launches: 10, dumped: 8, accounts: ["x:@crew"], ties: { funder: 3 }, near: [], firstSeen: 0 };
  const facts = { ageMin: 30, buyers: 20, buys: 20, sells: 5, solIn: 5, curveSol: 40, creatorSold: 0, creatorLaunches24h: 1, bundleWallets: 0, bundleShare: 0, top5Share: 0.2, graduated: false, poolSol: null } as never;
  const c = checkToken(pad("Mint"), { symbol: "X", facts, creatorRecord: null }, { graph });
  assert.ok(c.reasons.some((r) => /same funder as 3 other launch wallets/.test(r)));
  assert.equal(c.verdict, "avoid");
  assert.equal(c.operatorGraph?.creators, 4);
  const accountOnly = { ...graph, ties: { account: 3 } };
  assert.equal(operatorGraphWarning(accountOnly), null);
});
