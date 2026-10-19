// On X: next to a token address in a post, a small chip with the X-Ray verdict. Unknown addresses get nothing.
(() => {
  if (window.__zooXrayX) return;
  window.__zooXrayX = true;
  const { TONE, ask, SITE } = ZOO;
  const RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
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
    const t = TONE[v.verdict];
    const a = document.createElement("a");
    a.href = `${SITE}/xray?mint=${v.mint}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = `ZOOAI X-Ray: ${t.label}${v.why ? ` · ${v.why}` : ""}`;
    a.dataset.zooChip = "1";
    a.addEventListener("click", (e) => e.stopPropagation());
    a.style.cssText = `display:inline-flex;align-items:center;gap:5px;margin:0 2px 0 6px;padding:1px 8px 1px 6px;border-radius:999px;vertical-align:1px;
      font:500 11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;text-decoration:none;white-space:nowrap;
      color:${t.color};background:rgba(5,8,7,.92);box-shadow:inset 0 0 0 1px ${t.color}55;`;
    const dot = document.createElement("span");
    dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${t.color};box-shadow:0 0 6px ${t.color}`;
    a.append(dot, document.createTextNode(`X-Ray · ${t.label}`));
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
  let t = 0;
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(sweep, 400);
  }).observe(document.body, { childList: true, subtree: true });
  sweep();
})();
