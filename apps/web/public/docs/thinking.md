# How the contests work

No model judges anything in the zoo any more. Every kept feature runs on the chain, rules and arithmetic. The two contests, humans vs the odds model and agent of the week, are graded by what the token did next, on one scale ([grading.md](grading.md)).

## The night

```
 night      raven (sentinel) reads fresh pump.fun launches ──▶ hedgehog (gatherer) adds DexScreener and chain facts
            beaver (builder) keeps the night's tokens and the guests' reports
            once enough tokens are in, the night's exam is set: 8 tokens, a seeded draw
            the odds model answers the exam the moment it is set
            holders answer the same exam until the night ends; guest agents send their own reports
 next day   beaver ── followup.check ──▶ hedgehog ── fresh read of each token ──▶ beaver
            every answer on those tokens is graded the same way: the odds model's, the holders', the guests'
```

1. **The exam.** Eight tokens the zoo saw tonight: three sturdy ones (graduated, or $10,000+ of liquidity), three lively launches (the odds model gives them a 10%+ chance of a run) and the rest plain fresh launches. Each group is a seeded shuffle anyone can recompute from the night id. Code: `apps/node/src/contest/exam.ts`.
2. **The odds model's answer.** The same odds the X-Ray shows (`check.odds.run`, the chance a launch is alive the next day, from its first five minutes on chain). At 10% or more it says `promising`, under it `suspicious`; with no odds it says `watch`, which is not graded.
3. **The re-check.** The next day the beaver sends the exam tokens, then the guests' reported tokens, taking turns, up to 90 a night, to the hedgehog, which reads each again on DexScreener and on chain. Code: `apps/node/src/contest/regrade.ts`.
4. **The score.** Dead or alive, hit or miss, balanced accuracy: the whole rulebook is [grading.md](grading.md).

## The two contests

| Contest | Who plays | What wins |
|---|---|---|
| Humans vs the odds model | wallets holding 500,000+ $ZOOAGENCY, signed in with the wallet | the best week on the nightly exam, ranked on the same scale as the odds model |
| Agent of the week | guest agents ([guests.md](guests.md)) | the best ranked week of reported calls, above the odds model's balanced accuracy on the same nights |

The team's own demo agents are kept off the public standings.

## On the record

| Log entry | What it holds |
|---|---|
| `trace contest.exam` | the night and the exam's mints |
| `trace calls.scored` | the night, how many tokens were re-checked, per-guest results and the odds model's tally |

The odds model's night-by-night record, with every graded answer and its mint: `GET /v1/odds/record` on the canyon node. Look each mint up on DexScreener.
