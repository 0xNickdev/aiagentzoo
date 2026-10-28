// The report, drawn the same way in the popup and in the panel on a trading page: a token's X-Ray and every wallet's page,
// one leading to the other with a back step. Built from DOM nodes, never from HTML strings.
var ZooPanel = (() => {
  const { TONE, VENUE, pct, short, secs, mins, ago, sym, SITE, BOT, ask, explorer, explorerName } = ZOO;
  const KIND = {
    crew: { color: "#ff8a7e", get label() { return t("dev's own wallet"); } },
    ring: { color: "#f2b56b", get label() { return t("sniper ring"); } },
    serial: { color: "#d8c49a", get label() { return t("serial sniper"); } },
    bundle: { color: "#9fc3ff", get label() { return t("launch block"); } },
    early: { color: "#a9a8a3", get label() { return t("first 5 s"); } },
  };
  const ORDER = ["crew", "ring", "serial", "bundle", "early"];
  /** The node's wallet tags the kinds above do not already say, as one word each. */
  const TAGL = { get rugger() { return t("rugger"); }, get whale() { return t("whale"); }, get dev() { return t("dev"); }, get exchange() { return t("exchange"); }, get new() { return t("new wallet"); } };
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
  function s(tag, attrs = {}, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const plus = () => ["tl", "tr", "bl", "br"].map((p) => h("i", { class: `plus ${p}`, "aria-hidden": "true" }));
  const frame = (props, ...kids) => h("section", { ...props, class: `frame ${props.class || ""}` }, ...plus(), ...kids);
  const sec = (n, title, aside) => h("div", { class: "sec mono" }, h("span", { class: "idx" }, n), h("span", {}, t(title).toUpperCase()), h("span", { class: "rule" }), aside ? h("span", { class: "aside" }, t(aside)) : null);
  const ext = (href, ...kids) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, ...kids);
  const copy = (btn, text) => {
    void navigator.clipboard?.writeText(text).then(() => {
      const was = btn.textContent;
      btn.textContent = t("copied");
      setTimeout(() => (btn.textContent = was), 1200);
    });
  };

  /** The first five seconds as a dot matrix: a column per second, a dot per wallet, size is what it took, filled while it still holds. */
  function timeline(early, onPick) {
    const list = early.slice(0, 40);
    const W = 344, cols = 6, cell = 13, perRow = 4;
    const band = W / cols;
    const by = Array.from({ length: cols }, () => []);
    for (const e of list) by[Math.min(cols - 1, Math.max(0, Math.round(e.afterSec)))].push(e);
    for (const g of by) g.sort((a, b) => ORDER.indexOf(kindOf(a)) - ORDER.indexOf(kindOf(b)) || b.bought - a.bought);
    const rows = Math.max(3, ...by.map((g) => Math.ceil(g.length / perRow)));
    const top = 14, base = top + rows * cell + 4, H = base + 20;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": t("{n} wallets in the first 5 seconds", { n: list.length }) });
    for (let i = 1; i < cols; i++) svg.append(s("line", { x1: i * band, x2: i * band, y1: top - 6, y2: base, stroke: "#fff", "stroke-opacity": 0.06, "stroke-dasharray": "1 3" }));
    svg.append(s("line", { x1: 0, x2: W, y1: base, y2: base, stroke: "#fff", "stroke-opacity": 0.16 }));
    by.forEach((g, c) => {
      const x0 = c * band + (band - perRow * cell) / 2;
      svg.append(s("line", { x1: c * band + band / 2, x2: c * band + band / 2, y1: base, y2: base + 4, stroke: "#fff", "stroke-opacity": 0.3 }));
      svg.append(s("text", { x: c * band + band / 2, y: base + 15, "text-anchor": "middle", "font-size": 8.5, fill: "#fff", "fill-opacity": c === 0 ? 0.55 : 0.35, class: "mono", "letter-spacing": ".08em" }, c === 0 ? t("LAUNCH") : `+${c}s`));
      if (g.length) svg.append(s("text", { x: c * band + band / 2, y: base - Math.ceil(g.length / perRow) * cell - 4, "text-anchor": "middle", "font-size": 8, fill: "#fff", "fill-opacity": 0.4, class: "mono" }, String(g.length)));
      g.forEach((e, i) => {
        const cx = x0 + (i % perRow) * cell + cell / 2;
        const cy = base - 2 - Math.floor(i / perRow) * cell - cell / 2;
        const k = kindOf(e);
        const color = KIND[k].color;
        const r = Math.min(5.6, 2.4 + Math.sqrt(Math.max(0, e.bought)) * 15);
        const holds = e.bought > 0 ? e.held / e.bought : 0;
        const dot = s("g", { class: "dot", tabindex: 0 });
        dot.append(s("title", {}, t("{w} · {k} · in at {a}s · took {b} · holds {c} · {x}", { w: short(e.wallet), k: KIND[k].label, a: e.afterSec, b: pct(e.bought), c: pct(e.held), x: e.exitSec === null ? t("still in") : t("sold out after {s}", { s: secs(e.exitSec) }) })));
        dot.append(s("rect", { x: cx - cell / 2, y: cy - cell / 2, width: cell, height: cell, fill: "transparent" }));
        dot.append(holds > 0.05 ? s("circle", { class: "ring", cx, cy, r, fill: color, "fill-opacity": 0.35 + holds * 0.6, stroke: color }) : s("circle", { class: "ring", cx, cy, r, fill: "none", stroke: color, "stroke-opacity": 0.75 }));
        dot.addEventListener("click", () => onPick(e.wallet));
        dot.addEventListener("keydown", (ev) => ev.key === "Enter" && onPick(e.wallet));
        svg.append(dot);
      });
    });
    return svg;
  }

  function fact(k, v, sub, bad, onclick) {
    return h(onclick ? "button" : "div", { class: "fact", onclick, title: onclick ? t("Open its page") : null }, h("span", {}, t(k)), h("b", { class: bad ? "bad" : "" }, v), h("em", {}, sub || " "));
  }

  // Where you are and where you came from: a token or a wallet, with a step back.
  function nav(root, opts = {}) {
    return { root, opts, stack: [], cur: null };
  }
  const named = (v) => (v.t === "token" ? (v.report ? `$${sym(v.report.symbol)}` : short(v.id)) : short(v.id));
  function backBar(ctx) {
    const prev = ctx.stack[ctx.stack.length - 1];
    if (prev) return h("button", { class: "back mono", onclick: () => go(ctx, ctx.stack.pop(), false) }, h("span", {}, "←"), h("span", {}, named(prev)));
    if (ctx.opts.onHome) return h("button", { class: "back mono", onclick: ctx.opts.onHome }, h("span", {}, "←"), h("span", {}, t("home")));
    return null;
  }
  const skeleton = () => h("div", { class: "skeleton" }, h("i"), h("i"), h("i"), h("i"));

  async function go(ctx, view, push = true) {
    if (push && ctx.cur) ctx.stack.push(ctx.cur);
    if (ctx.stack.length > 20) ctx.stack.shift();
    ctx.cur = view;
    (ctx.opts.scroller || document.scrollingElement)?.scrollTo?.(0, 0);
    const ready = view.t === "token" ? view.report : view.profile;
    if (!ready) {
      ctx.root.replaceChildren(...[backBar(ctx), skeleton()].filter(Boolean));
      const r = view.t === "token" ? await ask({ type: "xray", mint: view.id }) : await ask({ type: "wallet", wallet: view.id });
      if (ctx.cur !== view) return;
      if (view.t === "token" && r?.report) view.report = r.report;
      else if (view.t === "wallet" && r?.profile) view.profile = r.profile;
      else {
        ctx.root.replaceChildren(...[backBar(ctx), h("p", { class: "err" }, r?.error || t("Something went wrong."))].filter(Boolean));
        return;
      }
    }
    if (view.t === "token") drawToken(ctx, view.report);
    else drawWallet(ctx, view.profile);
  }
  const openToken = (ctx, mint) => go(ctx, { t: "token", id: mint });
  const openWallet = (ctx, wallet) => go(ctx, { t: "wallet", id: wallet });

  function meter(verdict) {
    const at = { avoid: 0, caution: 1, pass: 2 }[verdict];
    const names = [t("AVOID"), t("CAUTION"), t("CLEAR")];
    return [
      h("div", { class: "meter" }, ...names.map((_, i) => h("span", { class: i === at ? "on" : "" }))),
      h("div", { class: "meter-l mono" }, ...names.map((n, i) => h("span", { class: i === at ? "on" : "" }, n))),
    ];
  }

  /** A token's X-Ray. */
  function drawToken(ctx, r) {
    const compact = !!ctx.opts.compact;
    const c = r.check;
    const f = c.facts || {};
    const tone = TONE[c.verdict] || TONE.unknown;
    const early = r.early || [];
    const took = early.reduce((n, e) => n + e.bought, 0);
    const holds = early.reduce((n, e) => n + e.held, 0);
    const rec = r.creatorRecord;
    const fund = r.funding;
    const live = c.stream?.live !== false;
    const caBtn = h("button", { class: "ca mono", title: t("Copy the token address"), onclick: () => copy(caBtn, r.mint) }, `${short(r.mint)} ⧉`);
    const track = h("p", { class: "track", hidden: true });
    const verdict = frame(
      { class: "verdict-card", style: { "--tone": tone.color } },
      h("div", { class: "v-top mono" }, h("span", {}, h("span", { style: { opacity: 0.6 } }, "01  "), t("VERDICT")), h("span", { class: `live ${live ? "" : "off"}` }, h("i"), live ? t("LIVE READ") : t("STREAM BEHIND"))),
      h("p", { class: "verdict" }, c.score === null || c.score === undefined ? tone.label : `${tone.label} · ${c.score}`),
      ...meter(c.verdict),
      c.reasons?.length ? h("ol", { class: "reasons" }, ...c.reasons.slice(0, compact ? 3 : 5).map((x, i) => h("li", {}, h("b", {}, String(i + 1).padStart(2, "0")), h("span", {}, tChain(x))))) : null,
      c.notes?.length && !compact ? h("p", { class: "notes" }, c.notes.map(tChain).join(" · ")) : null,
      track,
    );
    // A dev with a clean track record gets a green line, read from its wallet page.
    if (r.creator)
      void ask({ type: "wallet", wallet: r.creator }).then((w) => {
        const b = w?.profile?.dev?.builder;
        if (!b?.isBuilder || !track.isConnected) return;
        track.textContent = t("Track record: {g} of this dev's {n} launches grew and still hold liquidity, and it has not dumped them.", { g: b.grew, n: b.launches });
        track.hidden = false;
      });
    const facts = h(
      "div",
      { class: "facts" },
      fact("the dev", rec ? t("{a} of {b} dumped", { a: rec.dumped, b: rec.launches48h }) : t("first launch"), f.creatorSoldPct == null ? t("never bought their own") : t("sold {p}% of their bag", { p: f.creatorSoldPct }), (rec?.dumped ?? 0) >= 2 || (f.creatorSoldPct ?? 0) >= 50, r.creator ? () => openWallet(ctx, r.creator) : null),
      fact(
        "who paid the dev",
        !fund ? t("tracing…") : !fund.funder ? t("no transfer found") : fund.funderService ? t("{x} launcher", { x: fund.funderService }) : fund.funderLabel ? t("withdrawn from {x}", { x: fund.funderLabel }) : fund.funderIsHot ? t("an exchange") : fund.siblings.length ? t("{n} other devs", { n: fund.siblings.length }) : t("only this dev"),
        fund?.funder ? (fund.funderService ? t("pays for every launch there, ties no one") : fund.funderIsHot ? t("funds everyone, ties no one") : fund.siblings.length ? t("{n} dumps in 48h", { n: fund.siblingDumped48h }) : short(fund.funder)) : "",
        !!fund?.funder && !fund.funderIsHot && fund.siblingDumped48h >= 3,
        fund?.funder ? () => openWallet(ctx, fund.funder) : null,
      ),
      fact("dev's own wallets", String(f.creatorCrew ?? 0), t("keep sniping this dev"), (f.creatorCrew ?? 0) >= 2),
      fact("rings · serial", `${f.ringWallets ?? 0} · ${f.serialSnipers ?? 0}`, t("snipers in the first seconds"), (f.ringWallets ?? 0) >= 3),
    );
    // Where the dev's SOL went, once the dev has sold: filled in when the trace comes back, hidden when it leads nowhere known.
    const trailBox = h("p", { class: "trail", hidden: true });
    if (!/^0x/.test(r.mint) && (f.creatorSoldPct ?? 0) >= 50)
      void ask({ type: "trail", mint: r.mint }).then((x) => {
        if (!x?.trail || !trailBox.isConnected) return;
        const tr = x.trail;
        const parts = [];
        if (tr.funderBack) parts.push(t("back to the wallet that paid the dev"));
        if (tr.devs) parts.push(tr.devs === 1 ? t("a wallet that launched {n} coins and dumped {d}", { n: tr.launches, d: tr.dumped }) : t("{k} wallets that launched {n} coins and dumped {d}", { k: tr.devs, n: tr.launches, d: tr.dumped }));
        if (tr.kols.length) parts.push(t(tr.kols.length === 1 ? "the wallet of {x}, a KOL on Kolscan" : "KOL wallets on Kolscan: {x}", { x: tr.kols.join(", ") }));
        if (tr.paymasters) parts.push(tr.paymasters === 1 ? t("a wallet that paid {n} other devs", { n: tr.paidDevs }) : t("{k} wallets that pay other devs", { k: tr.paymasters }));
        if (tr.cabals.length) parts.push(tr.cabals.length === 1 ? t("a wallet in cabal #{c}", { c: tr.cabals[0] }) : t("wallets in {n} cabals", { n: tr.cabals.length }));
        trailBox.replaceChildren(
          h("b", {}, t("Where the SOL went: ")),
          t("the dev's SOL leads to {p}.", { p: parts.join("; ") }),
          h("span", { class: "trail-n" }, t("Transfers, not owners.")),
        );
        trailBox.hidden = false;
      });
    // Who holds it, at a glance: the same shares as under the verdict on the site, red past the line where that share alone decides the price.
    const hd = c.holders;
    const held = [];
    if (hd && hd.top10Pct > 0) {
      held.push(fact("top 10", `${hd.top10Pct}%`, t("largest {p}%", { p: hd.topWalletPct }), hd.top10Pct >= 50 || hd.topWalletPct >= 20));
    }
    if (hd && hd.creatorHoldsPct != null) held.push(fact("dev holds", `${hd.creatorHoldsPct}%`, "", hd.creatorHoldsPct >= 5));
    if (f.bundlers) held.push(fact("bundlers hold", `${f.bundlersHeldPct ?? 0}%`, t("{n} wallets", { n: f.bundlers }), (f.bundlersHeldPct ?? 0) >= 20));
    if (f.earlyWallets) held.push(fact("first 5 s hold", `${f.earlyHeldPct ?? 0}%`, t("{n} wallets", { n: f.earlyWallets }), (f.earlyHeldPct ?? 0) >= 30));
    if (f.crewHeldPct) held.push(fact("dev's crew holds", `${f.crewHeldPct}%`, "", f.crewHeldPct >= 5));
    if (hd && hd.programPct) held.push(fact("curve / pool", `${hd.programPct}%`, "", false));
    const holdBlock = held.length ? [sec("02", "Who holds it"), h("div", { class: "facts" }, ...held)] : [];
    const kinds = ORDER.map((k) => [k, early.filter((e) => kindOf(e) === k).length]).filter(([, n]) => n);
    const rowsShown = compact ? 5 : 8;
    const five = early.length
      ? [
          sec(holdBlock.length ? "04" : "03", "The first 5 seconds", t("{n} wallets", { n: early.length })),
          timeline(early, (w) => openWallet(ctx, w)),
          h(
            "div",
            { class: "took" },
            h("div", { class: "took-bar" }, h("i", { class: "held", style: { width: `${Math.min(100, holds * 100)}%` } }), h("i", { class: "sold", style: { left: `${Math.min(100, holds * 100)}%`, width: `${Math.max(0, Math.min(100, (took - holds) * 100))}%` } })),
            h("div", { class: "took-l mono" }, h("span", {}, t("took "), h("b", { class: took >= 0.25 ? "bad" : "" }, pct(took)), t(" of supply")), h("span", {}, t("still hold "), h("b", {}, pct(holds)))),
          ),
          h("div", { class: "legend mono" }, ...kinds.map(([k, n]) => h("span", {}, h("i", { style: { background: KIND[k].color } }), `${KIND[k].label} · ${n}`)), h("span", {}, h("i", { class: "hollow" }), t("sold out"))),
          h(
            "div",
            { class: "table mono" },
            h("div", { class: "thead" }, h("span"), h("span", {}, t("WALLET")), h("span", {}, t("WHO")), h("span", { class: "n" }, t("TOOK")), h("span", { class: "n" }, t("OUT"))),
            ...early.slice(0, rowsShown).map((e) =>
              h(
                "button",
                { class: "row", onclick: () => openWallet(ctx, e.wallet), title: t("Open its page") },
                h("i", { style: { background: KIND[kindOf(e)].color } }),
                h("span", { class: "w" }, short(e.wallet)),
                h("span", { class: "k", style: { color: KIND[kindOf(e)].color } }, [KIND[kindOf(e)].label, ...(e.tags || []).filter((k) => TAGL[k]).map((k) => TAGL[k])].join(" · ")),
                h("span", { class: "n" }, pct(e.bought)),
                h("span", { class: "n" }, e.exitSec === null ? t("in") : secs(e.exitSec)),
              ),
            ),
          ),
          early.length > rowsShown ? h("a", { class: "more mono", href: `${SITE}/xray?mint=${r.mint}`, target: "_blank", rel: "noopener" }, t("+{n} more on the full X-Ray ↗", { n: early.length - rowsShown })) : null,
        ]
      : [sec(holdBlock.length ? "04" : "03", "The first 5 seconds"), h("p", { class: "p dim" }, t("Nobody bought before it was visible."))];
    const watchBtn = h("button", { class: "btn" }, t("Alert me"));
    const setWatch = (on) => {
      watchBtn.textContent = on ? t("Alerts on ✓") : t("Alert me");
      watchBtn.dataset.on = on ? "1" : "";
    };
    ask({ type: "watching" }).then((w) => setWatch(!!w?.watched?.[r.mint]));
    watchBtn.addEventListener("click", async () => {
      const on = !watchBtn.dataset.on;
      await ask({ type: "watch", mint: r.mint, symbol: r.symbol, on });
      setWatch(on);
    });
    const age = f.ageMin === undefined ? null : t("{t} old", { t: mins(f.ageMin) });
    ctx.root.replaceChildren(
      ...[
        backBar(ctx),
        h("div", { class: "tok" }, h("div", { class: "tok-l" }, h("p", { class: "sym" }, `$${sym(r.symbol)}`), h("p", { class: "name" }, r.name)), caBtn),
        h("p", { class: "sub mono" }, [age, VENUE[f.venue || "pump.fun"], f.graduated ? t("graduated") : "", f.mayhem ? t("Mayhem Mode") : ""].filter(Boolean).join(" · ")),
        verdict,
        ...holdBlock,
        sec(holdBlock.length ? "03" : "02", "Who is behind it", "tap to open"),
        facts,
        trailBox,
        ...five,
        h(
          "div",
          { class: "actions" },
          h("a", { class: "btn primary", href: `${SITE}/xray?mint=${r.mint}`, target: "_blank", rel: "noopener" }, t("Full X-Ray ↗")),
          watchBtn,
          h("a", { class: "btn", href: `${BOT}?start=w-${r.mint}`, target: "_blank", rel: "noopener", title: t("Alerts in the Telegram bot") }, "Telegram"),
        ),
        h("p", { class: "foot mono" }, t("read from public chain data · not financial advice")),
      ].filter(Boolean),
    );
  }

  /** One sentence for the whole wallet, from the facts, no adjectives the facts do not carry. Same as the site. */
  function lead(p) {
    const d = p.dev;
    if (d && d.builder?.isBuilder) return { text: t("A track record: {g} of its {n} launches grew and still hold liquidity, and it has not dumped them.", { g: d.builder.grew, n: d.builder.launches }), good: true };
    if (d && d.launches48h >= 3 && d.dumped >= Math.ceil(d.launches48h * 0.6)) return { text: t("A serial dumper: launched {n} tokens in two days and dumped {d} of them, usually {m} min after launch.", { n: d.launches48h, d: d.dumped, m: d.medianDumpMin ?? 0 }), bad: true };
    if (p.funded.creators.length >= 2 && !p.funded.hot) {
      const dumps = p.funded.creators.reduce((n, c) => n + c.dumped, 0);
      return { text: t("Pays for other devs: funded {n} launch wallets the zoo traced, with {d} dumps between them in two days.", { n: p.funded.creators.length, d: dumps }), bad: dumps >= 3 };
    }
    if (p.sniper && p.sniper.snipes48h >= 10) return { text: t("A sniper: bought {n} launches in their first seconds in two days and sold out of {s}, usually {t} after buying.", { n: p.sniper.snipes48h, s: p.sniper.soldOut, t: secs(p.sniper.medianExitSec) }), bad: true };
    if (d && d.graduated >= 1 && d.dumped === 0) return { text: t("A dev whose launches graduated and who has not dumped one in two days.") };
    if (d) return { text: t("Launched {n} in two days, dumped {d}.", { n: d.launches48h === 1 ? t("1 token") : t("{n} tokens", { n: d.launches48h }), d: d.dumped }), bad: d.dumped >= 2 };
    if (p.funded.hot) return { text: t("An exchange or a router: it funds everyone, so it ties no one together.") };
    return { text: t("Seen in the first seconds of {n} launches in two days.", { n: p.sniper?.snipes48h ?? 0 }) };
  }

  const addr = (ctx, a) => h("button", { class: "addr mono", onclick: () => openWallet(ctx, a), title: a }, short(a));

  /** A wallet's page: as a dev, as a first-second buyer and as the one who pays for devs. Every address leads on. */
  function drawWallet(ctx, p) {
    const d = p.dev;
    const l = lead(p);
    const roles = [d && t("DEV"), p.sniper && t("FIRST-SECOND BUYER"), p.funded.creators.length > 0 && !p.funded.hot && t("PAYS FOR DEVS"), p.funded.hot && t("EXCHANGE OR ROUTER")].filter(Boolean);
    const copyBtn = h("button", { onclick: () => copy(copyBtn, p.wallet) }, t("copy"));
    let n = 0;
    const no = () => String(++n).padStart(2, "0");
    const parts = [
      backBar(ctx),
      frame(
        { class: "wallet-card" },
        h("div", { class: "w-top mono" }, h("span", {}, [t("WALLET"), ...roles].join(" · ")), h("span", { style: { display: "flex", gap: "10px" } }, copyBtn, ext(explorer(p.wallet), `${explorerName(p.wallet).toLowerCase()} ↗`))),
        h("p", { class: "w-addr mono" }, p.wallet),
        h("p", { class: `w-lead ${l.good ? "good" : l.bad ? "bad" : ""}` }, l.text),
      ),
    ];
    if (d) {
      parts.push(
        sec(no(), "As a dev", "48 hours"),
        h(
          "div",
          { class: "facts three" },
          fact("launched", String(d.launches48h), t("{n} in 24h", { n: d.launches24h }), d.launches48h >= 5),
          fact("dumped", String(d.dumped), d.medianDumpMin === null ? "" : t("usually after {m} min", { m: d.medianDumpMin }), d.dumped >= 2),
          fact("graduated", String(d.graduated), d.builder?.aliveGraduated ? t("{n} still live", { n: d.builder.aliveGraduated }) : ""),
        ),
        h(
          "div",
          { class: "list", style: { marginTop: "6px" } },
          ...d.launches.slice(0, 8).map((x) =>
            h(
              "button",
              { class: "li", onclick: () => openToken(ctx, x.mint), title: t("Open its X-Ray") },
              h("span", { class: "l" }, `$${sym(x.symbol)} `, h("small", { class: "mono" }, t("{t} · {n} buyers", { t: ago(x.createdAt), n: x.buyers }))),
              h("span", { class: `r mono ${x.dumpedAfterMin !== null ? "bad" : x.graduated ? "good" : ""}` }, x.dumpedAfterMin !== null ? t("dumped after {m} min", { m: x.dumpedAfterMin }) : x.graduated ? t("graduated") : t("dev holding")),
            ),
          ),
        ),
        d.launches.length > 8 ? h("p", { class: "p dim", style: { marginTop: "6px" } }, t("and {n} more in two days", { n: d.launches.length - 8 })) : null,
        sec(no(), "Who paid for it"),
        !p.funding
          ? h("p", { class: "p dim" }, t("Not traced yet. It is queued: open this again in a minute."))
          : !p.funding.funder
            ? h("p", { class: "p dim" }, t("No funding transfer in the dev's recent history."))
            : h(
                "div",
                {},
                h("div", { class: "li" }, h("span", { class: "l" }, t("funded by")), h("span", { class: "r" }, addr(ctx, p.funding.funder))),
                h("p", { class: "p dim", style: { marginTop: "6px" } }, p.funding.funderService ? t("{x}'s launcher: it pays for every creator launched through {x}, so it ties no one together.", { x: p.funding.funderService }) : p.funding.funderIsHot ? t("An exchange or a router: it funds everyone, so it ties no one together.") : p.funding.siblings.length ? t("It paid for {n} other devs too, with {d} dumps between them in two days.", { n: p.funding.siblings.length, d: p.funding.siblingDumped48h }) : t("It paid for no other dev the zoo traced.")),
              ),
      );
      if (d.regulars.length)
        parts.push(
          sec(no(), "Keeps buying its launches", "first 5 s"),
          h("p", { class: "p dim" }, t("A wallet in the first seconds of most of one dev's launches is usually that dev's own.")),
          h("div", { class: "list" }, ...d.regulars.slice(0, 6).map((x) => h("div", { class: "li" }, h("span", { class: "l" }, addr(ctx, x.wallet)), h("span", { class: `r mono ${x.launches >= Math.max(2, d.launches48h * 0.5) ? "bad" : ""}` }, t("{n} of its {m} launches", { n: x.launches, m: d.launches48h }))))),
        );
      if (p.accounts?.length)
        parts.push(
          sec(no(), "Accounts its tokens link to"),
          h("p", { class: "p dim" }, t("Typed in by whoever launched the token: a lead to who is behind it, not proof.")),
          h("div", { class: "list" }, ...p.accounts.slice(0, 5).map((a) => h("a", { class: "li", href: a.social.url, target: "_blank", rel: "noopener noreferrer nofollow" }, h("span", { class: "l" }, `${a.social.label} ↗`), h("span", { class: `r mono ${a.fastDumps >= 2 ? "bad" : ""}` }, t("{n} launches · {d} fast dumps", { n: a.launches, d: a.fastDumps }))))),
        );
    }
    if (p.sniper)
      parts.push(
        sec(no(), "As a first-second buyer", "48 hours"),
        h("div", { class: "facts three" }, fact("sniped", String(p.sniper.snipes48h), t("launches"), p.sniper.snipes48h >= 10), fact("sold out of", String(p.sniper.soldOut), ""), fact("out after", secs(p.sniper.medianExitSec), t("usually"))),
        p.sniper.topCreators.length ? h("div", { class: "list", style: { marginTop: "6px" } }, ...p.sniper.topCreators.slice(0, 5).map((x) => h("div", { class: "li" }, h("span", { class: "l" }, t("dev "), addr(ctx, x.creator)), h("span", { class: "r mono" }, x.launches === 1 ? t("1 launch") : t("{n} launches", { n: x.launches }))))) : null,
        p.sniper.recent.length ? h("div", { class: "chips" }, ...p.sniper.recent.slice(0, 8).map((m) => h("button", { class: "chip mono", onclick: () => openToken(ctx, m.mint), title: t("Open its X-Ray") }, `$${sym(m.symbol)}`))) : null,
      );
    if (p.funded.creators.length && !p.funded.hot)
      parts.push(
        sec(no(), "Devs it paid for"),
        h("div", { class: "list" }, ...p.funded.creators.slice(0, 8).map((x) => h("div", { class: "li" }, h("span", { class: "l" }, addr(ctx, x.wallet)), h("span", { class: `r mono ${x.dumped >= 1 ? "bad" : ""}` }, t("{n} launched · {d} dumped", { n: x.launches48h, d: x.dumped }))))),
      );
    parts.push(
      h("div", { class: "actions", style: { gridTemplateColumns: "1fr 1fr" } }, h("a", { class: "btn primary", href: `${SITE}/xray?wallet=${p.wallet}`, target: "_blank", rel: "noopener" }, t("Full page ↗")), h("a", { class: "btn", href: explorer(p.wallet), target: "_blank", rel: "noopener" }, `${explorerName(p.wallet)} ↗`)),
      h("p", { class: "foot mono" }, t("read from public chain data · not financial advice")),
    );
    ctx.root.replaceChildren(...parts.filter(Boolean));
  }

  /** The whole report into `root`. Returns the navigator so the caller can open wallets in the same place. */
  function render(root, report, opts = {}) {
    const ctx = nav(root, opts);
    void go(ctx, { t: "token", id: report.mint, report });
    return ctx;
  }
  function wallet(root, w, opts = {}) {
    const ctx = nav(root, opts);
    void go(ctx, { t: "wallet", id: w });
    return ctx;
  }

  return { render, wallet, h, skeleton, plus };
})();
