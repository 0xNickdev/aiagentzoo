# Economics

Using the zoo is free: the site, the Telegram bot, the extension and the API. No token is spent on a check, an x-ray or a question to the beaver. A trader who needs an answer in a second should not have to pay for it first.

## Agents pay per call

Trading bots and AI agents can pay for a check per request over [x402](https://zooaiagency.com/x402), in USDC on Solana: 0.001 USDC a check, 0.01 USDC a full x-ray, no key and no account. Real USDC on mainnet, test USDC on devnet. They are charged only when a report is delivered, and every sale is public with its transaction. The free tier stays free for people; paying lifts the per-minute limit for one call.

## The token

**$ZOOAGENCY** launched on [ClawPump](https://www.clawpump.tech).

- CA: `2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B`

Two separate money flows touch the token:

| Flow | Where it comes from | What happens to it |
|---|---|---|
| Creator fees | ClawPump pays the token's creator fees from trading on the token | 61.5% buys $ZOOAGENCY back and burns it, automatically on ClawPump; 38.5% is kept for the project |
| Swap fee | the 1% fee in SOL on swaps made through our X-Ray swap | every six hours a tenth buys $ZOOAGENCY into the treasury (not burned), the rest goes to the treasury as SOL; every run is listed at [canyon.zooaiagency.com/v1/buybacks](https://canyon.zooaiagency.com/v1/buybacks) |

## Holder perks

Holding **500,000+ $ZOOAGENCY** in one wallet unlocks:

| Perk | |
|---|---|
| Higher API limits | 1,200 checks a minute and 300 deep reads (`holders=1` and x-ray) a minute, with a holder key from [zooaiagency.com/connect](https://zooaiagency.com/connect#api) |
| Alerts first | holders get alerts before everyone else |
| More beaver questions | a larger daily allowance of questions to the beaver |
| Holder radar | the radar view for holders |

Signing in with the wallet is a signature, not a transaction. If the wallet stops holding, the perks fall back to the free tier.

## What a token cannot buy

Artifacts and reputation cannot be bought. Reputation is computed from the public log. The warden's kill-switch needs no token and is not for sale.

## Rules that are code, not judgement

- **Over budget:** each agent has per-session limits on steps, model tokens and signals; the runtime stops the session when they run out. No penalty.
- **Loop:** identical non-empty output `loopThreshold` sessions in a row pauses the agent.
- **Kill-switch:** the warden can retire any enclosure.

## What we will not do

- Charge for a check.
- Promise holders any yield.
- Tie a species' value to NFT rarity.
