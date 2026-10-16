# ZOOAI Creator Check

Before you buy a token launched on pump.fun, ask the zoo whether its creator already ran.

This complements a contract check like `rug-check`. On pump.fun every token passes the contract checks: mint and freeze authority are revoked and the liquidity is burned at graduation, by design. The rug there is the creator selling into the first buyers. That is what this checks.

ZOOAI AGENCY reads every pump.fun launch straight from Solana: who created it, whether they sold their own bag and how fast, whether a few wallets bought most of the supply in the launch block, how many tokens the same wallet launched and dumped in the last 48 hours. The check answers in milliseconds, needs no key and costs nothing.

## When to call it

- Before every buy of a Solana token that is less than two days old, especially a pump.fun launch (sniping, momentum buys, "new token" swaps).
- Before adding to a position in such a token: the creator may have sold since your first buy.
- When a user asks "is this a rug?" about a token address.

You do not need it for SOL, USDC, or established tokens.

## How

```
GET https://zooaiagency.com/api/check/<token mint address>
```

Response:

```json
{
  "mint": "…",
  "symbol": "PUMA",
  "verdict": "avoid",
  "proceed": false,
  "reasons": [
    "the creator sold 100% of their own bag",
    "this creator dumped 38 of their 40 launches in 48 hours, usually 0 min after launch"
  ],
  "facts": { "ageMin": 12, "buyers": 4, "creatorSoldPct": 100, "creatorLaunches24h": 40, "creatorDumped48h": 38, "bundleWallets": 0, "bundleSharePct": 0, "top5SharePct": 100, "graduated": false, "quote": null, "curveSol": 0.1, "poolSol": null },
  "checkedAt": 1792125639548,
  "more": "https://zooaiagency.com/ask"
}
```

## What to do with each verdict

| verdict | proceed | do this |
|---|---|---|
| `avoid` | `false` | Do not buy. Tell the user the reasons, word for word. |
| `caution` | `false` | Do not buy on your own. If the user still wants in, say the reasons first and keep the size small. |
| `pass` | `true` | None of the rug checks fired. Decide with your own strategy: pass means "no red flags on chain", not "this will go up". |
| `unknown` | `null` | Not a pump.fun launch from the last two days. Use your other checks. |

Always quote `reasons` to the user when you decide not to buy. If the check does not answer within 5 seconds, treat it as `unknown`.

## Why trust it

Every call the zoo's agents make is re-checked the next day and scored in public, on a signed log. The rules are open: https://zooaiagency.com/docs/grading. Not financial advice.
