import { test } from "node:test";
import assert from "node:assert/strict";
import { CalloutFeed, FomoTheses, parseChannel } from "../src/chain/calls.ts";

const post = (id: number, mint: string, said: string) => `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="pumpfun_lp/${id}" data-view="x"><div class="tgme_widget_message_text js-message_text" dir="auto"><b>🚨</b> <b>NEW PUMPFUN CALLOUT</b><br/><b>🪙</b> <b>dogwifonesie (</b><b>&#036;ACHI</b><b>)</b><br/><br/><b>💬</b> <b>CALLOUT</b><br/><blockquote>${said}</blockquote><br/><br/><b>💰</b> <b>Market cap:</b> <code>&#036;39 335</code><br/><b>📣</b> <b>Called at MC:</b> <code>&#036;36 492</code><br/><b>🔔</b> <b>Callout:</b> <code>#2</code> <i>(1 before)</i><br/><br/><b>👤</b> <b>Caller:</b> SSTTEEPPPPAA<br/><b>👥</b> <b>Followers:</b> 4,814<br/><b>𝕏</b> <b>Twitter:</b> @neversellmyskr<br/><b>💼</b> <b>Wallet:</b> <code>BpuSMK3CtgAqiH6veEnZVh8NfHwT2ijJgJEAWYaFQNRL</code><br/><br/><b>📋</b> <b>CONTRACT</b><br/><code>${mint}</code></div><div class="tgme_widget_message_footer"><time datetime="2026-11-04T21:21:41+00:00"></time></div></div></div>`;

test("a channel post becomes a callout with the caller's wallet, followers and the market cap when called", () => {
  const c = parseChannel(post(7, "84sWQfNG5jBghw76FYdE5MpmtRPNEwZrxBZQ3KhQpump", "Have to bid"))[0]!;
  assert.equal(c.mint, "84sWQfNG5jBghw76FYdE5MpmtRPNEwZrxBZQ3KhQpump");
  assert.equal(c.symbol, "ACHI");
  assert.equal(c.text, "Have to bid");
  assert.equal(c.caller, "SSTTEEPPPPAA");
  assert.equal(c.followers, 4814);
  assert.equal(c.twitter, "@neversellmyskr");
  assert.equal(c.wallet, "BpuSMK3CtgAqiH6veEnZVh8NfHwT2ijJgJEAWYaFQNRL");
  assert.equal(c.calledMcUsd, 36492);
  assert.equal(c.mcUsd, 39335);
  assert.equal(c.nth, 2);
  assert.equal(c.postedAt, Date.parse("2026-11-04T21:21:41Z"));
  assert.equal(c.at, Date.parse("2026-11-04T21:21:41Z"), "no \"Called: N ago\" line: the post time");
});

test("posts that are not callouts are skipped, and the same post is kept once", () => {
  const html = '<div data-post="pumpfun_lp/1"><div class="js-message_text">gm</div></div>' + post(2, "84sWQfNG5jBghw76FYdE5MpmtRPNEwZrxBZQ3KhQpump", "x");
  const calls = parseChannel(html);
  assert.equal(calls.length, 1);
  const feed = new CalloutFeed();
  feed.add(calls);
  feed.add(calls);
  assert.equal(feed.of("84sWQfNG5jBghw76FYdE5MpmtRPNEwZrxBZQ3KhQpump").length, 1);
});

test("FOMO theses are cached per coin and stop at the daily budget", async () => {
  let calls = 0;
  const fake = (async (u: string) => {
    if (String(u).endsWith("/v2/me")) return new Response("{}", { status: 500 });
    calls++;
    return new Response(JSON.stringify({ theses: [{ id: "t1", text: "games good", handle: "olivi", tradeUsd: 84.5, unrealizedPnlUsd: 9.4, isDev: false, likes: 1, ts: "2026-11-05T00:56:56Z" }] }));
  }) as typeof fetch;
  const f = new FomoTheses("fapi_test", 1, fake);
  const a = await f.of("9LBeAW3McsaiNEjFHi1PLUvg4g3obginXq7WF4YXpump");
  assert.equal(a.status, "ok");
  assert.equal(a.theses[0]!.text, "games good");
  assert.equal(a.theses[0]!.pnlUsd, 9.4);
  assert.equal(a.theses[0]!.hype, true, "two words are not a thesis");
  await f.of("9LBeAW3McsaiNEjFHi1PLUvg4g3obginXq7WF4YXpump");
  assert.equal(calls, 1, "the second read comes from the cache");
  const b = await f.of("84sWQfNG5jBghw76FYdE5MpmtRPNEwZrxBZQ3KhQpump");
  assert.equal(b.status, "budget");
  assert.equal((await new FomoTheses("").of("x")).status, "off");
});

test("the call time is the post time less the channel's 'Called: N minutes ago', and pump.fun mentions keep only the name", () => {
  const html = post(9, "84sWQfNG5jBghw76FYdE5MpmtRPNEwZrxBZQ3KhQpump", "ask @[alon](0a1b2c3d-1111-2222-3333-444455556666) why").replace("<b>🔔</b>", "<b>🕒</b> <b>Called:</b> <code>9 minutes ago</code><br/><b>🔔</b>");
  const c = parseChannel(html)[0]!;
  assert.equal(c.at, Date.parse("2026-11-04T21:21:41Z") - 9 * 60_000);
  assert.equal(c.text, "ask @alon why");
});

test("a real claim is a thesis, hype is not", async () => {
  const { meaningful } = await import("../src/chain/calls.ts");
  assert.equal(meaningful("send it 🚀🚀 100k mc"), false);
  assert.equal(meaningful("dev is the same team that did the dogwifhat clone, burned LP yesterday"), true);
});

test("calls survive a restart: saved after a poll, read back by the next feed", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const file = join(mkdtempSync(join(tmpdir(), "calls-")), "callouts.json");
  const page = post(11, "84sWQfNG5jBghw76FYdE5MpmtRPNEwZrxBZQ3KhQpump", "fresh call").replace("2026-11-04T21:21:41+00:00", new Date().toISOString());
  const fake = (async () => new Response(page)) as typeof fetch;
  const a = new CalloutFeed(fake, () => {}, file);
  await a.poll();
  assert.equal(a.of("84sWQfNG5jBghw76FYdE5MpmtRPNEwZrxBZQ3KhQpump").length, 1);
  const b = new CalloutFeed(fake, () => {}, file);
  assert.equal(b.of("84sWQfNG5jBghw76FYdE5MpmtRPNEwZrxBZQ3KhQpump")[0]?.text, "fresh call");
});

test("the daily FOMO budget is what the keys have left over the days to the refill, and a cached ask pays nothing", async () => {
  const left: Record<string, number> = { "Bearer a": 0, "Bearer b": 12_500, "Bearer c": 25_000 };
  const paid: string[] = [];
  const fake = (async (u: string, o: { headers: { authorization: string } }) => {
    if (u.endsWith("/v2/me")) return new Response(JSON.stringify({ credits: { remaining: left[o.headers.authorization] } }));
    paid.push(o.headers.authorization);
    return new Response(JSON.stringify({ theses: [] }));
  }) as unknown as typeof fetch;
  const f = new FomoTheses("a, b, c", 100, fake);
  assert.equal((await f.of("m0", "likes", false)).status, "idle", "nothing read yet and nothing paid");
  assert.equal(paid.length, 0);
  // 30 pages left in all; the month has at most 31 days, so at least one day's share is 0 or 1 page, never the ceiling of 100.
  const now = new Date();
  const daysLeft = Math.max(1, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - now.getTime()) / 86_400_000));
  const share = Math.floor(30 / daysLeft);
  let ok = 0;
  for (let i = 0; i < 40; i++) if ((await f.of(`m${i}`)).status === "ok") ok++;
  assert.equal(ok, share);
  assert.ok(paid.every((k) => k === "Bearer b"), "the spent key is skipped from the start");
  if (share > 0) assert.equal((await f.of("m0", "likes", false)).status, "ok", "what was read is served to a cached ask");
});

test("FOMO moves to the next key when one is refused, and keeps it", async () => {
  const used: string[] = [];
  const fake = (async (u: string, o: { headers: { authorization: string } }) => {
    if (u.endsWith("/v2/me")) return new Response("{}", { status: 500 });
    used.push(o.headers.authorization);
    return o.headers.authorization.endsWith("a") ? new Response("{}", { status: 402 }) : new Response(JSON.stringify({ theses: [] }));
  }) as unknown as typeof fetch;
  const f = new FomoTheses("a, b", 10, fake);
  assert.equal((await f.of("m1")).status, "ok");
  assert.equal((await f.of("m2")).status, "ok");
  assert.deepEqual(used, ["Bearer a", "Bearer b", "Bearer b"]);
  const dead = new FomoTheses("a", 10, fake);
  assert.equal((await dead.of("m1")).status, "error");
});

test("a call is followed for 24 hours and lands in its caller's record; a repeat call on the coin is judged once", async () => {
  const { CallerLedger, FOLLOW_MS } = await import("../src/chain/callers.ts");
  const W = "BpuSMK3CtgAqiH6veEnZVh8NfHwT2ijJgJEAWYaFQNRL";
  const t0 = Date.parse("2026-11-10T00:00:00Z");
  const call = (post: number, mint: string, at: number, calledMcUsd = 10_000) => ({ post, mint, symbol: "X", text: "", caller: "anna", followers: 10, twitter: null, wallet: W, calledMcUsd, mcUsd: calledMcUsd, nth: 1, at, postedAt: at, url: "" });
  const calls = [call(1, "A", t0), call(2, "A", t0 + 60_000), call(3, "B", t0), call(4, "GONE", t0)];
  const state: Record<string, { capUsd: number | null; state: "alive" | "dead" | "between"; dumpedAt: number | null }> = { A: { capUsd: 12_000, state: "alive", dumpedAt: null }, B: { capUsd: 9_000, state: "alive", dumpedAt: null } };
  const ledger = new CallerLedger({
    callsSince: (since) => calls.filter((c) => c.at >= since),
    look: (mint) => state[mint] ?? null,
    // In 90 seconds before calling A, sold out 20 minutes after.
    buyer: (mint) => (mint === "A" ? { at: t0 - 90_000, exitAt: t0 + 20 * 60_000 } : null),
  });
  ledger.tick(t0 + 60_000);
  state.A!.capUsd = 40_000;
  ledger.tick(t0 + 30 * 60_000);
  state.A!.capUsd = 20_000;
  ledger.tick(t0 + 3_600_000 + 60_000);
  assert.equal(ledger.outcomeOf(1)!.h1Usd, 20_000);
  assert.equal(ledger.outcomeOf(1)!.peakUsd, 40_000);
  // A day on: A ended at half the called cap and alive, B was dumped by the dev and died.
  state.A!.capUsd = 5_000;
  state.B = { capUsd: 2_000, state: "dead", dumpedAt: t0 + 5 * 60_000 };
  ledger.tick(t0 + FOLLOW_MS + 61_000);
  const a = ledger.outcomeOf(1)!;
  assert.equal(a.done, true);
  assert.equal(a.endUsd, 5_000);
  assert.equal(ledger.outcomeOf(4), null, "a coin the tape never held is not followed");
  // Later looks change nothing.
  state.A!.capUsd = 900_000;
  ledger.tick(t0 + FOLLOW_MS + 30 * 60_000);
  assert.equal(ledger.outcomeOf(1)!.endUsd, 5_000);
  const r = ledger.recordOf(W, t0 + FOLLOW_MS + 31 * 60_000)!;
  assert.equal(r.calls, 4);
  assert.equal(r.coins, 3);
  assert.equal(r.settled, 2);
  assert.equal(r.dead, 1);
  assert.equal(r.alive, 1);
  assert.equal(r.up, 0);
  assert.equal(r.medianX, 0.35);
  assert.equal(r.bestX, 4);
  assert.equal(r.walletSeen, 1);
  assert.equal(r.boughtBefore, 1);
  assert.equal(r.soldWithinHour, 1);
  assert.equal(r.devDumpedAfter, 1);
});

test("a compact post whose head carries no call number is read with its caller and wallet", () => {
  const mint = "4imYg1JtbvaepB2oiep3Te6NW18M2h8pdEPo5BvYpump";
  const html = `<div class="tgme_widget_message" data-post="pumpfun_lp/1441567"><div class="tgme_widget_message_text js-message_text" dir="auto"><i class="emoji"><b>🚨</b></i> <b>CALLOUT</b> · <b>Dora the Backpacker (&#036;Dora)</b><br/><blockquote>yo</blockquote><br/><i class="emoji"><b>👤</b></i> <b>lollipop12</b> · 7,082 followers · <a href="https://x.com/Echoo99x">@Echoo99x</a><br/><i class="emoji"><b>💰</b></i> MC <b>&#036;8.8K</b> · called at &#036;9.4K · <b>0.94x</b><br/><i class="emoji"><b>🚀</b></i> Pump.fun 53% · <i class="emoji"><b>🕒</b></i> 1 minute ago<br/><code>${mint}</code><br/><i class="emoji"><b>💼</b></i> <code>CoDdw3cAX13dxwahw2C16ohsVhrDdrN3UVb4mvNLo9wD</code></div><div class="tgme_widget_message_footer"><time datetime="2026-11-17T14:53:14+00:00"></time></div></div>`;
  const c = parseChannel(html)[0]!;
  assert.equal(c.mint, mint);
  assert.equal(c.symbol, "Dora");
  assert.equal(c.text, "yo");
  assert.equal(c.caller, "lollipop12");
  assert.equal(c.followers, 7082);
  assert.equal(c.twitter, "@Echoo99x");
  assert.equal(c.wallet, "CoDdw3cAX13dxwahw2C16ohsVhrDdrN3UVb4mvNLo9wD");
  assert.equal(c.calledMcUsd, 9400);
  assert.equal(c.nth, null);
});

test("the channel's compact layout is read too, and a post kept without its caller is replaced by the whole one", () => {
  const mint = "2JikijgimhBc3xzzviEh4cJJEV3SzvKi6U8KJbVhpump";
  const html = `<div class="tgme_widget_message" data-post="pumpfun_lp/99"><div class="tgme_widget_message_text js-message_text" dir="auto"><i class="emoji"><b>🚨</b></i> <b>CALLOUT #3</b> · <b>Tim Chip (&#036;CHIP)</b><br/><blockquote>Tim chip is good</blockquote><br/><i class="emoji"><b>👤</b></i> <b>otis93finity</b> · 18,411 followers · <a href="https://x.com/Lolzmag274039">@Lolzmag274039</a><br/><i class="emoji"><b>💰</b></i> MC <b>&#036;6.1K</b> · called at &#036;1.25M · <b>0.78x</b><br/><i class="emoji"><b>🚀</b></i> Pump.fun 39% · <i class="emoji"><b>🕒</b></i> 1 minute ago<br/><code>${mint}</code><br/><i class="emoji"><b>💼</b></i> <code>GDRS2UQfxxzDtjSNFChFiUG4E3Eie8RNeb5dRHWTvBDN</code><br/><i>6 minutes ago: This should be runner</i></div><div class="tgme_widget_message_footer"><time datetime="2026-11-12T16:00:00+00:00"></time></div></div>`;
  const c = parseChannel(html)[0]!;
  assert.equal(c.mint, mint);
  assert.equal(c.symbol, "CHIP");
  assert.equal(c.text, "Tim chip is good");
  assert.equal(c.caller, "otis93finity");
  assert.equal(c.followers, 18411);
  assert.equal(c.twitter, "@Lolzmag274039");
  assert.equal(c.wallet, "GDRS2UQfxxzDtjSNFChFiUG4E3Eie8RNeb5dRHWTvBDN");
  assert.equal(c.calledMcUsd, 1_250_000);
  assert.equal(c.mcUsd, 6100);
  assert.equal(c.nth, 3);
  assert.equal(c.at, Date.parse("2026-11-12T15:59:00Z"));
  const feed = new CalloutFeed();
  feed.add([{ ...c, caller: "", wallet: null, followers: null, twitter: null, calledMcUsd: null }]);
  assert.equal(feed.add([c]), 1);
  assert.equal(feed.of(mint).length, 1);
  assert.equal(feed.of(mint)[0]!.caller, "otis93finity");
});
