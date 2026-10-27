# ZOOAI Creator Check

Before you buy a token launched on pump.fun, check whether its creator already ran.

This complements a contract check such as `rug-check`. On pump.fun every token passes the contract checks by design: mint and freeze authority are revoked, and the liquidity is burned at graduation. The rug there is behavioural: the creator selling into the first buyers, a few wallets taking the supply in the launch block, the creator's own wallets sniping the first seconds, a fresh creator wallet paid for by a known rugger, one wallet launching and dumping hundreds of tokens a day. This skill checks exactly that, from what happened on chain.

ZOOAI AGENCY reads every launch and trade on pump.fun, PumpSwap, Raydium LaunchLab (bonk.fun, StonkFun and others) and Meteora's bonding curve (Believe, bags and others) straight from Solana as it happens, every four.meme and Flap launch, buy, sell and graduation straight from BNB Chain, and every Clanker launch and Uniswap v4 swap straight from Base. The check answers for all of them; `facts.venue` says which (`pump.fun`, `launchlab`, `dbc`, `fourmeme`, `flap`, `clanker`), and `facts.platform` names the platform on that launchpad when it is known (`stonk` is StonkFun, a LaunchLab launch; `Bankr` is a Clanker launch asked for through Bankr). A BNB Chain or Base token is its `0x` address (forty hex digits); the two chains share that shape, so every answer carries `chain` (`solana`, `bsc` or `base`), and a request about a `0x` address no stream has seen may say which with `?chain=base` (BNB Chain is assumed otherwise). On both EVM chains `holders` is read from the chain on a deep read, `funding` only where the operator set a key for it, and the amounts in `facts` (`bundledSol`, `curveSol`) are in BNB or ETH, or in the quote token when `facts.quote` names one. A Clanker token has no bonding curve: it trades in its Uniswap pool from the first second, so it never `graduated`, and its first buyers, bundles and the dev's exit are read from that pool. Its own accuracy record is pump.fun's, the curve the zoo grades by. One call, no key, no cost, answers in well under a second.

## When to call it

- Before every buy of a recently launched Solana, BNB Chain or Base token, above all a pump.fun, four.meme or Clanker launch: sniping, momentum buys, swaps into anything new.
- Before adding to a position in such a token. A creator can sell after your first buy.
- When the user pastes a token address and asks about it before buying.

Skip it for SOL, USDC and established tokens: it knows launches, not old tokens. The stream is read live and keeps every launch on its tape for 48 hours; after that, `history.db` keeps what the check and the x-ray need about each launch for 90 days. An answer from that memory carries `fromHistory: true`, `historySince` (when the memory starts, ms) and `recordedAt` (when the launch was last written to it, ms). `unknown` means the stream never saw the token, or it is older than the history.

## How

```
GET https://zooaiagency.com/api/check/<token address>
GET https://zooaiagency.com/api/check/<token address>?holders=1
```

`?holders=1` also reads who holds the token right now (adds up to 4 seconds). Use it before a large buy: it catches a creator who moved the bag to other wallets instead of selling, and a single wallet sitting on the supply.

A real answer (October 23, 2026, check version 5, with `?holders=1`), for a wallet that launched 653 tokens in two days:

```json
{
  "version": 5,
  "mint": "GVk9wZXuCioKkrLtyoUymeY1JBjPnZJQZKopq6Typump",
  "symbol": "NEKO AI",
  "verdict": "avoid",
  "proceed": false,
  "reasons": [
    "the creator sold 100% of their own bag",
    "this creator dumped 644 of their 653 launches in 48 hours, usually 1 min after launch"
  ],
  "notes": [
    "only 4 min old: more can show up, check again before adding",
    "launched in Mayhem Mode: two billion supply, and pump.fun's own bot trades it for the first 24 hours, so its volume is partly that bot"
  ],
  "facts": {
    "ageMin": 4, "buyers": 3, "buys": 12, "sells": 5,
    "creatorSoldPct": 100, "creatorLaunches24h": 329, "creatorDumped48h": 644, "creatorMedianDumpMin": 1,
    "bundleWallets": 0, "bundleSharePct": 0, "bundlers": 0, "bundlersHeldPct": 0, "bundlersPeakPct": 0, "bundledSol": 0, "bundlesSince": null,
    "top5BuyingPct": 100, "graduated": false, "quote": null, "mayhem": true, "venue": "pump.fun", "curveSol": 0, "poolSol": null,
    "earlyWallets": 2, "earlyHeldPct": 1, "churnPct": 0, "bumps": 0, "creatorCrew": 0, "ringWallets": 0, "serialSnipers": 2, "crewHeldPct": 0,
    "devGone": false, "runnerDev": false
  },
  "holders": { "top10Pct": 0, "topWalletPct": 0, "creatorHoldsPct": 0, "programPct": 100 },
  "funding": { "funder": null, "funderIsHot": false, "otherCreators": 0, "theirLaunches48h": 0, "theirDumps48h": 0 },
  "stream": { "live": true, "lastEventSecAgo": 0 },
  "checkedAt": 1792754796154,
  "more": "https://zooaiagency.com/skill.md",
  "access": { "tier": "free", "perMinute": 120, "deepPerMinute": 10 }
}
```

### facts

| field | what it is |
|---|---|
| `ageMin`, `buyers`, `buys`, `sells` | age in minutes and the trading so far |
| `creatorSoldPct` | share of their own bag the creator has sold |
| `creatorLaunches24h`, `creatorDumped48h`, `creatorMedianDumpMin` | the creator's launches in 24 hours, how many of their launches they dumped in 48 hours, and how fast, in minutes |
| `bundleWallets`, `bundleSharePct` | wallets other than the creator that bought in the launch block, and the share of supply they took |
| `bundlers` | wallets that bought in bundles (four or more in one block) at any point of its life |
| `bundlersHeldPct`, `bundlersPeakPct` | what those bundlers hold now, and the most they held together, of the supply |
| `bundledSol` | SOL spent in those bundles |
| `bundlesSince` | for tokens older than the bundle reader: bundles are counted only from this time (ms), else `null` |
| `top5BuyingPct` | share of all buying done by the top 5 buyers |
| `graduated`, `curveSol`, `poolSol` | whether it left the curve, SOL in the curve, SOL in the pool |
| `quote` | the token it trades against when not SOL (then `curveSol` is `null`) |
| `venue` | `pump.fun`, `launchlab` (Raydium LaunchLab), `dbc` (Meteora's bonding curve), `fourmeme` (four.meme on BNB Chain), `flap` (Flap on BNB Chain; `facts.platform` carries its tax, e.g. `tax 9%`) or `clanker` (Clanker on Base) |
| `platform` | present when known: the platform on that launchpad, e.g. `stonk` (shown as StonkFun) |
| `mayhem` | launched in pump.fun's Mayhem Mode: 2 billion supply, and pump.fun's own bot trades it for 24 hours, so churn, bumps and bundles are not flagged |
| `earlyWallets` | wallets other than the creator that bought in the first 5 seconds (snipers and the launch block) |
| `earlyHeldPct` | share of the supply those wallets still hold, from curve trades |
| `creatorCrew` | first-second wallets that keep sniping this creator's other launches (half or more of everything they snipe is this creator's): the creator's own wallets, however they were funded |
| `ringWallets` | first-second wallets that have sniped 3+ launches together before, mostly together: one operator |
| `serialSnipers` | first-second wallets that sniped 10+ launches in two days |
| `crewHeldPct` | what the creator's crew and ring wallets still hold, of the supply |
| `churnPct` | at least this share of curve volume came from wallets that bought and sold it back (3+ trades, 90%+ sold) |
| `bumps` | a wallet buying and selling in the same transaction: a bump bot |
| `devGone` | the dev dumped and fully left, and the coin carries on with its holders (see below) |
| `runnerDev` | the dev sells early, but most of their coins ran past $20K: their selling was softened to caution (see below) |

Percentages in `facts` are whole numbers. `holders` (only with `?holders=1`, and in the x-ray) gives shares of the supply to one decimal, so a coin everyone sold back shows 0.3%, not 0%: `top10Pct` (the 10 largest wallets), `topWalletPct` (the largest one), `creatorHoldsPct` (the creator, `null` when unknown) and `programPct` (held by program accounts: the pool, locks, vaults; left out of the others). `holders` is `null` when Solana could not be read; a note says so.

`funding`, when the node has an RPC: who sent the creator its SOL (`funder`), whether that is an exchange (`funderIsHot`, then it ties no one together), and the other creators the same wallet paid for with their launches and dumps over 48 hours (`otherCreators`, `theirLaunches48h`, `theirDumps48h`). A creator never traced before is queued and traced within a minute; ask again.

## The full picture: x-ray

```
GET https://zooaiagency.com/api/xray/<token address>
```

Everything the check knows plus the evidence: `check` (the same answer as above, with holders), `early` (every first-second wallet: what it took, what it still holds, when it sold out, how many launches it sniped in 48 hours, crew / ring / serial), `creatorRecord`, `funding` (who funded the creator and the other creators that wallet funded), `bundle` (the launch-block wallets and who funded them) and `socials` (the X or Telegram accounts the token links to, and what else they were on). It reads Solana, so it counts against the deep-read limit. People see it at https://zooaiagency.com/xray.

`creatorRecord` is what the creator did across their launches:

| field | what it is |
|---|---|
| `launches24h`, `launches48h`, `dumped`, `medianDumpMin`, `graduated` | launches, how many they dumped (sold half their bag or more), how fast, and how many graduated |
| `recent[]` | their last launches, one row each: `mint`, `symbol`, `createdAt`, `dumpedAfterMin` / `dumpedAfterSec` (when the dev sold), `devTookSol` (SOL taken out beyond what they put in; negative at a loss), `leftHolding` (buyers still holding when the dev sold), `alive`, `graduated`, `firstCapUsd` / `peakCapUsd` / `peakAfterSec` (first-second cap, peak cap, and when it peaked), `dumpCapUsd` (cap where the dev dumped), `afterDumpLowPct` (in the 30 minutes after the dump, the lowest it went, as a fraction like -0.34), `afterDumpHighX` (the most it rose in those 30 minutes, as a multiple), `devFirstSellSec` |
| `pattern` | medians over their launches, `null` with fewer than two priced ones: `launches` (priced launches the medians rest on), `firstCapUsd`, `peakCapUsd`, `upsideX` (peak over first-second cap), `peakAfterSec`, `reached20k` (share of launches that peaked past $20K, as a fraction), `firstSellSec`, `dumpCapUsd`, `afterDumpLowPct`, `afterDumpDoubled`, `dumps` (launches with a dev dump) |
| `repeats` | tickers launched more than once: `[{ "symbol": "PAW", "n": 4 }]` |
| `tempo` | `{ "perDay": n, "idleDays": n }`: launches a day while active, and days since the last one |

Caps are in dollars at today's SOL price. It describes their habits; it never recommends.

## What each verdict means and what to do

| verdict | proceed | what fired | do this |
|---|---|---|---|
| `avoid` | `false` | the creator sold half their bag or more; the creator dumped most of their launches in 48h (3 or more, and at least half); launch spam: the wallet launched 30+ tokens in 24 hours; 3+ wallets took 15%+ of supply in the launch block; later bundles: 10+ bundlers whose peak together was 30%+ of supply and who still hold 40%+; 2+ of the first-second wallets are the creator's crew; 3+ first-second wallets still hold half the supply; the wallet that funded the creator funded other launchers who dumped most of their launches; the X or Telegram account the token links to is also on other launches whose dev sold within 5 minutes, 3+ times; 6h+ old and the curve is back at its opening; graduated pool under 0.4 SOL; with `holders=1`: one wallet holds 50%+ | Do not buy. Tell the user the `reasons`, word for word. |
| `caution` | `false` | the creator sold part of their bag (over 10%); 3+ launches by the creator in 24 hours; later bundles (10+ bundlers, peak 30%+) that now hold under 40%; the linked X or Telegram account is on 2 fast-dumped launches; first-second wallets still hold 25%+; 3+ first-second wallets in a sniper ring, or 3+ serial snipers; top 5 buyers took over half the buying; under 10 buyers; sells outnumber buys 2:1; 30%+ churned volume; 3+ bump bot trades; with `holders=1`: one wallet holds 20%+, the top 10 hold 50%+, or the creator holds nothing yet never sold; and the softened cases below | Do not buy on your own. If the user insists, quote the `reasons` first and keep the size small. |
| `pass` | `true` | none of the above | Decide with your own strategy. Pass means no red flags were seen on chain, not that the price will rise. |
| `unknown` | `null` | the stream never saw it as a launch on pump.fun, Raydium LaunchLab or Meteora's bonding curve, or it is older than the 90-day history | Use your other checks. |

In Mayhem Mode pump.fun's own bot trades from the first second, so later bundles, churn and bumps are not flagged, and first-second wallets holding half the supply is caution, not avoid.

Two cases soften an `avoid` to `caution`, never further:

- **Dev gone** (`facts.devGone: true`, needs the holders, so `holders=1` or the x-ray): the dev dumped and fully left (sold 99%+ and holds nothing), the coin graduated, its pool holds at least twice what it opened with and never drained, it is 2 hours old or more, the top 10 hold under 30%, no wallet holds 10%+, bundlers hold under 20% and first-second wallets under half. Then the dev's record no longer decides and every avoid reason becomes caution, led by "it runs on its holders now, so the risk is the market, not the dev". If the dev's crew still holds 5% or more, it stays `avoid`: the dev sold to shake out the snipers and came back through their own wallets.
- **Runner dev** (`facts.runnerDev: true`): the dev has 5+ priced launches and 50%+ of them went past $20K. When the only avoid reasons are the creator selling, their dump history or a bundle at launch, those become caution: selling fast is their pattern, so the risk is getting out in time. Any other avoid reason keeps it `avoid`.

In its first 10 minutes a token has had no time to show anything but its creator's history. Then the check answers `pass` when the creator's history shows no red flags, with a note `just launched` (under a minute) or `only N min old`: buy small, and call the check again before adding.

Always read `notes`. If `stream.live` is `false`, the chain stream behind the answer is down and a fresh launch may be missing: treat the answer as `unknown`.

## How accurate it is

The check keeps its own record, recomputed every 10 minutes and public:

```
GET https://zooaiagency.com/api/check/record
```

It takes every launch from 24 to 48 hours ago, works out what the check would have said five minutes after launch, and compares that with where the token stands a day later, by the same lines the zoo grades its agents with: under 32 SOL of curve market cap (back near the 28 it opens at) or a pool under 0.4 SOL is dead; 85 SOL of cap or a pool of 4 SOL or more is alive.

First reading, October 16, 2026, 174 launches (the window fills to thousands a day as the record grows):

| at 5 minutes the check said | launches | dead a day later | alive a day later |
|---|---|---|---|
| `avoid` | 123 | 119 (97%) | 1 |
| no red flag | 51 | 48 (94%) | 1 |

The version 3 signals are measured the same way, each on its own, under `signals` in the record: first-second wallets holding 25%+, the creator's crew, sniper rings, churn, bump bots, against all tokens still trading five minutes in. Their first full 24-48 hour window is ready on October 19, 2026.

What this means, plainly: when the check says `avoid`, it is almost never wrong about the token dying. But on pump.fun nearly everything dies, flagged or not, so `pass` is not a reason to buy. The check is a filter that removes the worst, not a signal that finds winners. 115 of these 174 creators had already sold within five minutes of launch.

## More of the read API

The site proxies the north node's API: `https://zooaiagency.com/api/north/<path>` reaches `https://north.zooaiagency.com/<path>`. The ones a trading agent may want:

| path | what it gives |
|---|---|
| `/v1/wallet/<wallet>` | one wallet from the live tape: its launches as a dev, its sniping, who funded it and whom it funded, the accounts its tokens link to |
| `/v1/wallet/<wallet>/history` | the same wallet from the 90-day history: what it did as a dev, first-second buyer, bundler and crew member (`?limit=`, up to 200) |
| `/v1/chain/creator/<wallet>` | a creator's record, the same shape as the x-ray's `creatorRecord` |
| `/v1/chain/clean` | fresh coins with no red flags so far (`?limit=`, up to 50; `?wide=1` widens the age window) |
| `/v1/chain/moments` | notable moments on the tape, 48 hours (`?symbol=`, `?mint=`, `?kind=`, `?limit=`) |
| `/v1/chain/swaps/<mint>` | trades on a token the node follows, such as $ZOOAGENCY (`?after=` a time in ms) |

The wallet lookups count against the check limit. A `404` means the wallet or token is not in what the node has kept.

## Limits and errors

| tier | who | checks a minute | `holders=1` and x-ray reads a minute |
|---|---|---|---|
| free | everyone, no key | 120 | 10 |
| holder | wallets holding 500,000+ $ZOOAGENCY, one key each | 1,200 | 300 |

The free tier is enough for any single agent, and it stays free. A bot that checks every launch can get a holder key at https://zooaiagency.com/connect#api (sign in with the wallet; a signature, not a transaction) and send it as `Authorization: Bearer zk_...`. Every answer carries `access` with the tier and limits in use. If the wallet stops holding, the key falls back to the free limits.

- Over the limit: HTTP `429` with `retryAfterMs`. Wait, do not retry in a loop.
- `401`: an unknown or replaced key.
- If there is no answer within 5 seconds, treat it as `unknown`.
- `404` means the request reached a node that does not read the chain; use the address above.

## Why trust it

The data is read straight from Solana, BNB Chain and Base by ZOOAI AGENCY's own streams. The code is open: https://github.com/0xNickdev/aiagentzoo (`apps/node/src/chain/check.ts`). Every call the zoo's agents make is re-checked the next day and scored in public on a signed log: https://zooaiagency.com/docs/grading. Not financial advice.
