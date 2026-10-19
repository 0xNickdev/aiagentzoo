// Shared by the popup and the content scripts: where the zoo lives, how a verdict looks, how to find a token in text.
var ZOO = (() => {
  const SITE = "https://zooaiagency.com";
  const BOT = "https://t.me/zooaiagency_bot";
  const TONE = {
    avoid: { label: "AVOID", color: "#ff8a7e", badge: "!!", badgeBg: "#d9584b" },
    caution: { label: "CAUTION", color: "#f2d39b", badge: "!", badgeBg: "#b8913f" },
    pass: { label: "NO RED FLAGS", color: "#9df3b0", badge: "ok", badgeBg: "#3f8f55" },
    unknown: { label: "NOT ON THE STREAM", color: "#e9e4d8", badge: "", badgeBg: "#444" },
  };
  const VENUE = { "pump.fun": "pump.fun", launchlab: "Raydium LaunchLab", dbc: "Meteora" };
  const B58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  /** Every Solana address in a piece of text, longest first so a token beats a shorter fragment. */
  const addresses = (text) => [...new Set((String(text || "").match(B58) || []).filter((a) => a.length >= 32))];
  const pct = (x) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x > 0 ? `${(x * 100).toFixed(1)}%` : "0%");
  const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
  const secs = (s) => (s === null || s === undefined ? "-" : s < 120 ? `${s}s` : `${Math.round(s / 60)}m`);
  const sym = (s) => String(s || "?").replace(/^\$+/, "");
  const ask = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? { error: "The extension restarted. Reload the page." } : r)));
  return { SITE, BOT, TONE, VENUE, addresses, pct, short, secs, sym, ask };
})();
