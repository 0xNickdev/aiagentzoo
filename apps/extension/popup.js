// The toolbar popup: the X-Ray of this tab's token, or any token or wallet you paste, plus your alerts, recent tokens and the boards.
const { TONE, addresses, sym, short, ago, ask } = ZOO;
const { h } = ZooPanel;
const $ = (id) => document.getElementById(id);

function home() {
  $("out").replaceChildren();
  $("home").hidden = false;
  $("mint").value = "";
  void lists();
}
const opts = { onHome: home };

/** A pasted address is tried as a token first; one the stream never saw as a launch opens as a wallet. */
async function run(raw, quiet = false) {
  const addr = addresses(raw)[0];
  if (!addr) {
    $("out").replaceChildren(h("p", { class: "err" }, "Paste a Solana token or wallet address, or a link."));
    return;
  }
  $("mint").value = addr;
  $("go").disabled = true;
  $("home").hidden = true;
  $("out").replaceChildren(ZooPanel.skeleton());
  const r = await ask({ type: "xray", mint: addr });
  if (r?.report) {
    $("mint").value = r.report.mint;
    ZooPanel.render($("out"), r.report, opts);
  } else {
    const w = await ask({ type: "wallet", wallet: addr });
    if (w?.profile) ZooPanel.wallet($("out"), addr, opts);
    else if (quiet) home();
    else $("out").replaceChildren(h("p", { class: "err" }, r?.error || "Something went wrong."));
  }
  $("go").disabled = false;
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  void run($("mint").value);
});

const openWallet = (w) => {
  $("home").hidden = true;
  $("mint").value = w;
  ZooPanel.wallet($("out"), w, opts);
};

async function lists() {
  const { history = [], watched = {} } = await chrome.storage.local.get(["history", "watched"]);
  const w = Object.entries(watched);
  $("watch-wrap").hidden = !w.length;
  $("watch").replaceChildren(
    ...w.map(([mint, x]) =>
      h(
        "button",
        { class: "li", onclick: () => run(mint) },
        h("span", { class: "l" }, `$${sym(x.symbol)}`),
        h(
          "span",
          { class: "r mono" },
          `since ${ago(x.since)}`,
          h("span", { class: "rm", title: "Stop alerts", onclick: async (e) => { e.stopPropagation(); await ask({ type: "watch", mint, on: false }); void lists(); } }, "×"),
        ),
      ),
    ),
  );
  $("hist-wrap").hidden = !history.length;
  $("hist").replaceChildren(
    ...history.slice(0, 6).map((x) => {
      const t = TONE[x.verdict] || TONE.unknown;
      return h("button", { class: "li", onclick: () => run(x.mint) }, h("span", { class: "l" }, `$${sym(x.symbol)} `, h("small", { class: "mono" }, ago(x.at))), h("span", { class: "r v mono", style: { color: t.color } }, t.label));
    }),
  );
  const b = await ask({ type: "boards" });
  if (!b?.ruggers?.length && !b?.builders?.length) return;
  $("boards").hidden = false;
  $("rug").replaceChildren(
    ...(b.ruggers || []).map((x) => h("button", { class: "li", onclick: () => openWallet(x.wallet), title: "Open its page" }, h("span", { class: "l mono" }, short(x.wallet)), h("span", { class: "r mono bad" }, `dumped ${x.dumped} of ${x.launches48h}`))),
  );
  $("built").replaceChildren(
    ...(b.builders || []).map((x) => h("button", { class: "li", onclick: () => openWallet(x.wallet), title: "Open its page" }, h("span", { class: "l mono" }, short(x.wallet)), h("span", { class: "r mono good" }, `${x.graduated} graduated · ${x.dumped} dumped`))),
  );
}

// This tab's token: what the page script found, or the address in the tab's URL.
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs?.[0];
  const fromPage = tab?.id !== undefined ? (await ask({ type: "tabMint", tabId: tab.id }))?.mint : null;
  const fromUrl = addresses((tab?.url || "").replace(/^https?:\/\/[^/]+/, ""))[0];
  const mint = fromPage || fromUrl;
  // An address in the URL that is neither a launch nor a known wallet (a page on Solscan, say) falls back to the front page.
  if (mint) void run(mint, !fromPage);
  else {
    home();
    $("mint").focus();
  }
});
