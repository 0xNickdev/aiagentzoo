import assert from "node:assert/strict";
import { test } from "node:test";
import { commitCount, dexOf, githubLinks, readClaims, tiesOf, uriOfMetaplex, xHandle, type Deps } from "../src/claims/claims.ts";
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
