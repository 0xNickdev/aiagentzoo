import { readFileSync, writeFileSync, statSync } from "node:fs";
const D = process.argv[2];
const snapAt = statSync(`${D}/chain-tape.json`).mtimeMs;
const tape = JSON.parse(readFileSync(`${D}/chain-tape.json`, "utf8"));
const lin = new Map(JSON.parse(readFileSync(`${D}/chain-lineage.json`, "utf8")).creators);
const soc = new Map(JSON.parse(readFileSync(`${D}/chain-socials.json`, "utf8")).byMint);
const ex = new Set(JSON.parse(readFileSync(`${D}/exchanges.json`, "utf8")).addresses.map((a) => a.address));
const devsPerFunder = new Map();
for (const [, v] of lin) if (v.funder) devsPerFunder.set(v.funder, (devsPerFunder.get(v.funder) ?? 0) + 1);
const SUPPLY = 1e9;
const capOf = (r) => (30 + r) ** 2 / 32.19;
const toks = tape.tokens.filter((t) => !t.quote && !t.venue);
const byCreator = new Map();
for (const t of toks) (byCreator.get(t.creator) ?? byCreator.set(t.creator, []).get(t.creator)).push(t);
const rows = [];
const H = ["mint","ageH","hour","mayhem","still5","dumped5","devSold5","priorLaunches","priorDumped","priorGrad","priorAlive","serial","launchN","launchShare","devShare","buyers1m","buyers5","earlyHeld","earlyWallets","washShare","bumps","creatorCrew","ringWallets","hasX","hasTg","hasWeb","nSocial","funderEx","funderDevs","funderKnown","capFirst","alive","grad","peak","peakAfter5","dumpedLater","dead"];
for (const t of toks) {
  const age = snapAt - t.createdAt;
  if (age < 24 * 3600e3) continue;
  const at = t.createdAt + 5 * 60e3;
  const supply = t.supply ?? (t.mayhem ? 2 * SUPPLY : SUPPLY);
  const prior = (byCreator.get(t.creator) ?? []).filter((o) => o.mint !== t.mint && o.createdAt < at);
  const pd = prior.filter((o) => o.dumped && o.dumpedAt !== null && o.dumpedAt <= at).length;
  const pg = prior.filter((o) => o.graduated && o.createdAt < t.createdAt).length;
  const pa = prior.filter((o) => (o.capPeak ?? 0) >= 85 && (o.capPeakAt ?? Infinity) <= at).length;
  const buyers = t.buyers ?? [];
  const b1 = buyers.filter(([, b]) => b.at !== undefined && b.at <= t.createdAt + 60e3).length;
  const b5 = buyers.filter(([, b]) => b.at !== undefined && b.at <= at).length;
  const lb = t.launchBuys ?? [];
  const lshare = lb.reduce((n, [, v]) => n + v, 0) / supply;
  const s = soc.get(t.mint) ?? [];
  const kinds = new Set(s.map((x) => x.kind));
  const f = lin.get(t.creator)?.funder ?? null;
  let alive = 0, dead = 0;
  if (t.graduated) { if (t.poolSol !== null) { alive = t.poolSol >= 4 ? 1 : 0; dead = t.poolSol < 0.4 ? 1 : 0; } }
  else { const real = t.curveSol ?? (t.buys === 0 ? 0 : null); if (real !== null) { const c = capOf(real); alive = c >= 85 ? 1 : 0; dead = c < 32 ? 1 : 0; } }
  const a5 = t.at5 && t.at5.at !== undefined && t.at5.at - t.createdAt < 10 * 60e3 ? t.at5 : null;
  rows.push([t.mint, (age / 3600e3).toFixed(1), new Date(t.createdAt).getUTCHours(), t.mayhem ? 1 : 0, a5 ? 1 : 0,
    t.dumped && t.dumpedAt !== null && t.dumpedAt <= at ? 1 : 0, t.devFirstSellAt !== undefined && t.devFirstSellAt <= at ? 1 : 0,
    prior.length, pd, pg, pa, pd >= 3 && pd / (prior.length + 1) >= 0.5 ? 1 : 0, lb.length, lshare.toFixed(4), ((t.devBought ?? 0) / supply).toFixed(4), b1, b5,
    a5?.earlyHeld ?? "", a5?.earlyWallets ?? "", a5?.washShare ?? "", a5?.bumps ?? "", a5?.creatorCrew ?? "", a5?.ringWallets ?? "",
    kinds.has("x") ? 1 : 0, kinds.has("tg") || kinds.has("telegram") ? 1 : 0, kinds.has("web") || kinds.has("website") ? 1 : 0, s.length,
    f ? (ex.has(f) ? 1 : 0) : "", f ? devsPerFunder.get(f) ?? 0 : "", lin.has(t.creator) ? 1 : 0,
    (t.capFirst ?? 0).toFixed(1), alive, t.graduated ? 1 : 0, (t.capPeak ?? 0).toFixed(1), (t.capPeakAt ?? 0) > at && (t.capPeak ?? 0) >= 85 ? 1 : 0,
    t.dumped && t.dumpedAt !== null && t.dumpedAt > at ? 1 : 0, dead]);
}
writeFileSync(`${D}/features.csv`, [H.join(","), ...rows.map((r) => r.join(","))].join("\n"));
console.log("rows", rows.length, "kinds", [...new Set([...soc.values()].flat().map((x) => x.kind))]);
