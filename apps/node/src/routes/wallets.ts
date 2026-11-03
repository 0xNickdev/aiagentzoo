import type { IncomingMessage, ServerResponse } from "node:http";
import { fundersEnabled, traceFunders } from "../chain/funders.ts";
import { lineage, type LineageView } from "../chain/lineage.ts";
import { socials } from "../chain/socials.ts";
import { bscLineage, bscSocials } from "../chain/bsc.ts";
import { baseLineage, baseSocials } from "../chain/base.ts";
import { baseFundersEnabled, bscFundersEnabled } from "../chain/bscFunders.ts";
import { tagsOf } from "../chain/tags.ts";
import { ROUTE, norm, fromPeer, clientIp, clampInt, json } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** Wallets: a creator's record, the long-memory dossier, snipers, the wallet page and bundles. */
export async function walletRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { history, checkGate, preferHistory, kept, chainFor, tapeOf, withCabal } = ctx;
  const creatorOf = ROUTE.creator.exec(path);
  if (req.method === "GET" && creatorOf) {
    const w = norm(creatorOf[1]!);
    const hint = url.searchParams.get("chain");
    const found = preferHistory(tapeOf(w, hint).creator(w), w);
    return found ? json(res, 200, { chain: chainFor(w, hint), ...found }) : json(res, 404, { error: "no launches from this wallet in the last two days" });
  }
  // The wallet dossier from the long memory: what it did as a dev, a first-second buyer, a bundler and a crew member.
  const dossierOf = ROUTE.walletHistory.exec(path);
  if (req.method === "GET" && dossierOf) {
    if (!history) return json(res, 404, { error: "this node keeps no chain history; use the north node" });
    const caller = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() || clientIp(req);
    const wait = fromPeer(req) ? 0 : checkGate.take(caller);
    if (wait > 0) return json(res, 429, { error: "slow down: too many lookups a minute on the free tier", retryAfterMs: wait });
    const found = history.wallet(norm(dossierOf[1]!), clampInt(url.searchParams.get("limit"), 50, 1, 200));
    if (!found) return json(res, 404, { error: "this wallet did not launch, snipe or bundle a launch the zoo has kept" });
    res.setHeader("cache-control", "no-store");
    return json(res, 200, { chain: chainFor(norm(dossierOf[1]!), url.searchParams.get("chain")), ...found, historySince: history.since(), keptDays: 90 });
  }
  const sniperOf = ROUTE.sniper.exec(path);
  if (req.method === "GET" && sniperOf) {
    const found = tapeOf(norm(sniperOf[1]!), url.searchParams.get("chain")).sniper(norm(sniperOf[1]!));
    return found ? json(res, 200, found) : json(res, 404, { error: "this wallet sniped no launch in the last two days" });
  }
  // One page per wallet: what it did as a dev, as a first-second buyer and as the one who pays for devs.
  const walletOf = ROUTE.wallet.exec(path);
  if (req.method === "GET" && walletOf) {
    const w = norm(walletOf[1]!);
    const chain = chainFor(w, url.searchParams.get("chain"));
    const evm = chain !== "solana";
    const caller = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() || clientIp(req);
    const wait = fromPeer(req) ? 0 : checkGate.take(caller);
    if (wait > 0) return json(res, 429, { error: "slow down: too many lookups a minute on the free tier", retryAfterMs: wait });
    const walletTape = tapeOf(w, chain);
    const dev = walletTape.creatorProfile(w);
    let funding: LineageView | null = null;
    const evmLineage = chain === "bsc" ? bscLineage : baseLineage;
    if (dev && evm && (chain === "bsc" ? bscFundersEnabled() : baseFundersEnabled())) {
      funding = evmLineage.view(w) ?? null;
      if (!funding) evmLineage.enqueue(w);
    } else if (dev && !evm && fundersEnabled()) {
      funding = lineage.view(w);
      if (!funding) lineage.enqueue(w, true);
    }
    const funded = lineage.funded(w);
    const sniper = walletTape.sniper(w);
    // The accounts this dev's own tokens link to in their metadata: typed by the dev, so a lead, not proof of who it is.
    const seen = new Set<string>();
    const registry = chain === "bsc" ? bscSocials : chain === "base" ? baseSocials : socials;
    const accounts = dev
      ? dev.launches.flatMap((l) => registry.forMint(l.mint)).filter((a) => !seen.has(a.social.url) && seen.add(a.social.url)).slice(0, 10)
      : [];
    if (!dev && !sniper && !funded.creators.length) return json(res, 404, { error: "this wallet did not launch, snipe or fund a launch the stream saw in the last two days" });
    res.setHeader("cache-control", "no-store");
    // The wallet's tags, from what it did on the tape and in the long memory: the same marks the x-ray shows.
    const tags = tagsOf({ wallet: w, snipes48h: sniper?.snipes48h ?? 0, serial: (sniper?.snipes48h ?? 0) >= 10 }, kept(w));
    if (funded.hot && !tags.includes("exchange")) tags.push("exchange");
    const [who] = withCabal([{ wallet: w, tags }]);
    return json(res, 200, { wallet: w, chain, dev, funding, funded, sniper, accounts, ...who, checkedAt: Date.now() });
  }
  const bundleOf = ROUTE.bundle.exec(path);
  if (req.method === "GET" && bundleOf) {
    const t = tapeOf(norm(bundleOf[1]!), url.searchParams.get("chain")).token(norm(bundleOf[1]!));
    if (!t) return json(res, 404, { error: "not on the stream" });
    const funding = t.bundle.length >= 2 ? await traceFunders(t.mint, t.bundle.map((b) => b.wallet)) : null;
    return json(res, 200, { mint: t.mint, bundleWallets: t.facts.bundleWallets, bundleShare: t.facts.bundleShare, wallets: t.bundle, funding, fundingEnabled: fundersEnabled() });
  }
  return false;
}
