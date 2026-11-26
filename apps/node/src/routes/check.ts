import type { IncomingMessage, ServerResponse } from "node:http";
import { type GuardianSession, verifyGuardian } from "../guardian.ts";
import { fundersEnabled, traceFunders } from "../chain/funders.ts";
import { lineage, type LineageView } from "../chain/lineage.ts";
import { socials } from "../chain/socials.ts";
import { exchangeOf, launcherOf } from "../chain/exchanges.ts";
import { holderReport, holdersEnabled, mintRights, poolSolOf } from "../chain/holders.ts";
import { handWithin } from "../chain/hand.ts";
import { checkToken, oddsRunNote, outsideCheck, poolCheck } from "../chain/check.ts";
import { pools } from "./pools.ts";
import { tagAll } from "../chain/tags.ts";
import { originOf } from "../chain/origin.ts";
import { oddsOf } from "../chain/odds.ts";
import { FREE_DEEP_PER_MIN, FREE_PER_MIN, HOLDER_DEEP_PER_MIN, HOLDER_PER_MIN, issueKey, keyFrom, walletOfKey } from "../chain/keys.ts";
import { HOLDER_MIN, isHolder, TOKEN_MINT } from "../holders.ts";
import { tape } from "../chain/pump.ts";
import { adoption } from "../chain/adopt.ts";
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

/** A moment as the notes say it: day, month, hour and minute in UTC. */
const dayOf = (at: number) => `${new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;

export async function checkRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, history, x402, checkGate, holderGate, deepGate, holderDeepGate, keyGate, holding, preferHistory, kept, shills, withCabal, usage, cache } = ctx;
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
    // Solana only since 2026-11-20: a 0x address never reaches here (goneRoutes answers it 410).
    const chain = "solana" as const;
    // A tape with nothing on it and nothing heard reads no chain; a restored one answers while its stream reconnects.
    if (tape.lastEventAt === 0 && tape.status().tracked === 0) return json(res, 404, { error: "this node does not read the chain; use the north node" });
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
      const paidRoute = x402 ? x402.paymentRequired(x402.routes[deep ? "xray" : "check"]!, mint) : null;
      return json(res, 429, { error: `slow down: ${what} a minute on the ${tier.tier} tier`, retryAfterMs: wait, access: tier, ...(holder ? {} : { more: "https://zooaiagency.com/connect#api" }), ...(paidRoute ? { orPay: { x402: paidRoute.resource.url, price: paidRoute.accepts[0]!.amount, asset: "USDC", menu: paidRoute.resource.url.replace(/\/(xray|check)\/[^/]+$/, "") } } : {}) });
    }
    // Where the call came from, for the usage count only: the site and the extension say so in Origin, a key is a holder, the rest is the bare API.
    const from = String(req.headers.origin ?? req.headers.referer ?? "");
    const source = wallet ? "key" : from.startsWith("chrome-extension://") ? "extension" : /zooaiagency\.com|localhost/.test(from) ? "web" : "api";
    void usage.bump(deep, caller, chain, source);
    const stream = { live: tape.connected && Date.now() - tape.lastEventAt < 60_000, lastEventSecAgo: Math.round((Date.now() - tape.lastEventAt) / 1000) };
    let found = tape.token(mint);
    // Older than the tape: the long memory has what it saw of the token, as it stood when last written.
    const past = !found && history ? history.report(mint) : null;
    // Launched before the stream watched: read from the chain now and followed from here on, unless the long memory or the PumpSwap pools already have it.
    if (!found && !past && adoption.current && !pools()?.ofMint(mint)) {
      const s = await adoption.current.ensure(mint, deep ? 6_000 : 2_500);
      if (s.state === "tracked") found = tape.token(mint);
      else if (s.state === "reading" || s.state === "busy") {
        const etaSec = s.state === "reading" ? s.etaSec : 30;
        res.setHeader("cache-control", "no-store");
        res.setHeader("retry-after", String(Math.min(30, Math.max(2, etaSec))));
        const note = s.state === "reading" ? `reading this coin from the chain, about ${etaSec} s` : "the chain reader is busy with other coins, try again in about 30 s";
        return json(res, 202, { mint, chain, reading: true, etaSec, note, stream, access: tier });
      }
    }
    const birth = found ? tape.birthOf(mint) : null;
    const born = birth && (birth.adopted || birth.mintCreatedAt) ? { birth } : {};
    const within = <T>(p: Promise<T>, ms = 4_000) => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
    // Who holds it now and who paid for the creator cost RPC calls: holders only on request, never longer than four seconds.
    const pool = deep && found && holdersEnabled() ? tape.poolOf(mint) : null;
    // The biggest buyers' money traced back: a hand spread over wallets and minutes. Launches the tape holds.
    const handP = deep && found ? handWithin(mint, tape.bigBuyersOf(mint), found.creator) : Promise.resolve(null);
    const [holders, , poolSol] = await Promise.all([
      deep && (found || past) && holdersEnabled() ? within(holderReport(mint, fetch, Date.now(), found?.creator ?? past?.creator ?? null)) : Promise.resolve(undefined),
      deep && found && found.creator && fundersEnabled() && !lineage.view(found.creator) ? within(lineage.trace(found.creator)) : Promise.resolve(null),
      // The pool's SOL as it is now, not as the last trade the tape saw left it.
      pool ? within(poolSolOf(pool)) : Promise.resolve(null),
    ]);
    if (poolSol !== null && poolSol !== undefined) {
      tape.notePoolSol(mint, poolSol);
      found = tape.token(mint);
    }
    let funding: LineageView | null | undefined;
    if (found && found.creator && fundersEnabled()) {
      funding = lineage.view(found.creator);
      if (!funding) lineage.enqueue(found.creator, true);
    }
    if (past) funding = (fundersEnabled() ? lineage.view(past.creator) : null) ?? (past.funder ? { creator: past.creator, funder: past.funder, funderIsHot: exchangeOf(past.funder) != null || launcherOf(past.funder) != null, funderLabel: exchangeOf(past.funder), funderService: launcherOf(past.funder), siblings: [], siblingLaunches48h: 0, siblingDumped48h: 0, tracedAt: past.recordedAt } : null);
    // Holders that could not be ranked (USDC has too many accounts) still leave the mint's rights to read.
    const rights = deep && (found || past) && !holders ? await within(mintRights(mint)) : null;
    const linked = found || past ? socials.forMint(mint) : [];
    const check = checkToken(mint, found ?? past, { stream, chain, ...(deep && (found || past) ? { holders: holders ?? null } : {}), ...(rights ? { rights } : {}), hand: await handP, ...(funding !== undefined ? { lineage: funding } : {}), socials: linked, ...(found ? { tool: tape.printOf(mint), toolShape: tape.shapeOf(mint), operator: tape.operatorOf(found.creator) } : {}) });
    // The odds the first five minutes give, for pump.fun launches the tape still holds.
    if (found) {
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
    if (birth?.mintCreatedAt) check.notes.unshift(`coin created ${dayOf(birth.mintCreatedAt)}, pool opened ${dayOf(birth.poolOpenedAt)}`);
    if (birth?.adopted && birth.adoptedAt) check.notes.unshift(`launched before we watched: read live since ${dayOf(birth.adoptedAt)}, trades before that are the last ones read back from the chain`);
    res.setHeader("cache-control", "no-store");
    const memory = past ? { fromHistory: true, historySince: history!.since(), recordedAt: past.recordedAt } : {};
    if (past) check.notes.unshift(recordNote(past.recordedAt, past.createdAt));
    const image = socials.image(mint);
    if (!image) socials.want(mint);
    // A pool opened straight on PumpSwap that the node read from its own transactions: no launch on record, the pool is the record.
    const listed = !found && !past ? (pools()?.ofMint(mint) ?? null) : null;
    if (listed?.read) {
      const r = listed.read;
      const mine = pools()!.view().pools.find((p) => p.pool === listed.row.pool)?.read ?? null;
      const poolView = { pool: listed.row.pool, volumeUsd: listed.row.volumeUsd, buyers: listed.row.buyers, sellers: listed.row.sellers, solIn: r.solIn, openedAt: r.openedAt, trades: r.trades, sample: r.sample, taken: r.taken, creatorPools: mine?.creatorPools ?? 1, creatorTaken: mine?.creatorTaken ?? 0 };
      const direct = poolCheck(mint, { symbol: listed.row.symbol, solIn: r.solIn, taken: r.taken, sample: r.sample, otherTaken: Math.max(0, poolView.creatorTaken - (r.taken ? 1 : 0)) }, { stream, chain });
      if (checkOf) return json(res, 200, { ...direct, outsideStream: true, createdAt: r.openedAt, pool: poolView, access: tier });
      return json(res, 200, { mint, chain, symbol: listed.row.symbol, name: "", creator: r.creator, createdAt: r.openedAt, check: direct, early: [], creatorRecord: null, devHistory: null, funding: null, bundle: { wallets: [], funding: null }, socials: [], outsideStream: true, pool: poolView, access: tier });
    }
    // Launched before the stream's window: read where it came from, who holds it now and its dev's kept record,
    // only for a full X-Ray (or ?holders=1), which has its own rate limit, so plain checks cost no RPC calls.
    if (!found && !past && deep && holdersEnabled()) {
      const origin = await within(originOf(mint), 6_000);
      if (origin) {
        const holdersNow = await within(holderReport(mint, fetch, Date.now(), origin.creator));
        const rightsNow = holdersNow ? null : await within(mintRights(mint));
        const kept = history?.wallet(origin.creator, 20) ?? null;
        const dev = kept ? { launches: kept.launches, dumped: kept.dumped } : null;
        const outside = outsideCheck(mint, { symbol: origin.symbol, createdAt: origin.createdAt, holders: holdersNow, rights: rightsNow, dev }, { stream, chain });
        let funded: LineageView | null = null;
        if (fundersEnabled()) {
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
    if (checkOf) return json(res, 200, { ...check, ...(image ? { image } : {}), ...memory, ...born, access: tier });
    if (past) {
      const bundle = past.bundle.length >= 2 ? await within(traceFunders(mint, past.bundle.map((b) => b.wallet))) : null;
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
      const where = "pump.fun, LaunchLab, Meteora, Raydium";
      return json(res, 404, { error: history ? `not a launch the stream saw (${where})` : `not a launch the stream saw in the last two days (${where})`, check });
    }
    const bundle = found.bundle.length >= 2 ? await within(traceFunders(found.mint, found.bundle.map((b) => b.wallet))) : null;
    const earlyTagged = withCabal(tagAll(tape.earlyOf(mint) ?? [], kept));
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
      ...born,
      access: tier,
    });
  }
  return false;
}
