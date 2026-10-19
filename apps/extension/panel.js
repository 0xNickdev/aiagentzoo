// The report, drawn the same way in the popup and in the panel on a trading page. Built from DOM nodes, never from HTML strings.
var ZooPanel = (() => {
  const { TONE, VENUE, pct, short, secs, sym, SITE, BOT, ask } = ZOO;
  const KIND = {
    crew: { color: "#ff8a7e", label: "dev's own wallet" },
    ring: { color: "#f2b56b", label: "sniper ring" },
    serial: { color: "#c9b48a", label: "serial sniper" },
    bundle: { color: "#9fc3ff", label: "launch block" },
    early: { color: "#e9e4d8", label: "first 5 s" },
  };
  const kindOf = (e) => (e.crew ? "crew" : e.ring ? "ring" : e.serial ? "serial" : e.bundle ? "bundle" : "early");

  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "style") for (const [sk, sv] of Object.entries(v)) sk.startsWith("--") ? e.style.setProperty(sk, sv) : (e.style[sk] = sv);
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const NS = "http://www.w3.org/2000/svg";
  function s(tag, attrs = {}) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  /** The first five seconds as a small radar: a ring per second, every wallet on the second it bought. */
  function radar(early, onPick) {
    const W = 300, H = 220, CX = W / 2, CY = H / 2;
    const rOf = (sec) => 18 + Math.min(5, Math.max(0, sec)) * 17.5;
    const order = ["crew", "ring", "serial", "bundle", "early"];
    const list = early.slice(0, 30);
    const groups = order.map((k) => list.filter((e) => kindOf(e) === k).sort((a, b) => a.afterSec - b.afterSec));
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "radar" });
    for (let i = 0; i <= 5; i++) svg.append(s("circle", { cx: CX, cy: CY, r: rOf(i), fill: "none", stroke: "#fff", "stroke-opacity": i === 5 ? 0.12 : 0.06, "stroke-dasharray": i === 0 ? "2 4" : "" }));
    const lbl = s("text", { x: CX + 3, y: CY - rOf(5) - 3, "font-size": 8, fill: "#fff", "fill-opacity": 0.35, class: "mono" });
    lbl.textContent = "5s";
    svg.append(lbl);
    let a0 = -Math.PI / 2 - (groups[0].length / Math.max(1, list.length)) * Math.PI;
    const nodes = [];
    groups.forEach((g, gi) => {
      const span = (g.length / Math.max(1, list.length)) * Math.PI * 2;
      g.forEach((e, i) => {
        const a = a0 + span * ((i + 0.5) / g.length);
        const r = rOf(e.afterSec) + (g.length > 6 ? (i % 2 ? 5 : -3) : 0);
        nodes.push({ e, k: order[gi], x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r });
      });
      a0 += span;
    });
    for (const n of nodes.filter((n) => n.e.crew)) svg.append(s("line", { x1: CX, y1: CY, x2: n.x, y2: n.y, stroke: KIND.crew.color, "stroke-opacity": 0.3 }));
    for (const n of nodes) {
      const c = KIND[n.k].color;
      const size = Math.min(10, 2.5 + Math.sqrt(Math.max(0, n.e.bought)) * 24);
      const holds = n.e.bought > 0 ? n.e.held / n.e.bought : 0;
      const g = s("g", { class: "node" });
      const t = s("title");
      t.textContent = `${short(n.e.wallet)} · ${KIND[n.k].label} · in at ${n.e.afterSec}s · took ${pct(n.e.bought)} · holds ${pct(n.e.held)} · ${n.e.exitSec === null ? "still in" : `sold out after ${secs(n.e.exitSec)}`}`;
      g.append(t, s("circle", { cx: n.x, cy: n.y, r: size + 5, fill: "transparent" }));
      g.append(holds > 0.05 ? s("circle", { cx: n.x, cy: n.y, r: size, fill: c, "fill-opacity": 0.3 + holds * 0.55, stroke: c }) : s("circle", { cx: n.x, cy: n.y, r: size, fill: c, "fill-opacity": 0.06, stroke: c, "stroke-opacity": 0.8, "stroke-dasharray": "2 2" }));
      g.addEventListener("click", () => onPick(n.e));
      svg.append(g);
    }
    svg.append(s("circle", { cx: CX, cy: CY, r: 9, fill: "#050807", stroke: "#fff", "stroke-opacity": 0.85 }));
    const dev = s("text", { x: CX, y: CY + 3, "text-anchor": "middle", "font-size": 7, fill: "#fff", class: "mono" });
    dev.textContent = "dev";
    svg.append(dev);
    return svg;
  }

  function fact(k, v, sub, bad) {
    return h("div", { class: "fact" }, h("span", {}, k), h("b", { class: bad ? "bad" : "" }, v), h("em", {}, sub || " "));
  }

  /** Who a first-second wallet is, across two days of launches. */
  async function dossier(box, e, creator) {
    const k = KIND[kindOf(e)];
    box.replaceChildren(
      h("div", { class: "dos-head" }, h("span", { class: "mono", style: { color: k.color } }, k.label.toUpperCase()), h("a", { class: "mono link", href: `https://solscan.io/account/${e.wallet}`, target: "_blank", rel: "noopener" }, `${short(e.wallet)} ↗`)),
      h("p", { class: "dos-line mono" }, `in at ${e.afterSec}s · took ${pct(e.bought)} · holds ${pct(e.held)} · ${e.exitSec === null ? "still in" : `out after ${secs(e.exitSec)}`}`),
      h("p", { class: "dos-text" }, "Reading its last two days…"),
    );
    const sn = await ask({ type: "sniper", wallet: e.wallet });
    const text = box.querySelector(".dos-text");
    if (!sn || sn.error || !sn.snipes48h) {
      text.textContent = "No other launches from this wallet on the stream in the last two days.";
      return;
    }
    const same = (sn.topCreators || []).find((c) => c.creator === creator);
    text.textContent = `Bought ${sn.snipes48h} launches in their first seconds over two days, sold out of ${sn.soldOut}, usually ${secs(sn.medianExitSec)} after buying.${same ? ` ${same.launches} of them were this dev's.` : ""}`;
    if (sn.recent?.length)
      box.append(
        h("div", { class: "chips" }, ...sn.recent.slice(0, 6).map((m) => h("a", { class: "chip mono", href: `${SITE}/xray?mint=${m.mint}`, target: "_blank", rel: "noopener" }, `$${sym(m.symbol)}`))),
      );
  }

  /** The whole report into `root`. */
  function render(root, r, { compact = false } = {}) {
    const c = r.check;
    const f = c.facts || {};
    const tone = TONE[c.verdict] || TONE.unknown;
    const early = r.early || [];
    const took = early.reduce((n, e) => n + e.bought, 0);
    const holds = early.reduce((n, e) => n + e.held, 0);
    const rec = r.creatorRecord;
    const fund = r.funding;
    const meta = [`$${sym(r.symbol)}`, r.name, `${f.ageMin ?? 0} min old`, VENUE[f.venue || "pump.fun"], f.graduated ? "graduated" : "", f.mayhem ? "Mayhem Mode" : ""].filter(Boolean).join(" · ");
    const dos = h("div", { class: "dossier", hidden: true });
    const showDos = (e) => {
      dos.hidden = false;
      void dossier(dos, e, r.creator);
    };
    const reasons = h("ul", { class: "reasons" }, ...c.reasons.slice(0, compact ? 3 : 5).map((x) => h("li", { style: { "--c": tone.color } }, x)));
    const facts = h(
      "div",
      { class: "facts" },
      fact("the dev", rec ? `${rec.dumped} of ${rec.launches48h} dumped` : "first launch", f.creatorSoldPct == null ? "never bought their own" : `sold ${f.creatorSoldPct}% of their bag`, (rec?.dumped ?? 0) >= 2 || (f.creatorSoldPct ?? 0) >= 50),
      fact("first 5 seconds", early.length ? `${early.length} wallets` : "nobody", early.length ? `took ${pct(took)} · hold ${pct(holds)}` : "no one bought before it was visible", took >= 0.25),
      fact("dev's own wallets", String(f.creatorCrew ?? 0), `sniper ring ${f.ringWallets ?? 0} · serial ${f.serialSnipers ?? 0}`, (f.creatorCrew ?? 0) >= 2),
      fact(
        "who paid the dev",
        !fund ? "tracing…" : !fund.funder ? "no transfer found" : fund.funderIsHot ? "an exchange" : fund.siblings.length ? `${fund.siblings.length} other devs` : "only this dev",
        fund?.funder && !fund.funderIsHot ? (fund.siblings.length ? `${fund.siblingDumped48h} dumps in 48h` : short(fund.funder)) : "",
        !!fund?.funder && !fund.funderIsHot && fund.siblingDumped48h >= 3,
      ),
    );
    const five = early.length
      ? h(
          "div",
          { class: "five" },
          h("div", { class: "five-head" }, h("span", {}, "The first 5 seconds"), h("span", { class: "mono dim" }, "tap a wallet")),
          radar(early, showDos),
          h(
            "div",
            { class: "wallets" },
            ...early.slice(0, compact ? 5 : 8).map((e) =>
              h(
                "button",
                { class: "wallet mono", onclick: () => showDos(e) },
                h("i", { style: { background: KIND[kindOf(e)].color } }),
                h("span", { class: "w" }, short(e.wallet)),
                h("span", { class: "k", style: { color: KIND[kindOf(e)].color } }, KIND[kindOf(e)].label),
                h("span", { class: "n" }, pct(e.bought)),
                h("span", { class: "n" }, e.exitSec === null ? "in" : secs(e.exitSec)),
              ),
            ),
          ),
          dos,
        )
      : null;
    const watchBtn = h("button", { class: "btn" }, "Alert me");
    ask({ type: "watching" }).then((w) => {
      const on = !!w?.watched?.[r.mint];
      watchBtn.textContent = on ? "Alerts on ✓" : "Alert me";
      watchBtn.dataset.on = on ? "1" : "";
    });
    watchBtn.addEventListener("click", async () => {
      const on = !watchBtn.dataset.on;
      await ask({ type: "watch", mint: r.mint, symbol: r.symbol, on });
      watchBtn.dataset.on = on ? "1" : "";
      watchBtn.textContent = on ? "Alerts on ✓" : "Alert me";
    });
    root.replaceChildren(
      ...[
      h("p", { class: "meta mono" }, meta),
      h("p", { class: "verdict", style: { color: tone.color } }, tone.label),
      reasons,
      c.notes?.length && !compact ? h("p", { class: "notes" }, c.notes.join(" · ")) : null,
      facts,
      five,
      h(
        "div",
        { class: "actions" },
        h("a", { class: "btn primary", href: `${SITE}/xray?mint=${r.mint}`, target: "_blank", rel: "noopener" }, "Full X-Ray"),
        watchBtn,
        h("a", { class: "btn", href: `${BOT}?start=w-${r.mint}`, target: "_blank", rel: "noopener", title: "Alerts in the Telegram bot" }, "Telegram"),
      ),
      ].filter(Boolean),
    );
  }

  return { render, h };
})();
