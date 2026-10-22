// The extension's one place that talks to the zoo: cached reads, the toolbar colour per tab, right click, and watch alerts.
// Through the site, so the nodes can move house without a new extension release.
importScripts("shared.js"); // t(), tChain() and the reader's language
const NORTH = "https://zooaiagency.com/api/north";
const SITE = "https://zooaiagency.com";
const TONE = {
  avoid: { get label() { return t("AVOID"); }, badge: "!!", bg: "#d9584b" },
  caution: { get label() { return t("CAUTION"); }, badge: "!", bg: "#b8913f" },
  pass: { get label() { return t("NO RED FLAGS"); }, badge: "ok", bg: "#3f8f55" },
};
const B58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

const cache = new Map();
/** One read per token per minute or so: the free tier is generous for checks, tight for full x-rays. */
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  return v;
}

const getJson = async (url) => {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
};

/** DexScreener and most terminals put a pool's address in the URL, not the token's: ask DexScreener which token it is. */
const tokenOfPair = (addr) =>
  cached(`pair:${addr}`, 3_600_000, async () => {
    try {
      const { ok, body } = await getJson(`https://api.dexscreener.com/latest/dex/pairs/solana/${addr}`);
      const p = ok ? body.pairs?.[0] ?? body.pair : null;
      return p?.baseToken?.address ?? null;
    } catch {
      return null;
    }
  });

/** The light check (verdict and reasons). An address the stream never saw is tried as a pool before giving up. */
async function check(addr) {
  const read = (m) => cached(`check:${m}`, 60_000, async () => (await getJson(`${NORTH}/v1/check/${m}?holders=1`)).body);
  let c = await read(addr);
  let mint = addr;
  if (!c || c.verdict === "unknown") {
    const token = await tokenOfPair(addr);
    if (token && token !== addr) {
      const c2 = await read(token);
      if (c2 && c2.verdict !== "unknown") ((c = c2), (mint = token));
    }
  }
  return { mint, check: c };
}

async function xray(addr) {
  const { mint } = await check(addr);
  return cached(`xray:${mint}`, 90_000, async () => {
    const { status, ok, body } = await getJson(`${NORTH}/v1/xray/${mint}`);
    if (status === 429) return { error: t("Ten full x-rays a minute on the free tier. Try again in a minute.") };
    if (!ok) return { error: t("Not a launch the stream saw in the last two days (pump.fun, LaunchLab, Meteora).") };
    void remember(body);
    return { report: body };
  }).then((r) => {
    if (r.error) cache.delete(`xray:${mint}`);
    return r;
  });
}

/** A wallet's page: what it did as a dev, as a first-second buyer and as the one who pays for devs. */
const wallet = (w) =>
  cached(`wallet:${w}`, 60_000, async () => {
    const { status, ok, body } = await getJson(`${NORTH}/v1/wallet/${w}`);
    if (status === 429) return { error: t("Too many lookups this minute. Try again in a minute.") };
    if (!ok) return { error: t("This wallet did not launch, snipe or fund a launch the stream saw in the last two days.") };
    return { profile: body };
  }).then((r) => {
    if (r.error) cache.delete(`wallet:${w}`);
    return r;
  });

/** The worst devs and the builders of the last two days, for the popup's front page. */
const boards = () =>
  cached("boards", 300_000, async () => {
    const [rug, built] = await Promise.all([getJson(`${NORTH}/v1/chain/ruggers?limit=3`), getJson(`${NORTH}/v1/chain/builders?limit=3`)]);
    return { ruggers: rug.body.ruggers ?? [], builders: built.body.builders ?? [] };
  }).catch(() => ({ ruggers: [], builders: [] }));

/** The last tokens you looked at, for the popup. */
async function remember(r) {
  const { history = [] } = await chrome.storage.local.get("history");
  const item = { mint: r.mint, symbol: r.symbol, verdict: r.check.verdict, at: Date.now() };
  await chrome.storage.local.set({ history: [item, ...history.filter((h) => h.mint !== r.mint)].slice(0, 12) });
}

function badge(tabId, verdict, title) {
  const tone = TONE[verdict];
  chrome.action.setBadgeText({ tabId, text: tone ? tone.badge : "" });
  if (tone) chrome.action.setBadgeBackgroundColor({ tabId, color: tone.bg });
  chrome.action.setTitle({ tabId, title: tone ? `ZOOAI X-Ray · ${tone.label}${title ? ` · ${tChain(title)}` : ""}` : "ZOOAI X-Ray" });
}

const tabMint = new Map();

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === "check") {
      const r = await check(msg.mint);
      if (sender.tab?.id !== undefined && msg.page) {
        if (r.check && r.check.verdict !== "unknown") {
          tabMint.set(sender.tab.id, r.mint);
          badge(sender.tab.id, r.check.verdict, r.check.reasons?.[0]);
        } else badge(sender.tab.id, null);
      }
      return r;
    }
    if (msg.type === "clear" && sender.tab?.id !== undefined) {
      tabMint.delete(sender.tab.id);
      badge(sender.tab.id, null);
      return { ok: true };
    }
    if (msg.type === "xray") return xray(msg.mint);
    if (msg.type === "tabMint") return { mint: tabMint.get(msg.tabId) ?? null };
    if (msg.type === "sniper") return cached(`sniper:${msg.wallet}`, 120_000, async () => (await getJson(`${NORTH}/v1/chain/sniper/${msg.wallet}`)).body);
    if (msg.type === "wallet") return wallet(msg.wallet);
    if (msg.type === "boards") return boards();
    if (msg.type === "watch") return watch(msg.mint, msg.symbol, msg.on);
    if (msg.type === "watching") {
      const { watched = {} } = await chrome.storage.local.get("watched");
      return { watched };
    }
    return { error: "unknown message" };
  })()
    .then(reply)
    .catch((e) => reply({ error: String(e?.message || e) }));
  return true;
});

chrome.tabs.onRemoved.addListener((id) => tabMint.delete(id));

// Right click on any selected address, anywhere: open its x-ray.
chrome.runtime.onInstalled.addListener(async () => {
  await ZOO_LANG_READY;
  chrome.contextMenus.create({ id: "xray", title: t("X-Ray this token"), contexts: ["selection", "link"] });
});
// The menu follows the popup's language switch.
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.lang) chrome.contextMenus.update("xray", { title: t("X-Ray this token") }, () => void chrome.runtime.lastError);
});
chrome.contextMenus.onClicked.addListener((info) => {
  const m = String(info.selectionText || info.linkUrl || "").match(B58)?.[0];
  chrome.tabs.create({ url: m ? `${SITE}/xray?mint=${m}` : `${SITE}/xray` });
});

// Watching: the browser tells you when the dev sells, the pool is drained or it graduates. Read once a minute.
async function watch(mint, symbol, on) {
  const { watched = {} } = await chrome.storage.local.get("watched");
  if (on) watched[mint] = { symbol, since: Date.now(), seq: 0 };
  else delete watched[mint];
  await chrome.storage.local.set({ watched });
  if (Object.keys(watched).length) chrome.alarms.create("watch", { periodInMinutes: 1 });
  else chrome.alarms.clear("watch");
  return { ok: true, watched };
}

const SAY = { dump: "the dev sold", drained: "the pool was drained", graduated: "it graduated", whale: "a whale bought" }; // English keys for t()
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "watch") return;
  const { watched = {} } = await chrome.storage.local.get("watched");
  const now = Date.now();
  for (const [mint, w] of Object.entries(watched)) {
    if (now - w.since > 48 * 3_600_000) {
      delete watched[mint];
      continue;
    }
    try {
      await ZOO_LANG_READY;
      const { body } = await getJson(`${NORTH}/v1/chain/moments?mint=${mint}&limit=20`);
      const fresh = (body.moments || []).filter((e) => e.at > w.since && e.seq > (w.seq || 0) && SAY[e.kind]).sort((x, y) => x.seq - y.seq);
      for (const e of fresh) {
        chrome.notifications.create(`${mint}:${e.seq}`, {
          type: "basic",
          iconUrl: "icons/128.png",
          title: `$${String(e.symbol || w.symbol || "?").replace(/^\$+/, "")}: ${t(SAY[e.kind])}`,
          message: tChain(e.text),
          priority: e.kind === "dump" || e.kind === "drained" ? 2 : 0,
        });
        w.seq = Math.max(w.seq || 0, e.seq);
      }
    } catch {
      /* the next minute tries again */
    }
  }
  await chrome.storage.local.set({ watched });
  if (!Object.keys(watched).length) chrome.alarms.clear("watch");
});
chrome.notifications.onClicked.addListener((id) => {
  const mint = id.split(":")[0];
  chrome.tabs.create({ url: `${SITE}/xray?mint=${mint}` });
});
