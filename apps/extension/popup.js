// The toolbar popup: the X-Ray of this tab's token, or any token or wallet you paste, plus your alerts, recent tokens and the boards.
const { TONE, addresses, sym, short, ago, ask } = ZOO;
const { h } = ZooPanel;
const $ = (id) => document.getElementById(id);

/** The popup's fixed text in the reader's language, plus the EN / 中文 switch, which saves the choice for every page. */
function localize() {
  const zh = lang() === "zh";
  document.documentElement.lang = zh ? "zh-CN" : "en";
  document.querySelectorAll("[data-t]").forEach((el) => {
    el.dataset.en ??= el.textContent;
    el.textContent = t(el.dataset.en);
  });
  document.querySelectorAll("[data-t-ph]").forEach((el) => {
    el.dataset.en ??= el.placeholder;
    el.placeholder = t(el.dataset.en);
  });
  document.querySelectorAll("[data-t-label]").forEach((el) => {
    el.dataset.en ??= el.getAttribute("aria-label");
    el.setAttribute("aria-label", t(el.dataset.en));
  });
  document.querySelectorAll("#lang [data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang())));
}
document.querySelectorAll("#lang [data-lang]").forEach((b) =>
  b.addEventListener("click", async () => {
    if (b.dataset.lang === lang()) return;
    await chrome.storage.local.set({ lang: b.dataset.lang });
    location.reload();
  }),
);

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
    $("out").replaceChildren(h("p", { class: "err" }, t("Paste a Solana token or wallet address, or a link.")));
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
    else $("out").replaceChildren(h("p", { class: "err" }, r?.error || t("Something went wrong.")));
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
          t("since {t}", { t: ago(x.since) }),
          h("span", { class: "rm", title: t("Stop alerts"), onclick: async (e) => { e.stopPropagation(); await ask({ type: "watch", mint, on: false }); void lists(); } }, "×"),
        ),
      ),
    ),
  );
  $("hist-wrap").hidden = !history.length;
  $("hist").replaceChildren(
    ...history.slice(0, 6).map((x) => {
      const tone = TONE[x.verdict] || TONE.unknown;
      return h("button", { class: "li", onclick: () => run(x.mint) }, h("span", { class: "l" }, `$${sym(x.symbol)} `, h("small", { class: "mono" }, ago(x.at))), h("span", { class: "r v mono", style: { color: tone.color } }, tone.label));
    }),
  );
  const b = await ask({ type: "boards" });
  if (!b?.ruggers?.length && !b?.builders?.length) return;
  $("boards").hidden = false;
  $("rug").replaceChildren(
    ...(b.ruggers || []).map((x) => h("button", { class: "li", onclick: () => openWallet(x.wallet), title: t("Open its page") }, h("span", { class: "l mono" }, short(x.wallet)), h("span", { class: "r mono bad" }, t("dumped {a} of {b}", { a: x.dumped, b: x.launches48h })))),
  );
  $("built").replaceChildren(
    ...(b.builders || []).map((x) => h("button", { class: "li", onclick: () => openWallet(x.wallet), title: t("Open its page") }, h("span", { class: "l mono" }, short(x.wallet)), h("span", { class: "r mono good" }, t("{g} graduated · {d} dumped", { g: x.graduated, d: x.dumped })))),
  );
}

// This tab's token: what the page script found, or the address in the tab's URL.
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  await ZOO_LANG_READY;
  localize();
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
