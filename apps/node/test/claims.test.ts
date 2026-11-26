import assert from "node:assert/strict";
import { test } from "node:test";
import { commitCount, commitDays, dexOf, githubLinks, readClaims, tiesOf, uriOfMetaplex, xHandle, type Deps } from "../src/claims/claims.ts";
import { contractsIn, telegramCard, telegramClaim, telegramName, telegramPosts, XBook, xClaimOf } from "../src/claims/social.ts";
import { publicAddress, safeFetch, safeUrl } from "../src/claims/safeFetch.ts";

const MINT = "2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B";
const NOW = Date.parse("2026-11-24T12:00:00Z");

test("a stranger's page is only opened when it is on the public internet", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.18.0.2", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2002:7f00:1::", "64:ff9b::7f00:1", "junk"]) assert.equal(publicAddress(ip), false, ip);
  for (const ip of ["1.1.1.1", "140.82.121.4", "2606:4700::1111"]) assert.equal(publicAddress(ip), true, ip);
  for (const u of ["http://a.com", "https://a.com:8443/", "https://u:p@a.com", "https://127.0.0.1/", "https://[::1]/", "https://localhost/", "https://zoo-north/", "https://x.internal/", "ftp://a.com", "https://2130706433/"]) assert.equal(safeUrl(u), null, u);
  assert.ok(safeUrl("https://zooaiagency.com/x"));
  assert.equal(await safeFetch("https://localhost/"), null);
});

test("GitHub links are found, GitHub's own pages are not", () => {
  assert.deepEqual(githubLinks("see https://github.com/about and github.com/0xNickdev then https://www.github.com/0xNickdev/aiagentzoo.git."), [{ owner: "0xNickdev", repo: "aiagentzoo" }, { owner: "0xNickdev", repo: null }]);
  assert.deepEqual(githubLinks("https://github.com/features/actions"), []);
  assert.equal(xHandle("https://x.com/ZooClawAgency?s=20"), "zooclawagency");
  assert.equal(xHandle("https://x.com/elonmusk/status/1"), null);
});

test("a tie is the mint, the token's own site or its X account, never a look-alike or a shared host", () => {
  const t = { mint: MINT, website: "https://www.zooaiagency.com/", x: "zoo" };
  assert.deepEqual(tiesOf(`CA ${MINT}, https://zooaiagency.com/docs, https://x.com/zoo`, t), ["mint", "website", "x"]);
  assert.deepEqual(tiesOf("https://zooaiagency.com.evil.io notzooaiagency.com x.com/zoology me@zoo @zoo.dev/pkg".replace("@zoo.dev/pkg", ""), t), []);
  assert.deepEqual(tiesOf("hosted on vercel.app", { ...t, website: "https://vercel.app", x: null }), []);
});

test("the paid profile is read from DexScreener's orders, and silence is not 'unpaid'", () => {
  assert.deepEqual(dexOf({ status: 200, body: { orders: [{ type: "tokenProfile", status: "approved", paymentTimestamp: 5 }], boosts: [{}] } }), { paid: true, paidAt: 5, boosts: 1 });
  assert.deepEqual(dexOf({ status: 200, body: { orders: [], boosts: [] } }), { paid: false });
  assert.deepEqual(dexOf({ status: 200, body: { orders: [{ type: "tokenProfile", status: "processing" }] } }), { paid: false, pending: true });
  assert.deepEqual(dexOf({ status: 200, body: [{ type: "communityTakeover", status: "approved" }] }), { paid: false, takeover: true });
  assert.deepEqual(dexOf({ status: 429, body: {} }), { paid: null });
  assert.deepEqual(dexOf(null), { paid: null });
});

test("commits come from the last page number", () => {
  assert.equal(commitCount({ status: 200, body: [{}], link: '<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/commits?per_page=1&page=613>; rel="last"' }), 613);
  assert.equal(commitCount({ status: 200, body: [{}], link: null }), 1);
  assert.equal(commitCount({ status: 409, body: {}, link: null }), 0);
  assert.equal(commitCount({ status: 403, body: {}, link: null }), null);
});

test("the uri is read out of a Metaplex account", () => {
  const s = (v: string, pad: number) => { const b = Buffer.alloc(4 + pad); b.writeUInt32LE(pad, 0); b.write(v, 4); return b; };
  assert.equal(uriOfMetaplex(Buffer.concat([Buffer.alloc(65), s("Name", 32), s("SYM", 10), s("https://a.b/c.json", 200)])), "https://a.b/c.json");
  assert.equal(uriOfMetaplex(Buffer.alloc(10)), null);
});

const repo = (over: object = {}) => ({ full_name: "o/r", name: "r", description: null, homepage: null, fork: false, archived: false, size: 50, stargazers_count: 9, language: "TypeScript", created_at: "2026-01-01T00:00:00Z", pushed_at: "2026-11-20T00:00:00Z", default_branch: "main", owner: { login: "o" }, ...over });
const world = (over: { meta?: Record<string, unknown> | null; repo?: object; repoStatus?: number; readme?: string | null; site?: string; commits?: string | null } = {}): Deps => ({
  now: () => NOW,
  book: new XBook(null),
  lineUsd: () => 6_000,
  metadata: async () => (over.meta === undefined ? { website: "https://token.example", twitter: "https://x.com/tok", description: "code: https://github.com/o/r" } : over.meta),
  page: async (u) => {
    if (u.includes("raw.githubusercontent.com")) return over.readme === null ? null : { status: 200, url: u, body: over.readme ?? "" };
    return over.site === undefined ? null : { status: 200, url: u, body: over.site };
  },
  json: async (u) => {
    if (u.includes("dexscreener.com/tokens")) return { status: 200, body: [], link: null };
    if (u.includes("dexscreener.com/orders")) return { status: 200, body: { orders: [] }, link: null };
    if (u.includes("/commits")) return { status: 200, body: [{}], link: over.commits === undefined ? '<https://x/?page=40>; rel="last"' : over.commits };
    if (u.includes("/users/")) return { status: 200, body: { created_at: "2020-01-01T00:00:00Z" }, link: null };
    return { status: over.repoStatus ?? 200, body: repo(over.repo), link: null };
  },
});

test("a repository that names the mint is the token's; a famous one that never heard of it is not", async () => {
  const own = await readClaims(MINT, world({ readme: `CA: ${MINT}` }));
  assert.equal(own.github.status, "mutual");
  assert.deepEqual(own.github.tiedBy, ["mint"]);
  assert.equal(own.github.commits, 40);
  assert.deepEqual(own.github.flags, []);
  const borrowed = await readClaims(MINT, world({ readme: "a famous project" }));
  assert.equal(borrowed.github.status, "oneway");
  assert.match(borrowed.github.flags[0]!, /does not mention this token/);
});

test("a dead link, GitHub's limit and no link at all are three different answers", async () => {
  assert.equal((await readClaims(MINT, world({ repoStatus: 404 }))).github.status, "broken");
  assert.equal((await readClaims(MINT, world({ repoStatus: 403 }))).github.status, "unread");
  const none = await readClaims(MINT, world({ meta: {} }));
  assert.equal(none.github.status, "none");
  const unreadable = await readClaims(MINT, world({ meta: null }));
  assert.equal(unreadable.metadataRead, false);
});

test("an empty shell says so: a fresh fork with one commit and no code", async () => {
  const c = await readClaims(MINT, world({ readme: "", commits: null, repo: { fork: true, parent: { full_name: "famous/thing" }, language: null, created_at: "2026-11-24T02:00:00Z" } }));
  assert.deepEqual(c.github.flags.slice(1), ["it is a fork of famous/thing", "only 1 commit", "no code GitHub recognizes, only text or media", "created 10 h ago"]);
  const blind = await readClaims(MINT, world({ readme: null }));
  assert.match(blind.github.flags[0]!, /README could not be read/);
});

test("with no link of its own, the token's site is read for one", async () => {
  const c = await readClaims(MINT, world({ meta: { website: "https://token.example" }, site: '<a href="https://github.com/o/r">code</a>', readme: "see https://token.example" }));
  assert.equal(c.github.foundIn, "website");
  assert.deepEqual(c.github.tiedBy, ["website"]);
  assert.equal(c.websiteRead, true);
  // A coin that links someone else's article: their repository names their site, nobody names the coin.
  assert.equal(c.github.status, "related");
  const own = await readClaims(MINT, world({ meta: { website: "https://token.example" }, site: `<a href="https://github.com/o/r">code</a> CA ${MINT}`, readme: "see https://token.example" }));
  assert.equal(own.github.status, "mutual");
});

test("a site drawn in the browser is read from its own scripts, and libraries named there are not the token's", async () => {
  const { ownScripts } = await import("../src/claims/claims.ts");
  assert.deepEqual(ownScripts('<script src="/a.js"></script><script type=module src="https://cdn.x/b.js"></script>', "https://token.example/p"), ["https://token.example/a.js"]);
  const w = (readme: string) => {
    const base = world({ meta: { website: "https://token.example" }, readme });
    return { ...base, page: async (u: string) => (u.endsWith("/a.js") ? { status: 200, url: u, body: `x="https://github.com/o/r";ca="${MINT}"` } : u.includes("raw.") ? base.page(u) : { status: 200, url: "https://token.example/", body: '<script src="/a.js"></script>' }) };
  };
  assert.equal((await readClaims(MINT, w("a library"))).github.status, "none");
  assert.equal((await readClaims(MINT, w("see https://token.example"))).github.status, "mutual");
});

test("the bot says it in two lines, and says nothing about what it could not read", async () => {
  const { claimsLines } = await import("../src/telegram.ts");
  const { inLang } = await import("../src/tg-i18n.ts");
  const c = await readClaims(MINT, world({ readme: "a famous project" }));
  const en = inLang("en", () => claimsLines({ ...c, dex: { paid: true, paidAt: 720_000 } }, 0));
  assert.match(en[0]!, /⚠️ <a href="https:\/\/github\.com\/o\/r">o\/r<\/a> · does not mention this token · 40 commits/);
  assert.match(en[1]!, /paid/);
  assert.match(inLang("en", () => claimsLines({ ...c, dex: { paid: true, paidAt: 1_720_000 } }, 1_000_000)).at(-1)!, /paid, 12 min after launch/);
  assert.deepEqual(inLang("en", () => claimsLines({ ...c, metadataRead: false, github: { status: "none", flags: [] }, dex: { paid: null } })), []);
  assert.doesNotMatch(inLang("zh", () => claimsLines(c).join(" ")), /token|commits|paid/);
});

const A = "A".repeat(38) + "pump";
const B = "B".repeat(38) + "pump";

test("an X account is the token's only when it names the mint, and a rename shows by its id", () => {
  const book = new XBook(null);
  const tie = (w: string) => (w.includes(MINT) ? ("mutual" as const) : ("oneway" as const));
  const user = (over: object) => ({ status: 200, body: { user: { id: "7", screen_name: "Tok", followers: 10, tweets: 3, description: "", joined: "Fri Oct 09 09:04:40 +0000 2020", ...over } } });
  assert.equal(xClaimOf("tok", user({ description: `CA ${MINT}` }), tie, NOW, book).status, "mutual");
  assert.equal(xClaimOf("tok", user({}), tie, NOW, book).status, "oneway");
  const renamed = xClaimOf("new", user({ screen_name: "New", joined: "Sat Nov 21 12:00:00 +0000 2026" }), tie, NOW, book);
  assert.deepEqual(renamed.was, ["tok"]);
  assert.deepEqual(renamed.flags, ["the X account was @tok before", "the X account is 3 days old"]);
  // The same account read twice is not a rename.
  assert.equal(xClaimOf("new", user({ screen_name: "New" }), tie, NOW, new XBook(null)).was, undefined);
  assert.equal(xClaimOf("gone", { status: 404, body: null }, tie, NOW, book).status, "unread");
  assert.equal(xClaimOf(null, null, tie, NOW, book).status, "none");
});

test("a Telegram name, its public card and its posts are read; wallets and quoted replies are not contracts", () => {
  assert.equal(telegramName(["https://x.com/a", "https://t.me/s/Tok_Chan?x=1"]), "Tok_Chan");
  assert.equal(telegramName(["https://t.me/+AbCdEf123", "https://t.me/joinchat/abc", "https://notat.me/abcd"]), null);
  assert.deepEqual(telegramCard('<div class="tgme_page_extra">1 498 subscribers</div><a href="/s/Tok">', "tok"), { members: 1498, about: "", channel: true });
  assert.equal(telegramCard('<div class="tgme_page_extra">271 members, 32 online</div>', "g")!.channel, false);
  assert.equal(telegramCard("<html></html>", "nobody"), null);
  assert.deepEqual(contractsIn(`${A} ${A} So11111111111111111111111111111111111111112 xxxxx${B}`), [A]);
  const html = `<div class="tgme_widget_message_wrap x"><div class="tgme_widget_message_text js-message_reply_text">${B}</div><div class="tgme_widget_message_text js-message_text" dir="auto">buy <code>${A}</code></div><time datetime="2026-11-20T00:00:00+00:00"></time></div><link rel="prev" href="/s/tok?before=40">`;
  const got = telegramPosts(html);
  assert.equal(got.before, "40");
  assert.equal(got.posts.length, 1);
  assert.deepEqual(contractsIn(got.posts[0]!.text), [A]);
});

test("a channel's other contracts are counted against the market; an unanswered market is not 'dead'", async () => {
  const post = (m: string) => `<div class="tgme_widget_message_wrap x"><div class="tgme_widget_message_text js-message_text">${m}</div><time datetime="2026-11-20T00:00:00+00:00"></time></div>`;
  const deps = (market: { status: number; body: unknown } | null) => ({
    now: () => NOW,
    lineUsd: () => 6_000,
    page: async (u: string) => ({ status: 200, url: u, body: u.includes("/s/") ? post(A) + post(B) + post(MINT) : '<div class="tgme_page_extra">50 subscribers</div><a href="/s/tok">' }),
    json: async () => (market ? { ...market, link: null } : null),
  });
  const tie = () => "oneway" as const;
  const c = await telegramClaim("tok", MINT, tie, deps({ status: 200, body: [{ baseToken: { address: A }, marketCap: 90_000, liquidity: { usd: 9_000 } }, { baseToken: { address: B }, marketCap: 5e6, liquidity: { usd: 3 } }] }));
  assert.deepEqual([c.status, c.contracts, c.under, c.posts], ["channel", 2, 1, 3]);
  const blind = await telegramClaim("tok", MINT, tie, deps(null));
  assert.equal(blind.under, undefined);
  assert.equal(blind.contracts, 2);
});

test("X's mirror is asked again when it says a living account is gone", async () => {
  const { readX } = await import("../src/claims/claims.ts");
  let n = 0;
  const json = async () => (++n < 3 ? { status: 404, body: null, link: null } : { status: 200, body: { user: { id: "1" } }, link: null });
  assert.equal((await readX("flaky", { json, now: () => NOW }))?.status, 200);
  assert.equal(n, 3);
  await readX("flaky", { json, now: () => NOW });
  assert.equal(n, 3);
  assert.equal(await readX("gone", { json: async () => ({ status: 404, body: null, link: null }), now: () => NOW }), null);
});

test("commit days put each commit on its UTC day, today last, and say how recent the work is", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  const at = (d: string) => ({ commit: { committer: { date: d } } });
  const r = commitDays({ status: 200, body: [at("2026-11-26T01:00:00Z"), at("2026-11-26T02:00:00Z"), at("2026-11-20T23:59:00Z"), at("2026-10-01T00:00:00Z"), at("bad")] }, now);
  assert.equal(r.days!.length, 30);
  assert.equal(r.days![29], 2);
  assert.equal(r.days![23], 1);
  assert.equal(r.days!.reduce((a, b) => a + b, 0), 3);
  assert.equal(r.lastCommitAt, Date.parse("2026-11-26T02:00:00Z"));
  assert.deepEqual(commitDays({ status: 409, body: null }, now).days, Array(30).fill(0));
  assert.deepEqual(commitDays(null, now), {});
});

test("post vs chain: a channel saying the dev is holding after the dev wallet sold is reported with both times", async () => {
  const { heldVsSold, holdingSaid } = await import("../src/claims/social.ts");
  const { devSellsFrom } = await import("../src/claims/claims.ts");
  for (const s of ["Dev is holding, relax", "we're still holding", "dev won't sell", "NOT SELLING a single token", "LP locked for a year", "never selling"]) assert.ok(holdingSaid(s), s);
  for (const s of ["buy now", "holders are up 3x", "sell the news", "unlocking soon"]) assert.equal(holdingSaid(s), null, s);
  const launch = Date.UTC(2026, 10, 26, 13, 40);
  const sells = { createdAt: launch, soldPct: 80, firstSec: 600, mainSec: 900 }; // sold past half at 13:55
  const posts = [
    { at: Date.UTC(2026, 10, 26, 13, 45), text: "dev won't sell, we are here for the long run" },
    { at: Date.UTC(2026, 10, 26, 14, 2), text: "Relax, dev is holding 💎" },
    { at: Date.UTC(2026, 10, 26, 14, 5), text: "new meme incoming" },
    { at: Date.UTC(2026, 10, 25, 9, 0), text: "dev holding" }, // before launch: another coin
  ];
  const r = heldVsSold(posts, sells);
  assert.equal(r.claims.length, 2);
  assert.deepEqual(r.claims.map((c) => c.afterSell), [true, false]);
  assert.equal(r.flags[0], "the channel posted 'Relax, dev is holding 💎' at 14:02 UTC; the dev wallet sold 80% at 13:55 UTC");
  // A dev who has not sold: nothing to say.
  assert.deepEqual(heldVsSold(posts, { ...sells, soldPct: 0 }), { claims: [], flags: [] });
  assert.deepEqual(heldVsSold(posts, null), { claims: [], flags: [] });

  // The marsh reads the sells from north's check.
  const north = (async () => Response.json({ createdAt: launch, facts: { creatorSoldPct: 80, devSell: { firstSec: 600, mainSec: 900 } } })) as unknown as typeof fetch;
  assert.deepEqual(await devSellsFrom("http://north", MINT, north), sells);
  assert.equal(await devSellsFrom(null, MINT, north), null);

  // Wired through the channel read.
  const post = (at: number, m: string) => `<div class="tgme_widget_message_wrap x"><div class="tgme_widget_message_text js-message_text">${m}</div><time datetime="${new Date(at).toISOString()}"></time></div>`;
  const c = await telegramClaim("tok", MINT, () => "oneway" as const, {
    now: () => NOW,
    lineUsd: () => null,
    page: async (u: string) => ({ status: 200, url: u, body: u.includes("/s/") ? post(posts[1]!.at, posts[1]!.text) : '<div class="tgme_page_extra">50 subscribers</div><a href="/s/tok">' }),
    json: async () => null,
    devSells: async () => sells,
  });
  assert.equal(c.heldClaims?.[0]?.afterSell, true);
  assert.match(c.flags.join(" "), /posted 'Relax, dev is holding 💎' at 14:02 UTC; the dev wallet sold 80% at 13:55 UTC/);
});
