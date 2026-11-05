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
  const fake = (async () => {
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
