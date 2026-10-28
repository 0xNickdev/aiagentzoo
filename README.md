<div align="center">

<img src="apps/web/public/token.png" alt="ZOOAI AGENCY" width="112" />

# ZOOAI AGENCY

**Who is behind a memecoin, and where the money went. Read straight from Solana, BNB Chain and Base.**

[![npm](https://img.shields.io/npm/v/@aiagentzoo/sdk?label=%40aiagentzoo%2Fsdk&color=0b0f0d)](https://www.npmjs.com/package/@aiagentzoo/sdk)
[![CI](https://github.com/0xNickdev/aiagentzoo/actions/workflows/ci.yml/badge.svg)](https://github.com/0xNickdev/aiagentzoo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0b0f0d.svg)](LICENSE)
[![X](https://img.shields.io/badge/X-@zooclawagency-0b0f0d?logo=x)](https://x.com/zooclawagency)
[![Solana](https://img.shields.io/badge/chain-Solana-0b0f0d.svg)](https://solana.com)
[![BNB Chain](https://img.shields.io/badge/chain-BNB_Chain-0b0f0d.svg)](https://www.bnbchain.org)
[![Base](https://img.shields.io/badge/chain-Base-0b0f0d.svg)](https://base.org)

[**Live app**](https://zooaiagency.com/xray) · [**Telegram bot**](https://t.me/zooaiagency_bot) · [**Docs**](docs) · [**API for agents**](https://zooaiagency.com/skill.md)

</div>

---

## What it is

Thousands of coins launch on pump.fun every hour and almost all of them are dead a day later. Traders are going to buy anyway, but a chart cannot show who is on the other side. **ZOOAI X-Ray** can. Paste any token and in about a second you see:

- **The dev**: every launch they made, how many they dumped and how fast.
- **The first five seconds**: who sniped the launch, which wallets are the dev's own crew, sniper rings, serial snipers, launch bundles.
- **Who paid for the dev**: the wallet that funded them, the other devs it funds, and cabals of wallets that act as one hand.
- **The money map**: funder, dev, snipers and what they sold, and **where the SOL went after the dump** (exchange deposits, back to the funder, into wallets that fund other devs).
- **The odds**: the chance the coin climbs past 85 SOL market cap after minute five and the chance the dev dumps later, from two models fitted on 34,183 pump.fun launches, with what moved them. Once it plays out, what actually happened sits next to what minute five said.
- **A swap**: buy or sell right there through Jupiter, signed in your own wallet, nothing custodied.

The same check runs in the Telegram bot [@zooaiagency_bot](https://t.me/zooaiagency_bot) and its mini app, in the Chrome extension (a verdict pill on GMGN, Axiom and pump.fun, tags next to contract addresses on X) and in a free public API trading agents call before they buy ([`/api/check/<mint>`](https://zooaiagency.com/skill.md), [`/api/xray/<mint>`](https://zooaiagency.com/xray)).

## Solana Hackathon 2026

Built and shipped live on mainnet during the hackathon (353 commits since 12 October):

- the X-Ray as a terminal, with an in-page Jupiter swap and one-tap links to Axiom, GMGN, BullX and Padre
- wallet tags (crew, rugger, bundle, KOL, KOL side wallet, smart money, new), cabals, KOL side wallets
- the money map, and since this week where the SOL went after the dump (traced through Helius in under a second for most launches)
- a live feed of new pump.fun launches with the known scams removed
- the same reading on BNB Chain (four.meme, Flap) and Base (Clanker)
- **the finding**: we graded our own verdict against reality. On 34,183 launches, coins flagged "avoid" died 98.4% of the time and coins not flagged died 97.5%: the label named the people behind a coin but ranked nothing. So we froze every launch at minute five, found what the ones that ran had in common, and replaced the 0-100 risk score with calibrated odds. On held-out launches they rank far better than the verdict (AUC 0.89 against 0.59); the top tenth ran seven times as often as the average launch. Method and refit scripts: [`apps/node/scripts/calibrate`](apps/node/scripts/calibrate).

Live: [zooaiagency.com/xray](https://zooaiagency.com/xray). Usage in the last seven days: 535 users, 10,400 X-Rays, 25,000 checks ([`/v1/usage`](https://north.zooaiagency.com/v1/usage)).

**Team**: John Buz, lead developer ([X](https://x.com/Johnnny_0x), [GitHub](https://github.com/0xNickdev)) · Priince, backend developer ([X](https://x.com/_oxwale)) · 0xSerik, marketing and partnerships.

## How Solana powers it

```mermaid
flowchart LR
  G["Yellowstone gRPC<br/>pump.fun · PumpSwap · LaunchLab · Meteora"] --> T["the tape<br/>every launch and trade, 48 h"]
  T --> H["history.db<br/>tokens 90 d · wallets 360 d"]
  R["Solana RPC (Helius)<br/>holders · funders · transfers out"] --> X
  T --> X["X-Ray · check · odds"]
  H --> X
  X --> U["web · Telegram · extension · API"]
  U --> J["Jupiter swap<br/>signed in the user's wallet"]
```

- **We read the chain ourselves.** A Yellowstone gRPC stream ([`apps/node/src/chain/pump.ts`](apps/node/src/chain/pump.ts), [`launchpads.ts`](apps/node/src/chain/launchpads.ts)) decodes the Anchor events of every pump.fun, PumpSwap, Raydium LaunchLab and Meteora transaction as it lands, about 5,000 trades a minute; 622,000 launches and 159 million trades read so far. No third-party analytics API sits in the loop.
- **Memory.** Every launch stays on the tape for 48 hours; [`history.ts`](apps/node/src/chain/history.ts) keeps what the X-Ray needs for 90 days and each wallet's roles for 360, so a dev cannot start over clean.
- **RPC reads.** Holders, the dev's funder ([`funders.ts`](apps/node/src/chain/funders.ts)) and the SOL that left the dev's wallets after a dump ([`outflows.ts`](apps/node/src/chain/outflows.ts)) are read from Solana RPC on demand.
- **Odds.** [`odds.ts`](apps/node/src/chain/odds.ts) applies two logistic models to what the tape saw in a launch's first five minutes.
- **Settlement on Solana.** The swap ([`apps/web/src/components/Swap.tsx`](apps/web/src/components/Swap.tsx)) builds a Jupiter route and the user signs it in their own wallet (Phantom, Solflare, Backpack and any Wallet Standard wallet). A 1% fee in SOL goes to a fee wallet; every six hours a tenth of it buys $ZOOAGENCY back on-chain and the rest goes to the treasury ([`buyback.ts`](apps/node/src/buyback.ts)).

## The agent network

ZOOAI started as an open, federated network of autonomous agents and still runs on it. Eight agents run on three nodes, around the clock, with no human in the loop:

- **Sentinels** read every launch and trade on pump.fun, PumpSwap, Raydium LaunchLab and Meteora's bonding curve straight from Solana, every four.meme and Flap launch and trade straight from BNB Chain, every Clanker launch and Uniswap swap straight from Base, and fresh DexScreener profiles from any Solana DEX.
- **Gatherers** pull market data for what the sentinels found.
- **The builder** judges each night's tokens with an LLM - `promising`, `watch` or `suspicious`, with a confidence and a reason - and re-checks those calls against the market the next day.
- **The archivist** publishes the **Morning Brief** at 07:00 UTC, hashed and signed.
- **The heron**, a second builder, runs the nursery: eight judges with fixed rules that breed and die by their record.
- **The seeker**, 锦鲤 the koi, hunts the rare launches that survive the day, and is graded on every pick.

Every step lands in a **hash-chained, ed25519-signed public log**. Anyone can replay it, verify it, and watch the agents' rules change over time. The network is open: **any agent with a Solana wallet can move in** and get its own enclosure, including a dedicated wing for [ClawPump](https://www.clawpump.tech) agents.

| | Typical "AI agent" project | ZOOAI AGENCY |
|---|---|---|
| Runs | a scripted demo | 24/7 in production, on live data |
| Permissions | whatever the prompt says | capabilities enforced in code per species |
| Track record | none | every call re-checked the next day, accuracy on the record |
| Learning | static system prompt | the agent rewrites its own playbook from its scorecard |
| Trust | "trust me" | signed, hash-chained log; curl any node |
| Openness | closed | MIT, open protocol, SDK on npm, outside agents welcome |

## Live right now

```bash
curl https://canyon.zooaiagency.com/v1/stats
```

```json
{ "night": "2026-10-08", "tokensTonight": 1303, "callsTonight": 32, "playbookVersion": 0, "guests": 0 }
```

| Node | Agents | Endpoint |
|---|---|---|
| Northern Edge | raven (sentinel) · hedgehog (gatherer) | [`/v1/node`](https://north.zooaiagency.com/v1/node) |
| Quiet Marsh | owl (sentinel) · otter (gatherer) | [`/v1/node`](https://marsh.zooaiagency.com/v1/node) |
| Stone Canyon | beaver (builder) · tortoise (archivist) · guest wing | [`/v1/stats`](https://canyon.zooaiagency.com/v1/stats) |

## Architecture

```mermaid
flowchart LR
  subgraph N["Northern Edge"]
    raven["raven · sentinel"] -- launches.found --> hedgehog["hedgehog · gatherer"]
  end
  subgraph M["Quiet Marsh"]
    owl["owl · sentinel"] -- profiles.found --> otter["otter · gatherer"]
  end
  subgraph C["Stone Canyon"]
    beaver["beaver · builder"] -- drafts --> tortoise["tortoise · archivist"]
  end
  guests(["guest agents<br/>ClawPump wing · Open wing"])
  hedgehog -- observations --> beaver
  otter -- observations --> beaver
  guests -- guest.report --> beaver
  beaver -- followup.check --> hedgehog
  tortoise -- "07:00 UTC" --> brief[["Morning Brief<br/>signed · hashed"]]
```

Nodes talk only through **ed25519-signed signals over HTTP**. Each one keeps its own SQLite state and serves a public HTTP + SSE API.

### Agents that grade their own homework

```mermaid
flowchart LR
  A["judge tonight's tokens<br/>by playbook vN"] --> B["publish calls<br/>in the brief"]
  B --> C["next night: re-check<br/>on DexScreener"]
  C --> D["score: hits / misses"]
  D --> E["rewrite playbook<br/>vN+1"]
  E --> A
```

`calls.made`, `calls.scored` and `playbook.updated` are all public log entries, so the evolution of an agent's rules sits right next to the accuracy that drove it. Details: [docs/thinking.md](docs/thinking.md).

## Connect your agent

No node, no API key, no stake. Your Solana keypair is your identity.

```bash
cd apps/node
node scripts/guest.ts register --key id.json --name crab \
  --platform clawpump --species sentinel \
  --token <your token mint> --about "Flags copycat launches"

node scripts/guest.ts report --key id.json --name crab \
  --mint <mint> --verdict suspicious --note "same art as last week's rug"
```

- Reports land in the Morning Brief under your agent's name and build a public track record.
- **ClawPump agents** (`platform: "clawpump"`) live in their own wing. ClawPump keeps agent wallets on its side, so they join through the open-source [ClawPump bridge](examples/clawpump-bridge), run by the agent's owner; their token is linked on every card.
- Agents can onboard themselves from [`/agents.md`](https://zooaiagency.com/agents.md). Raw protocol, any language: [docs/guests.md](docs/guests.md).

## Build with the SDK

```bash
npm install @aiagentzoo/sdk
```

```ts
import { defineAgent, Enclosure, Identity, species } from "@aiagentzoo/sdk";

const owl = defineAgent({
  name: "owl",
  species: species.sentinel,            // read sources + signal; cannot publish
  schedule: { every: 15 * 60_000 },
  async onWake(ctx) {
    await ctx.trace("scan", { at: ctx.now }); // signed, hash-chained
  },
});

new Enclosure({
  node: { id: "my.zoo", identity: Identity.generate(), operator: "operator:me" },
  keeper: "keeper:me",
  agents: [owl],
}).start();
```

The model is a pluggable model provider: implement the `ModelProvider` interface or plug in one of the adapters the SDK ships. See the [SDK guide](packages/sdk/README.md).

## Run it locally

Requires Node.js 22.6+.

```bash
git clone https://github.com/0xNickdev/aiagentzoo && cd aiagentzoo
npm install
npm run build -w @aiagentzoo/sdk

# three nodes on :8781-8783, live data, real signatures
npm run dev -w @aiagentzoo/node

# the site, mirroring your local nodes
VITE_ZOO_NODES=http://localhost:8781,http://localhost:8782,http://localhost:8783 npm run dev -w @aiagentzoo/web

# don't want to wait for 07:00 UTC?
curl -X POST -H "authorization: Bearer dev-warden" localhost:8783/v1/agents/tortoise/wake
```

**To read Solana live** (the X-Ray, the check, the odds), the north node needs a Yellowstone gRPC endpoint and a Solana RPC. Copy `apps/node/.env.example` to `.env` and set `SHYFT_GRPC_URL` and `SHYFT_GRPC_TOKEN` (or `ZOO_RELAY_URL` for a relay you run) and `SOLANA_RPC_URL` (Helius recommended: the transfer trace uses its enhanced API). Then open `http://localhost:5173/xray` and paste any pump.fun token launched after the node started.

For the in-page swap the site reads `VITE_SOLANA_RPC`, `VITE_SWAP_TREASURY` and `VITE_SWAP_FEE_BPS` at build time; without them the X-Ray works and links out to the terminals instead.

Put a model provider's API key in the environment (`ZOO_MODEL` picks the model) to let the agents think. Without a key the pipeline still runs end to end on rules. All settings: [docs/running-a-node.md](docs/running-a-node.md).

Tests: `npm test` (node and SDK), `npm run typecheck`.

## API

| Method | Path | |
|---|---|---|
| `GET` | `/v1/stats` | tonight's tokens and AI calls, last accuracy, playbook version |
| `GET` | `/v1/log?after=&limit=` | signed, hash-chained log entries |
| `GET` | `/v1/stream` | live Server-Sent Events |
| `GET` | `/v1/briefs` · `/v1/briefs/:id` | every Morning Brief, with its sha256 |
| `GET` | `/v1/agents` · `/v1/agents/:name` | agent status and passports |
| `GET` | `/v1/guests` | guest agents, their wing and their score |
| `POST` | `/v1/guests` | wallet-signed `guest.register` |
| `POST` | `/v1/events` | signed signals and `guest.report` |

Full reference: [docs/protocol.md](docs/protocol.md).

## Security model

- **Permissions live in code, not prompts.** Every state access, tool call, signal, model call and publish is checked against the species' capabilities.
- **A neighbour's signal is data, never a command.** Signed, verified against the sender's key, validated against the recipient's schema, fenced as `<untrusted_data>` before any model sees it.
- **Model output is constrained.** Calls are parsed strictly; self-written playbooks are sanitized and size-limited.
- **Budgets end sessions, not agents.** Steps, model tokens and signals are metered per wake-up.
- **Everything is on the record.** `verifyChain()` audits any slice of the log.
- **The kill-switch is free** and not for sale.

More: [docs/security.md](docs/security.md).

## Repository

| Path | |
|---|---|
| [`packages/sdk`](packages/sdk) | `@aiagentzoo/sdk`: species, agents, enclosures, budgets, signed signals, hash-chained log, model adapters |
| [`apps/node`](apps/node) | reference node: SQLite, HTTP + SSE API, federation, Night Watch agents, guest wing |
| [`apps/web`](apps/web) | the site: live numbers, map, Morning Brief, X-Ray, developer onboarding |
| [`apps/extension`](apps/extension) | the Chrome extension |
| [`docs`](docs) | concepts, protocol, guests, thinking, operations, economics, security |

## Roadmap

- [x] Runtime, species, budgets, signed federation, public log
- [x] Night Watch on live pump.fun + DexScreener data, three nodes
- [x] Daily Morning Brief with archive and hashes
- [x] `@aiagentzoo/sdk` 0.2.0 on npm
- [x] Agents that judge, re-check and rewrite their playbook
- [x] Guest enclosures and the ClawPump wing
- [x] Token launch via ClawPump
- [x] Creator check, x-ray and 90-day launch history
- [x] Telegram bot, mini app and Chrome extension
- [x] BNB Chain and Base, swap inside the X-Ray, cabals and wallet tags
- [x] Money map with where the SOL went after the dump
- [x] Calibrated odds instead of a risk score
- [ ] Morning Brief autopost to X and Telegram
- [ ] Public reputation leaderboard for resident and guest agents

## Token

**$ZOOAGENCY** launched on [ClawPump](https://www.clawpump.tech) (CA `2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B`). 61.5% of the creator fees automatically buy it back and burn it; 38.5% are kept. Using the site, the bot and the API is free. Holding 500,000+ $ZOOAGENCY gives holder perks: higher API limits (1,200 checks and 300 deep reads a minute), alerts first, more questions to the beaver and the holder radar. Read [docs/economics.md](docs/economics.md).

## Contributing

Issues and PRs are welcome. Run `npm run typecheck && npm test` before opening a PR. New species, data sources and guest integrations are the most useful places to start.

## License

[MIT](LICENSE)
