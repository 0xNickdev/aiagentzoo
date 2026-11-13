import type { IncomingMessage, ServerResponse } from "node:http";
import { type GuardianSession, verifyGuardian } from "../guardian.ts";
import { fundersEnabled, traceFunders } from "../chain/funders.ts";
import { lineage, type LineageView } from "../chain/lineage.ts";
import { socials } from "../chain/socials.ts";
import { exchangeOf, launcherOf } from "../chain/exchanges.ts";
import { holderReport, holdersEnabled, mintRights, poolSolOf } from "../chain/holders.ts";
import { handWithin } from "../chain/hand.ts";
import { CHAIN_NAME, checkToken, oddsRunNote, outsideCheck } from "../chain/check.ts";
import { bscLineage, bscPoolSol, bscSocials, bscTape, fourMeme, recordFlap, recordFourMeme, WBNB } from "../chain/bsc.ts";
import { baseBook, baseLineage, baseSocials, baseTape, clanker, DEFAULT_RPC as BASE_RPC, POOL_MANAGER, recordClankerFromApi } from "../chain/base.ts";
import { baseFundersEnabled, bscFundersEnabled } from "../chain/bscFunders.ts";
import { tagAll } from "../chain/tags.ts";
import { bscBook, bscHolderReport, evmHolderReport } from "../chain/bscHolders.ts";
import { originOf } from "../chain/origin.ts";
import { oddsOf } from "../chain/odds.ts";
import { FREE_DEEP_PER_MIN, FREE_PER_MIN, HOLDER_DEEP_PER_MIN, HOLDER_PER_MIN, issueKey, keyFrom, walletOfKey } from "../chain/keys.ts";
import { HOLDER_MIN, isHolder, TOKEN_MINT } from "../holders.ts";
import { tape } from "../chain/pump.ts";
import { ROUTE, norm, fromPeer, clientIp, readJson, json } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** The pre-trade check and the X-Ray, its track record and holder keys. */
/** A kept record stops where the record stops: a green on it says nothing about what came after. */
export function recordNote(recordedAt: number, createdAt: number): string {
  const day = new Date(recordedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const h = Math.max(0, (recordedAt - createdAt) / 3_600_000);
  const after = h < 48 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} days`;
  return `trades here stop at our record of ${day}, ${after} after launch: anything later is not in this check`;
}

export async function checkRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, history, x402, checkGate, holderGate, deepGate, holderDeepGate, keyGate, holding, preferHistory, kept, chainFor, tapeOf, shills, withCabal, usage, cache } = ctx;
  // The pre-trade check agents call before buying a pump.fun token: no model, answers in milliseconds.
  if (req.method === "GET" && path === "/v1/check/record") {
    if (tape.lastEventAt === 0) return json(res, 404, { error: "this node does not read the chain; use the north node" });
    if (!cache.checkRecord || Date.now() - cache.checkRecord.at > 10 * 60_000) cache.checkRecord = { at: Date.now(), body: tape.checkRecord() };
    res.setHeader("cache-control", "public, max-age=300");
    return json(res, 200, cache.checkRecord.body);
  }
  // A holder's key for the check: sign in with the wallet, get a key once. Only its hash is kept.
  if (req.method === "POST" && path === "/v1/check/key") {
    if (tape.lastEventAt === 0) return json(res, 404, { error: "this node does not read the chain; use the north node" });
    const body = (await readJson(req).catch(() => null)) as { guardian?: GuardianSession } | null;
    const signed = verifyGuardian(body?.guardian as GuardianSession);
    if (!signed.ok) return json(res, 401, { error: "sign in with your wallet first" });
    const wait = keyGate.take(signed.address);
    if (wait > 0) return json(res, 429, { error: "one new key a minute", retryAfterMs: wait });
    if (!(await isHolder(signed.address).catch(() => false))) {
      return json(res, 403, { error: `hold ${HOLDER_MIN.toLocaleString("en-US")} $ZOOAGENCY for a key; the free tier needs none`, min: HOLDER_MIN, mint: TOKEN_MINT });
    }
    const key = await issueKey(enclosure.store, signed.address);
    return json(res, 200, { key, wallet: signed.address, perMinute: HOLDER_PER_MIN, deepPerMinute: HOLDER_DEEP_PER_MIN, note: "shown once: keep it safe. A new key replaces this one." });
  }
  const checkOf = ROUTE.check.exec(path);
  const xrayOf = ROUTE.xray.exec(path);
  if (req.method === "GET" && (checkOf || xrayOf)) {
    const mint = norm((checkOf ?? xrayOf)![1]!);
    // A 0x address is BNB Chain (four.meme's tape) or Base (Clanker's): the tape that has it says which.
    const chain = chainFor(mint, url.searchParams.get("chain"));
    const bsc = chain === "bsc";
    const base = chain === "base";
    const evm = bsc || base;
    const chainTape = tapeOf(mint, chain);
    // A tape with nothing on it and nothing heard reads no chain; a restored one answers while its stream reconnects.
    if (chainTape.lastEventAt === 0 && chainTape.status().tracked === 0) return json(res, 404, { error: evm ? `this node does not read ${CHAIN_NAME[chain]}; use the north node` : "this node does not read the chain; use the north node" });
    // A key lifts the limits while its wallet still holds; without one, everyone gets the free tier.
    const key = keyFrom(req.headers, url.searchParams);
    let wallet: string | null = null;
    if (key) {
      wallet = await walletOfKey(enclosure.store, key);
      if (!wallet) return json(res, 401, { error: "unknown or replaced key" });
    }
    // The bot on a sibling node asks for all its users at once: it gets the holder allowance.
    const peer = fromPeer(req);
    const holder = peer || (wallet ? await holding.holds(wallet) : false);
    // Behind the site's proxy every caller shares its address, so the free gate keys on the first forwarded hop.
    const first = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
    const caller = peer ? "peer" : holder ? `key:${wallet}` : first || clientIp(req);
    // The x-ray reads Solana for holders and funders, so it always counts as a deep read.
    const deep = Boolean(xrayOf) || url.searchParams.get("holders") === "1";
    const tier = holder
      ? { tier: "holder" as const, perMinute: HOLDER_PER_MIN, deepPerMinute: HOLDER_DEEP_PER_MIN }
      : { tier: "free" as const, perMinute: FREE_PER_MIN, deepPerMinute: FREE_DEEP_PER_MIN };
    const wait = (holder ? holderGate : checkGate).take(caller) || (deep ? (holder ? holderDeepGate : deepGate).take(caller) : 0);
    if (wait > 0) {
      res.setHeader("retry-after", String(Math.ceil(wait / 1000)));
      const what = deep ? `${tier.deepPerMinute} deep reads` : `${tier.perMinute} checks`;
      // Over the free limit, an agent can simply pay for this one call over x402 instead of waiting.
      const paidRoute = x402 && !evm ? x402.paymentRequired(x402.routes[deep ? "xray" : "check"]!, mint) : null;
      return json(res, 429, { error: `slow down: ${what} a minute on the ${tier.tier} tier`, retryAfterMs: wait, access: tier, ...(holder ? {} : { more: "https://zooaiagency.com/connect#api" }), ...(paidRoute ? { orPay: { x402: paidRoute.resource.url, price: paidRoute.accepts[0]!.amount, asset: "USDC", menu: paidRoute.resource.url.replace(/\/(xray|check)\/[^/]+$/, "") } } : {}) });
    }
    void usage.bump(deep, caller, chain);
    // four.meme and Clanker go quiet for minutes at night where pump.fun never does: their streams count as live for longer.
    const liveMs = evm ? 5 * 60_000 : 60_000;
    const stream = { live: chainTape.connected && Date.now() - chainTape.lastEventAt < liveMs, lastEventSecAgo: Math.round((Date.now() - chainTape.lastEventAt) / 1000) };
    let found = chainTape.token(mint);
    // Older than the tape: the long memory has what it saw of the token, as it stood when last written.
    const past = !found && history ? history.report(mint) : null;
    const within = <T>(p: Promise<T>, ms = 4_000) => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
    // Who holds it now and who paid for the creator cost RPC calls: holders only on request, never longer than four seconds.
    // On Base the whole pool lives in Uniswap's PoolManager, with no reserves to read: the tape's own sum stands.
    const pool = deep && found ? (bsc ? bscTape.poolOf(mint) : base ? null : holdersEnabled() ? tape.poolOf(mint) : null) : null;
    const evmLineage = bsc ? bscLineage : baseLineage;
    const evmFunders = bsc ? bscFundersEnabled() : baseFundersEnabled();
    // The biggest buyers' money traced back: a hand spread over wallets and minutes. Solana launches the tape holds.
    const handP = deep && found && !evm ? handWithin(mint, tape.bigBuyersOf(mint), found.creator) : Promise.resolve(null);
    const [holders, , poolSol] = await Promise.all([
      deep && (found || past) && !evm && holdersEnabled()
        ? within(holderReport(mint, fetch, Date.now(), found?.creator ?? past?.creator ?? null))
        : // On BNB Chain and Base the wallets the feed saw trade are asked for their balance on chain, the creator first.
          deep && bsc && found
          ? within(bscHolderReport(mint, found.creator, [...new Set([...bscBook.top(mint), ...bscTape.positionsOf(mint)])]))
          : deep && base && found
            ? within(evmHolderReport(mint, found.creator, [...new Set([...baseBook.top(mint), ...baseTape.positionsOf(mint)])], { program: POOL_MANAGER, url: process.env.BASE_RPC_URL ?? BASE_RPC }))
            : Promise.resolve(undefined),
      deep && found && !evm && fundersEnabled() && !lineage.view(found.creator)
        ? within(lineage.trace(found.creator))
        : deep && found && evm && evmFunders && !evmLineage.view(found.creator)
          ? within(evmLineage.trace(found.creator))
          : Promise.resolve(null),
      // The pool's SOL (or BNB) as it is now, not as the last trade the tape saw left it.
      pool ? within(bsc ? bscPoolSol(pool, BigInt(mint) < BigInt(found!.facts.quote ?? WBNB)) : poolSolOf(pool)) : Promise.resolve(null),
    ]);
    if (poolSol !== null && poolSol !== undefined) {
      tape.notePoolSol(mint, poolSol);
      found = tape.token(mint);
    }
    let funding: LineageView | null | undefined;
    if (found && !evm && fundersEnabled()) {
      funding = lineage.view(found.creator);
      if (!funding) lineage.enqueue(found.creator, true);
    } else if (found && evm && evmFunders) {
      funding = evmLineage.view(found.creator);
      if (!funding) evmLineage.enqueue(found.creator);
    }
    if (past && !evm) funding = (fundersEnabled() ? lineage.view(past.creator) : null) ?? (past.funder ? { creator: past.creator, funder: past.funder, funderIsHot: exchangeOf(past.funder) != null || launcherOf(past.funder) != null, funderLabel: exchangeOf(past.funder), funderService: launcherOf(past.funder), siblings: [], siblingLaunches48h: 0, siblingDumped48h: 0, tracedAt: past.recordedAt } : null);
    // Holders that could not be ranked (USDC has too many accounts) still leave the mint's rights to read.
    const rights = deep && (found || past) && !evm && !holders ? await within(mintRights(mint)) : null;
    const linked = found || past ? (bsc ? bscSocials : base ? baseSocials : socials).forMint(mint) : [];
    const check = checkToken(mint, found ?? past, { stream, chain, ...(deep && (found || past) && (!evm || holders !== undefined) ? { holders: holders ?? null } : {}), ...(rights ? { rights } : {}), hand: await handP, ...(funding !== undefined ? { lineage: funding } : {}), socials: linked, ...(found && !evm ? { tool: tape.printOf(mint), toolShape: tape.shapeOf(mint), operator: tape.operatorOf(found.creator) } : {}) });
    // The odds the first five minutes give, for pump.fun launches the tape still holds.
    if (found && !evm) {
      const funder = lineage.funderOf(found.creator) ?? null;
      const read = tape.oddsInputs(mint, { social: linked.length > 0, funderExchange: exchangeOf(funder) != null, funderMany: funder ? lineage.devsOf(funder).size >= 3 : false });
      if (read) {
        const odds = oddsOf(read.inputs, read.at, read);
        // What the dev did since: the odds stay, as the record of what minute five said.
        const dumped = (found.facts.creatorSold ?? 0) >= 0.5;
        check.odds = odds.devDumps !== null && (dumped || read.ageMin >= 60) ? { ...odds, devSettled: { dumped, ageMin: read.ageMin } } : odds;
        const runs = oddsRunNote(check.verdict, odds.vsAverage);
        if (runs) check.notes.unshift(runs);
      }
    }
    res.setHeader("cache-control", "no-store");
    const memory = past ? { fromHistory: true, historySince: history!.since(), recordedAt: past.recordedAt } : {};
    if (past) check.notes.unshift(recordNote(past.recordedAt, past.createdAt));
    const image = bsc ? (bscSocials.image(mint) ?? fourMeme.image(mint)) : base ? (baseSocials.image(mint) ?? clanker.image(mint)) : socials.image(mint);
    if (!image) bsc ? void (bscTape.venueOf(mint) === "flap" ? recordFlap(mint) : recordFourMeme(mint)) : base ? void recordClankerFromApi(mint) : socials.want(mint);
    // Launched before the stream's window: read where it came from, who holds it now and its dev's kept record,
    // only for a full X-Ray (or ?holders=1), which has its own rate limit, so plain checks cost no RPC calls.
    if (!found && !past && deep && (evm || holdersEnabled())) {
      const origin = bsc ? await within(fourMeme.get(mint), 6_000) : base ? await within(clanker.get(mint), 6_000) : await within(originOf(mint), 6_000);
      if (origin) {
        const holdersNow = evm ? undefined : await within(holderReport(mint, fetch, Date.now(), origin.creator));
        const rightsNow = evm || holdersNow ? null : await within(mintRights(mint));
        const kept = history?.wallet(origin.creator, 20) ?? null;
        const dev = kept ? { launches: kept.launches, dumped: kept.dumped } : null;
        const outside = outsideCheck(mint, { symbol: origin.symbol, createdAt: origin.createdAt, holders: holdersNow, rights: rightsNow, dev }, { stream, chain });
        let funded: LineageView | null = null;
        if (evm && evmFunders) {
          funded = evmLineage.view(origin.creator) ?? null;
          if (!funded) evmLineage.enqueue(origin.creator);
        } else if (!evm && fundersEnabled()) {
          funded = lineage.view(origin.creator);
          if (!funded) lineage.enqueue(origin.creator, true);
        }
        if (checkOf) return json(res, 200, { ...outside, ...(image ? { image } : {}), outsideStream: true, createdAt: origin.createdAt, access: tier });
        return json(res, 200, {
          mint,
          chain,
          symbol: origin.symbol ?? "",
          name: origin.name ?? "",
          creator: origin.creator,
          createdAt: origin.createdAt,
          check: outside,
          early: [],
          creatorRecord: null,
          devHistory: kept ? { launches: kept.launches, dumped: kept.dumped, tokens: kept.tokens.slice(0, 8) } : null,
          funding: funded,
          bundle: { wallets: [], funding: null },
          socials: [],
          outsideStream: true,
          access: tier,
        });
      }
    }
    if (checkOf) return json(res, 200, { ...check, ...(image ? { image } : {}), ...memory, access: tier });
    if (past) {
      const bundle = past.bundle.length >= 2 && !evm ? await within(traceFunders(mint, past.bundle.map((b) => b.wallet))) : null;
      return json(res, 200, {
        mint,
        chain,
        symbol: past.symbol,
        name: past.name,
        creator: past.creator,
        createdAt: past.createdAt,
        check,
        early: withCabal(tagAll(past.early, kept)),
        creatorRecord: preferHistory(past.creatorRecord, past.creator),
        funding: funding ?? null,
        bundle: { wallets: withCabal(tagAll(past.bundle, kept)), funding: bundle },
        socials: linked,
        ticker: history ? history.ticker(past.symbol, mint) : null,
        ...memory,
        access: tier,
      });
    }
    if (!found) {
      const where = bsc ? "four.meme, Flap" : base ? "Clanker" : "pump.fun, LaunchLab, Meteora";
      return json(res, 404, { error: history ? `not a launch the stream saw (${where})` : `not a launch the stream saw in the last two days (${where})`, check });
    }
    const bundle = found.bundle.length >= 2 && !evm ? await within(traceFunders(found.mint, found.bundle.map((b) => b.wallet))) : null;
    const earlyTagged = withCabal(tagAll(chainTape.earlyOf(mint) ?? [], kept));
    return json(res, 200, {
      mint,
      chain,
      symbol: found.symbol,
      name: found.name,
      creator: found.creator,
      createdAt: found.createdAt,
      check,
      early: earlyTagged,
      ...shills(mint, earlyTagged, found.createdAt, check),
      creatorRecord: preferHistory(found.creatorRecord, found.creator),
      funding: funding ?? null,
      bundle: { wallets: withCabal(tagAll(found.bundle, kept)), funding: bundle },
      socials: linked,
      ticker: history ? history.ticker(found.symbol, mint) : null,
      access: tier,
    });
  }
  return false;
}
