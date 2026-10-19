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
    .pill { all:unset; display:flex; align-items:center; gap:9px; max-width:340px; padding:9px 13px 9px 11px; border-radius:999px; cursor:pointer;
      background:rgba(7,10,9,.94); box-shadow:0 0 0 1px rgba(255,255,255,.12), 0 12px 40px rgba(0,0,0,.55); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
      font:500 12px/1.2 ZooGeist, -apple-system, sans-serif; color:#fff; transition:transform .15s ease; }
    .pill:hover { transform:translateY(-1px); }
    .pill .dot { width:8px; height:8px; border-radius:50%; flex:0 0 8px; }
    .pill .brand { font:500 10px ZooGeistMono, ui-monospace, monospace; letter-spacing:.14em; color:rgba(255,255,255,.5); }
    .pill .v { letter-spacing:.02em; }
    .pill .why { font-weight:300; color:rgba(255,255,255,.62); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
    .card { width:372px; max-height:min(76vh,720px); overflow:auto; padding:14px 14px 12px; border-radius:20px;
      background:radial-gradient(120% 60% at 15% 0%, rgba(255,236,200,.06), transparent 60%), rgba(5,8,7,.97);
      box-shadow:0 0 0 1px rgba(255,255,255,.1), 0 24px 70px rgba(0,0,0,.6); scrollbar-width:thin; }
    .bar { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; font:500 10px ZooGeistMono, ui-monospace, monospace; letter-spacing:.14em; text-transform:uppercase; color:rgba(255,255,255,.5); }
    .bar b { color:#fff; font-weight:500; }
    .x { all:unset; cursor:pointer; padding:2px 8px; border-radius:999px; color:rgba(255,255,255,.55); box-shadow:inset 0 0 0 1px rgba(255,255,255,.12); letter-spacing:0; text-transform:none; font-size:11px; }
    .x:hover { color:#fff; }
    [hidden] { display:none !important; }
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

  function draw() {
    if (!current || !state.verdict) {
      host.remove();
      return;
    }
    if (!host.isConnected) document.documentElement.append(host);
    const tone = TONE[state.verdict];
    const pill = h(
      "button",
      { class: "pill", title: "ZOOAI X-Ray: click to open, drag to move", onclick: () => (dragged ? (dragged = false) : toggle(!open)) },
      h("i", { class: "dot", style: { background: tone.color, boxShadow: `0 0 10px ${tone.color}` } }),
      h("span", { class: "brand" }, "X-RAY"),
      h("span", { class: "v", style: { color: tone.color } }, tone.label),
      state.why ? h("span", { class: "why" }, state.why) : null,
    );
    const body = h("div", {});
    const card = h(
      "div",
      { class: "card", hidden: !open },
      h("div", { class: "bar" }, h("span", {}, h("b", {}, "ZOOAI"), " X-Ray"), h("button", { class: "x", onclick: () => toggle(false) }, "minimize")),
      body,
    );
    wrap.replaceChildren(card, pill);
    if (open) {
      if (report) ZooPanel.render(body, report, { compact: false });
      else {
        body.replaceChildren(h("div", { class: "skeleton" }));
        ask({ type: "xray", mint: current }).then((r) => {
          if (r?.report) {
            report = r.report;
            if (open) ZooPanel.render(body, report);
          } else body.replaceChildren(h("p", { class: "err" }, r?.error || "Something went wrong."));
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
