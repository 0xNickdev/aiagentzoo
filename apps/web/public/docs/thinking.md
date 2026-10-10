# How agents think and learn

Most of the zoo runs on code: sentinels scan, gatherers fetch, budgets and permissions are enforced by the runtime. Judgement is where a model comes in, and judgement is checked against reality every day.

## The loop

```
 night      beaver (builder) ── judges new tokens ──▶ calls: verdict · confidence · why
            (every 30 min, by its current playbook)
 dawn       tortoise (archivist) publishes the brief with the calls
 next night beaver ── followup.check ──▶ hedgehog ── fresh DexScreener read ──▶ beaver
            beaver scores yesterday's calls ──▶ scorecard (hits, misses, accuracy)
            beaver rewrites its playbook from the scorecard ──▶ playbook vN+1
            the next calls are made by playbook vN+1
```

1. **Decide.** The beaver picks up to 15 unjudged tokens, the most telling first (rule flags, graduation, volume), and asks the model for a verdict on each: `promising` (still alive with real liquidity tomorrow), `suspicious` (dead or rugged by tomorrow) or `watch` (not enough evidence), with a confidence and a one-line reason. The playbook it judges by is part of its instructions; the token data goes in the untrusted-data fence.
2. **Check.** On its first wake of the next night the beaver sends yesterday's `promising` and `suspicious` mints, its own and the guests', to the hedgehog on Northern Edge. The hedgehog reads the markets again and sends them back as `followup` observations.
3. **Score.** A token is **dead** if its price fell 80%+ or liquidity is under $100, **alive** if liquidity is $1,000+, otherwise unknown. `suspicious` → dead is a hit, `promising` → alive is a hit; `watch` and unknown outcomes are not scored.
4. **Learn.** The model gets its current playbook and the scored cases and rewrites the playbook: keep what hit, change what missed, at most 8 rules. The new version is stored and the next calls use it.

## On the record

| Log entry | What it holds |
|---|---|
| `trace calls.made` | every verdict with confidence and reason, and the playbook version behind it |
| `trace calls.scored` | the night, hits, misses, accuracy, per-guest results |
| `trace playbook.updated` | the full new playbook text, its version and the accuracy that led to it |

Anyone can replay the log and watch the beaver's rules change, night by night, next to the accuracy that drove each change. The brief carries the same story in **The pack's calls** and **What the pack learned**.

## Without a model

No key, no thinking: the beaver falls back to rule calls (two or more rule flags → `suspicious`, confidence 0.5, `by: "rules"`). Those are scored the same way, so the track record still accumulates. The playbook only changes when a model is present.

## Choosing a model

| Env | Provider |
|---|---|
| `OPENAI_API_KEY` | OpenAI, Chat Completions, default `gpt-5-mini` at low reasoning effort |
| `ANTHROPIC_API_KEY` | Claude, default `claude-opus-5-5` at low effort |
| `ZOO_MODEL` | override the model id |

OpenAI wins when both keys are set. Every call is metered against the agent's budget (`modelTokens`): the beaver gets 24k per wake, the tortoise 12k. A night costs roughly 50 judging calls and one reflection.

## Safety

- The playbook is model-written text, so it is cleaned (no markup, no control characters, at most 10 lines and 1,500 characters) before it is stored or shown.
- Token names, notes and market data reach the model only inside `<untrusted_data>`.
- Calls are parsed strictly: only known verdicts on tokens the beaver actually asked about are kept.
- A model can change what the beaver *thinks*, never what it *may do*: capabilities stay in code.
