// The X-Ray of the token on the page you trade on: read the address from the tab, ask the zoo's chain reader, show the call.
const NORTH = "https://north-production-3f77.up.railway.app";
const SITE = "https://zooaiagency.com";
const BOT = "https://t.me/zooaiagency_bot";
const TONE = {
  avoid: { label: "AVOID", color: "#ff8a7e" },
  caution: { label: "CAUTION", color: "#f2d39b" },
  pass: { label: "NO RED FLAGS", color: "#9df3b0" },
  unknown: { label: "NOT ON THE STREAM", color: "#e9e4d8" },
};
const VENUE = { "pump.fun": "pump.fun", launchlab: "Raydium LaunchLab", dbc: "Meteora" };

const $ = (id) => document.getElementById(id);
const mintIn = (text) => (text || "").match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g)?.find((m) => m.length >= 32) ?? null;
const pct = (x) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x > 0 ? `${(x * 100).toFixed(1)}%` : "0%");
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function fact(k, v, sub, bad) {
  const d = el("div");
  d.append(el("span", "", k), el("b", bad ? "bad" : "", v), el("em", "", sub || " "));
  return d;
}

function show(r) {
  const c = r.check;
  const f = c.facts || {};
  const tone = TONE[c.verdict] || TONE.unknown;
  $("meta").textContent = [`$${(r.symbol || "").replace(/^\$/, "")}`, r.name, `${f.ageMin ?? 0} min old`, VENUE[f.venue || "pump.fun"], f.graduated ? "graduated" : "", f.mayhem ? "Mayhem Mode" : ""].filter(Boolean).join(" · ");
  $("verdict").textContent = tone.label;
  $("verdict").style.color = tone.color;
  const ul = $("reasons");
  ul.replaceChildren(...c.reasons.slice(0, 4).map((x) => {
    const li = el("li", "", x);
    li.style.setProperty("--c", tone.color);
    return li;
  }));
  const early = r.early || [];
  const took = early.reduce((n, e) => n + e.bought, 0);
  const holds = early.reduce((n, e) => n + e.held, 0);
  const rec = r.creatorRecord;
  const fund = r.funding;
  $("facts").replaceChildren(
    fact("the dev", rec ? `${rec.dumped} of ${rec.launches48h} dumped` : "first launch", f.creatorSoldPct == null ? "never bought their own" : `sold ${f.creatorSoldPct}% of their bag`, (rec?.dumped ?? 0) >= 2 || (f.creatorSoldPct ?? 0) >= 50),
    fact("first 5 seconds", early.length ? `${early.length} wallets` : "nobody", early.length ? `took ${pct(took)} · hold ${pct(holds)}` : "no one bought before it was visible", took >= 0.25),
    fact("dev's own wallets", String(f.creatorCrew ?? 0), `sniper ring ${f.ringWallets ?? 0} · serial ${f.serialSnipers ?? 0}`, (f.creatorCrew ?? 0) >= 2),
    fact("who paid the dev", !fund ? "tracing…" : !fund.funder ? "no transfer found" : fund.funderIsHot ? "an exchange" : fund.siblings.length ? `${fund.siblings.length} other devs` : "only this dev", fund?.funder && !fund.funderIsHot ? (fund.siblings.length ? `${fund.siblingDumped48h} dumps in 48h` : short(fund.funder)) : "", !!fund?.funder && !fund.funderIsHot && fund.siblingDumped48h >= 3),
  );
  $("full").href = `${SITE}/xray?mint=${r.mint}`;
  $("watch").href = `${BOT}?start=w-${r.mint}`;
  $("out").hidden = false;
}

let skeleton = null;
async function run(raw) {
  const mint = mintIn(raw);
  $("err").hidden = true;
  if (!mint) {
    $("err").textContent = "Paste a Solana token address or link.";
    $("err").hidden = false;
    return;
  }
  $("mint").value = mint;
  $("go").disabled = true;
  $("out").hidden = true;
  $("hint").hidden = true;
  skeleton ??= el("div", "skeleton");
  $("form").after(skeleton);
  try {
    let res = await fetch(`${NORTH}/v1/xray/${mint}`);
    if (res.status === 404) {
      // DexScreener and some terminals put the pool's address in the URL, not the token's: ask DexScreener which token it is.
      const pair = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${mint}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const token = pair?.pairs?.[0]?.baseToken?.address || pair?.pair?.baseToken?.address;
      if (token && token !== mint) {
        $("mint").value = token;
        res = await fetch(`${NORTH}/v1/xray/${token}`);
      }
    }
    if (res.status === 429) throw new Error("Ten x-rays a minute on the free tier. Try again in a minute.");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ? "Not a launch the stream saw in the last two days (pump.fun, LaunchLab, Meteora)." : "Something went wrong.");
    show(body);
  } catch (e) {
    $("err").textContent = e instanceof TypeError ? "The chain reader did not answer. Try again in a minute." : e.message;
    $("err").hidden = false;
  } finally {
    skeleton.remove();
    $("go").disabled = false;
  }
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  void run($("mint").value);
});

// The token of the page you are on: pump.fun, DexScreener, Birdeye, gmgn, Axiom, Photon, Solscan all carry it in the URL.
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const url = tabs?.[0]?.url || "";
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  const mint = mintIn(path);
  if (mint) void run(mint);
  else $("mint").focus();
});
