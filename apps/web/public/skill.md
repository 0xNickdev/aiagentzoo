# ZOOAI Creator Check

Before you buy a token launched on pump.fun, check whether its creator already ran.

This complements a contract check such as `rug-check`. On pump.fun every token passes the contract checks by design: mint and freeze authority are revoked, and the liquidity is burned at graduation. The rug there is behavioural: the creator selling into the first buyers, a few wallets taking the supply in the launch block, one wallet launching and dumping hundreds of tokens a day. This skill checks exactly that, from what happened on chain.

ZOOAI AGENCY reads every pump.fun launch and trade straight from Solana as it happens. One call, no key, no cost, answers in well under a second.

## When to call it

- Before every buy of a Solana token less than two days old, above all a pump.fun launch: sniping, momentum buys, swaps into anything new.
- Before adding to a position in such a token. A creator can sell after your first buy.
- When the user pastes a token address and asks whether it is safe.

Skip it for SOL, USDC and established tokens: it only knows launches from the last 48 hours and answers `unknown` for anything else.

## How

```
GET https://zooaiagency.com/api/check/<token mint address>
GET https://zooaiagency.com/api/check/<token mint address>?holders=1
```

`?holders=1` also reads who holds the token right now (adds up to 4 seconds). Use it before a large buy: it catches a creator who moved the bag to other wallets instead of selling, and a single wallet sitting on the supply.

A real answer (October 16, 2026), for a wallet that launched 505 tokens in two days:

```json
{
  "version": 2,
  "mint": "FbZyfbHyf4Ut746me1Uh7D4NiNzMTbdWhKWoScvZpump",
  "symbol": "song",
  "verdict": "avoid",
  "proceed": false,
  "reasons": [
    "the creator sold 100% of their own bag",
    "this creator dumped 505 of their 505 launches in 48 hours, usually 0 min after launch",
    "the top 5 buyers took 100% of all buying",
    "only 2 wallets have bought it"
  ],
  "notes": [],
  "facts": {
    "ageMin": 102, "buyers": 2, "buys": 24, "sells": 31,
    "creatorSoldPct": 100, "creatorLaunches24h": 505, "creatorDumped48h": 505, "creatorMedianDumpMin": 0,
    "bundleWallets": 0, "bundleSharePct": 0, "top5BuyingPct": 100,
    "graduated": false, "quote": null, "curveSol": 0, "poolSol": null
  },
  "stream": { "live": true, "lastEventSecAgo": 0 },
  "checkedAt": 1792133725103,
  "more": "https://zooaiagency.com/skill.md"
}
```

## What each verdict means and what to do

| verdict | proceed | what fired | do this |
|---|---|---|---|
| `avoid` | `false` | the creator sold half their bag or more; the creator dumped most of their launches in 48h; 3+ wallets took 15%+ of supply in the launch block; 6h+ old and the curve is back at its opening; graduated pool under 0.4 SOL | Do not buy. Tell the user the `reasons`, word for word. |
| `caution` | `false` | the creator sold part of their bag; 3+ launches by the creator today; top 5 buyers took over half the buying; under 10 buyers; sells outnumber buys 2:1; with `holders=1`: one wallet holds 20%+, the top 10 hold 50%+, or the creator holds nothing yet never sold | Do not buy on your own. If the user insists, quote the `reasons` first and keep the size small. |
| `pass` | `true` | none of the above | Decide with your own strategy. Pass means no red flags on chain, not that the price will rise. |
| `unknown` | `null` | not a pump.fun launch from the last 48 hours | Use your other checks. |

In its first 10 minutes a token has had no time to show anything but its creator's history. Then the check answers `pass` when that history is clean, with a note `only N min old`: buy small, and call the check again before adding.

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

What this means, plainly: when the check says `avoid`, it is almost never wrong about the token dying. But on pump.fun nearly everything dies, flagged or not, so `pass` is not a reason to buy. The check is a filter that removes the worst, not a signal that finds winners. 115 of these 174 creators had already sold within five minutes of launch.

## Limits and errors

- 120 calls a minute per caller. Over that: HTTP `429` with `retryAfterMs`. Wait, do not retry in a loop.
- If there is no answer within 5 seconds, treat it as `unknown`.
- `404` means the request reached a node that does not read the chain; use the address above.

## Why trust it

The data is read straight from Solana by ZOOAI AGENCY's own stream. The code is open: https://github.com/0xNickdev/aiagentzoo (`apps/node/src/chain/check.ts`). Every call the zoo's agents make is re-checked the next day and scored in public on a signed log: https://zooaiagency.com/docs/grading. Not financial advice.
