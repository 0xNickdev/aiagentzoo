// On X: next to a token address in a post, a small chip with the X-Ray verdict. Unknown addresses get nothing.
(() => {
  if (window.__zooXrayX) return;
  window.__zooXrayX = true;
  const { TONE, ask, SITE } = ZOO;
  const RE = /0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const seen = new Map(); // address -> verdict promise
  const queue = [];
  let busy = 0;

  const verdictOf = (addr) => {
    if (!seen.has(addr))
      seen.set(
        addr,
        new Promise((res) => {
          queue.push({ addr, res });
          pump();
        }),
      );
    return seen.get(addr);
  };
  function pump() {
    while (busy < 3 && queue.length) {
      const { addr, res } = queue.shift();
      busy++;
      ask({ type: "check", mint: addr })
        .then((r) => res(r?.check && r.check.verdict !== "unknown" ? { mint: r.mint, verdict: r.check.verdict, why: r.check.reasons?.[0] || "" } : null))
        .catch(() => res(null))
        .finally(() => {
          busy--;
          pump();
        });
    }
  }

  function chip(v) {
    const tone = TONE[v.verdict];
    const zh = lang() === "zh";
    const a = document.createElement("a");
    a.href = `${SITE}/xray?mint=${v.mint}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = `ZOOAI X-Ray: ${tone.label}${v.why ? ` · ${tChain(v.why)}` : ""}`;
    if (zh) a.lang = "zh-CN";
    a.dataset.zooChip = "1";
    a.addEventListener("click", (e) => e.stopPropagation());
    // Small and square-ish like the labels other X tools draw, so it sits next to them without shouting.
    a.style.cssText = `display:inline-flex;align-items:center;gap:6px;height:18px;margin:0 2px 0 6px;padding:0 7px 0 6px;border-radius:5px;vertical-align:-3px;
      font:500 10.5px/1 ui-monospace,SFMono-Regular,Menlo,${zh ? `"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",` : ""}monospace;letter-spacing:${zh ? 0 : ".06em"};text-decoration:none;white-space:nowrap;
      color:${tone.color};background:#121214;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);`;
    const dot = document.createElement("span");
    dot.style.cssText = `width:5px;height:5px;border-radius:50%;background:${tone.color};box-shadow:0 0 5px ${tone.color}`;
    const brand = document.createElement("span");
    brand.style.cssText = "color:rgba(238,237,233,.45);letter-spacing:.14em";
    brand.textContent = "X-RAY";
    a.append(dot, brand, document.createTextNode(tone.label));
    return a;
  }

  async function scan(el) {
    if (el.dataset.zooScanned) return;
    el.dataset.zooScanned = "1";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const m = n.textContent.match(RE);
      if (m) hits.push([n, [...new Set(m)]]);
    }
    for (const [node, addrs] of hits) {
      for (const addr of addrs) {
        const v = await verdictOf(addr);
        if (!v || !node.parentNode) continue;
        if (node.nextSibling?.dataset?.zooChip) continue;
        node.parentNode.insertBefore(chip(v), node.nextSibling);
      }
    }
  }

  const SEL = '[data-testid="tweetText"], [data-testid="UserDescription"]';
  const sweep = () => document.querySelectorAll(SEL).forEach((el) => void scan(el));
  let timer = 0;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(sweep, 400);
  }).observe(document.body, { childList: true, subtree: true });
  sweep();
})();
