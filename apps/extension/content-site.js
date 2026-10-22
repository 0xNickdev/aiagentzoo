// On a trading page: find the token in the URL, colour the toolbar icon, and show a small X-Ray pill that opens into the report.
(() => {
  if (window.__zooXray) return;
  window.__zooXray = true;
  const { TONE, addresses, sym, ask } = ZOO;
  const { h } = ZooPanel;

  // The fonts live in the extension, so the panel looks the same on every site.
  const fonts = document.createElement("style");
  fonts.textContent = `@font-face{font-family:ZooGeist;src:url(${chrome.runtime.getURL("fonts/geist.woff2")}) format("woff2");font-weight:100 900;font-display:swap}@font-face{font-family:ZooGeistMono;src:url(${chrome.runtime.getURL("fonts/geist-mono.woff2")}) format("woff2");font-weight:100 900;font-display:swap}`;
  document.documentElement.append(fonts);

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  const css = document.createElement("style");
  fetch(chrome.runtime.getURL("panel.css"))
    .then((r) => r.text())
    .then((t) => (css.textContent = t + SHELL));
  const SHELL = `
    .wrap { display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
    .wrap .pill { all:unset; display:flex; align-items:center; gap:10px; max-width:360px; height:36px; padding:0 14px 0 12px; border-radius:10px; cursor:pointer; box-sizing:border-box;
      background:rgba(14,14,16,.94); box-shadow:inset 0 0 0 1px rgba(255,255,255,.12), 0 10px 34px rgba(0,0,0,.5); backdrop-filter:blur(12px);
      font:500 12px/1 ZooGeist, -apple-system, sans-serif; color:#eeede9; transition:box-shadow .15s ease, transform .15s ease; }
    .wrap .pill:hover { transform:translateY(-1px); box-shadow:inset 0 0 0 1px rgba(255,255,255,.22), 0 12px 38px rgba(0,0,0,.55); }
    .wrap .pill .dot { position:relative; width:7px; height:7px; border-radius:50%; flex:0 0 7px; }
    .wrap .pill .dot::after { content:""; position:absolute; inset:-4px; border-radius:50%; border:1px solid currentColor; opacity:.35; }
    .wrap .pill .brand { flex:none; white-space:nowrap; font:500 9.5px ZooGeistMono, ui-monospace, monospace; letter-spacing:.18em; color:rgba(238,237,233,.45); }
    .wrap .pill .bar { width:1px; height:14px; background:rgba(255,255,255,.12); }
    .wrap .pill .v { flex:none; white-space:nowrap; font:500 11px ZooGeistMono, ui-monospace, monospace; letter-spacing:.1em; }
    .wrap .pill .why { font-weight:400; color:rgba(238,237,233,.6); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
    .card { width:380px; max-height:min(78vh,740px); overflow:auto; padding:0 16px 14px; border-radius:12px;
      background:radial-gradient(90% 30% at 50% 0%, rgba(255,255,255,.035), transparent 70%), rgba(11,11,12,.98);
      border:1px solid rgba(255,255,255,.1); box-sizing:border-box; box-shadow:0 24px 70px rgba(0,0,0,.6); scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.15) transparent; }
    .head { position:sticky; top:0; z-index:2; display:flex; justify-content:space-between; align-items:center; margin:0 -16px 12px; padding:12px 16px 11px; border-radius:11px 11px 0 0; border-bottom:1px solid rgba(255,255,255,.07);
      background:rgba(11,11,12,.96); font:500 9.5px ZooGeistMono, ui-monospace, monospace; letter-spacing:.18em; color:rgba(238,237,233,.4); }
    .head b { color:#eeede9; font-weight:500; }
    .head .tools { display:flex; gap:6px; }
    .wrap .x { all:unset; cursor:pointer; height:22px; padding:0 8px; display:inline-flex; align-items:center; border-radius:6px; color:rgba(238,237,233,.5); box-shadow:inset 0 0 0 1px rgba(255,255,255,.1); letter-spacing:.06em; font-size:10px; }
    .wrap .x:hover { color:#fff; box-shadow:inset 0 0 0 1px rgba(255,255,255,.22); }
    [hidden] { display:none !important; }
    .wrap:lang(zh) .pill, .wrap:lang(zh) .head, .wrap:lang(zh) .x { font-family:ZooGeist, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif; }
    .wrap:lang(zh) .pill .brand, .wrap:lang(zh) .pill .v { font-family:ZooGeistMono, ui-monospace, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", monospace; }
    .wrap:lang(zh) .pill *, .wrap:lang(zh) .head, .wrap:lang(zh) .x { letter-spacing:0 !important; }
  `;

  const wrap = h("div", { class: "wrap zoo" });
  root.append(css, wrap);

  let current = null;
  let report = null;
  let open = false;
  let state = { verdict: null, why: "", symbol: "" };

  chrome.storage.local.get(["panelOpen", "pillPos"]).then((v) => {
    open = !!v.panelOpen;
    if (v.pillPos) place(v.pillPos);
  });

  // The pill can be dragged out of the way of the site's own buttons; it stays where you leave it, on every site.
  function place(p) {
    const x = Math.min(Math.max(8, p.right), innerWidth - 120);
    const y = Math.min(Math.max(8, p.bottom), innerHeight - 50);
    host.style.right = `${x}px`;
    host.style.bottom = `${y}px`;
  }
  let drag = null;
  let dragged = false;
  host.addEventListener("pointerdown", (e) => {
    if (!e.composedPath().some((n) => n.classList?.contains("pill"))) return;
    drag = { x: e.clientX, y: e.clientY, right: parseFloat(host.style.right) || 18, bottom: parseFloat(host.style.bottom) || 18 };
    dragged = false;
  });
  addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < 5) return;
    dragged = true;
    place({ right: drag.right - dx, bottom: drag.bottom - dy });
  });
  addEventListener("pointerup", () => {
    if (drag && dragged) void chrome.storage.local.set({ pillPos: { right: parseFloat(host.style.right), bottom: parseFloat(host.style.bottom) } });
    drag = null;
  });

  // The card is built once per token, so a wallet opened inside it stays open while you minimize and come back.
  let card = null;
  let pill = null;
  function draw() {
    if (!current || !state.verdict) {
      host.remove();
      card = pill = null;
      return;
    }
    if (!host.isConnected) document.documentElement.append(host);
    wrap.setAttribute("lang", lang() === "zh" ? "zh-CN" : "en");
    const tone = TONE[state.verdict];
    pill = h(
      "button",
      { class: "pill", title: t("ZOOAI X-Ray: click to open, drag to move"), onclick: () => (dragged ? (dragged = false) : toggle(!open)) },
      h("i", { class: "dot", style: { background: tone.color, color: tone.color, boxShadow: `0 0 8px ${tone.color}` } }),
      h("span", { class: "brand" }, "X-RAY"),
      h("span", { class: "bar" }),
      h("span", { class: "v", style: { color: tone.color } }, tone.label),
      state.why ? h("span", { class: "why" }, tChain(state.why)) : null,
    );
    if (!card || card.dataset.mint !== current) {
      const body = h("div", {});
      card = h(
        "div",
        { class: "card", "data-mint": current },
        h("div", { class: "head" }, h("span", {}, h("b", {}, "ZOOAI"), "  X-RAY"), h("span", { class: "tools" }, h("a", { class: "x", href: `${ZOO.SITE}/xray?mint=${current}`, target: "_blank", rel: "noopener" }, t("site ↗")), h("button", { class: "x", onclick: () => toggle(false) }, t("minimize")))),
        body,
      );
      card.loaded = false;
      card.body = body;
    }
    card.hidden = !open;
    wrap.replaceChildren(card, pill);
    if (open && !card.loaded) {
      card.loaded = true;
      const c = card;
      if (report) ZooPanel.render(c.body, report, { scroller: c });
      else {
        c.body.replaceChildren(ZooPanel.skeleton());
        ask({ type: "xray", mint: current }).then((r) => {
          if (r?.report) {
            report = r.report;
            ZooPanel.render(c.body, report, { scroller: c });
          } else {
            c.loaded = false;
            c.body.replaceChildren(h("p", { class: "err" }, r?.error || t("Something went wrong.")));
          }
        });
      }
    }
  }

  function toggle(v) {
    open = v;
    void chrome.storage.local.set({ panelOpen: v });
    draw();
  }

  /** The token of this page, from its URL; single-page apps change it without reloading, so it is read again on every change. */
  async function look() {
    const url = location.pathname + location.search;
    const found = addresses(url);
    const candidate = found[0] ?? null;
    if (candidate === current) return;
    current = candidate;
    report = null;
    state = { verdict: null, why: "", symbol: "" };
    if (!candidate) {
      void ask({ type: "clear" });
      draw();
      return;
    }
    const r = await ask({ type: "check", mint: candidate, page: true });
    if (current !== candidate) return;
    const c = r?.check;
    if (!c || !c.verdict || c.verdict === "unknown") {
      current = null;
      draw();
      return;
    }
    current = r.mint;
    state = { verdict: c.verdict, why: c.reasons?.[0] || "", symbol: sym(c.symbol) };
    draw();
  }

  let last = "";
  setInterval(() => {
    const now = location.href;
    if (now !== last) {
      last = now;
      void look();
    }
  }, 700);
})();
