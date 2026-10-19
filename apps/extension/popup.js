// The toolbar popup: the X-Ray of this tab's token, or any address you paste, plus your recent tokens and alerts.
const { TONE, addresses, sym, ask } = ZOO;
const { h } = ZooPanel;
const $ = (id) => document.getElementById(id);

async function run(raw) {
  const mint = addresses(raw)[0];
  if (!mint) {
    $("out").replaceChildren(h("p", { class: "err" }, "Paste a Solana token address or link."));
    return;
  }
  $("mint").value = mint;
  $("go").disabled = true;
  $("home").hidden = true;
  $("out").replaceChildren(h("div", { class: "skeleton" }));
  const r = await ask({ type: "xray", mint });
  $("go").disabled = false;
  if (r?.report) {
    $("mint").value = r.report.mint;
    ZooPanel.render($("out"), r.report);
  } else $("out").replaceChildren(h("p", { class: "err" }, r?.error || "Something went wrong."));
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  void run($("mint").value);
});

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

async function home() {
  const { history = [], watched = {} } = await chrome.storage.local.get(["history", "watched"]);
  const w = Object.entries(watched);
  $("watch-wrap").hidden = !w.length;
  $("watch").replaceChildren(
    ...w.map(([mint, x]) =>
      h(
        "div",
        { class: "row", onclick: () => run(mint) },
        h("span", { class: "s" }, `$${sym(x.symbol)}`),
        h("span", { class: "t" }, `since ${ago(x.since)}`),
        h("button", { class: "rm", title: "Stop alerts", onclick: async (e) => { e.stopPropagation(); await ask({ type: "watch", mint, on: false }); void home(); } }, "×"),
      ),
    ),
  );
  $("hist-wrap").hidden = !history.length;
  $("hist").replaceChildren(
    ...history.slice(0, 8).map((x) =>
      h(
        "button",
        { class: "row", onclick: () => run(x.mint) },
        h("span", { class: "s" }, `$${sym(x.symbol)}`),
        h("span", { class: "v", style: { color: (TONE[x.verdict] || TONE.unknown).color } }, (TONE[x.verdict] || TONE.unknown).label),
        h("span", { class: "t" }, ago(x.at)),
      ),
    ),
  );
}

// This tab's token: what the page script found, or the address in the tab's URL.
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs?.[0];
  const fromPage = tab?.id !== undefined ? (await ask({ type: "tabMint", tabId: tab.id }))?.mint : null;
  const fromUrl = addresses((tab?.url || "").replace(/^https?:\/\/[^/]+/, ""))[0];
  const mint = fromPage || fromUrl;
  if (mint) void run(mint);
  else {
    void home();
    $("mint").focus();
  }
});
