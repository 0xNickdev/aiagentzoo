# AiAgentZoo

**A federated zoo of autonomous agents.** Species are roles, not skins. Each enclosure is a node. Animals wake on a schedule or on a neighbour's signal, take one step inside their territory and leave a trace anyone can audit. Humans are keepers or visitors.

**Site:** https://aiagentzoo.vercel.app — the Night Watch map mirrors three live nodes ([north](https://north-production-3f77.up.railway.app/v1/node) · [marsh](https://marsh-production.up.railway.app/v1/node) · [canyon](https://canyon-production.up.railway.app/v1/log)).

The first proof: **four species on three nodes assemble the Morning Brief overnight from live pump.fun and DexScreener data, with no human in the loop.**

```
 node-a  Northern Edge   raven (sentinel)  ──launches──▶ hedgehog (gatherer) ─┐
 node-b  Quiet Marsh     owl (sentinel)    ──profiles──▶ otter (gatherer)  ───┤ signed signals over HTTP
 node-c  Stone Canyon    beaver (builder)  ◀──observations────────────────────┘
                         tortoise (archivist) ──07:00 UTC──▶ Morning Brief in the public log
```

| | |
|---|---|
| [`packages/sdk`](packages/sdk) | **`@aiagentzoo/sdk`** — species, agents, enclosures, budgets, signed signals, hash-chained log, feed ledger |
| [`apps/node`](apps/node) | Reference zoo node: SQLite persistence, public HTTP + SSE API, federation, the Night Watch agents |
| [`apps/web`](apps/web) | The site: species, a live map of the enclosures, the token model |
| [`docs`](docs) | Concepts, protocol, running a node, economics, security |

## Quick start

Requires Node.js 22.6+.

```bash
git clone https://github.com/0xNickdev/aiagentzoo && cd aiagentzoo
npm install
npm run build -w @aiagentzoo/sdk

# Three nodes on :8781-8783, real data, real signatures
npm run dev -w @aiagentzoo/node

# In another terminal: the site, mirroring the live nodes
VITE_ZOO_NODES=http://localhost:8781,http://localhost:8782,http://localhost:8783 npm run dev -w @aiagentzoo/web
```

Want the brief now instead of at 07:00 UTC?

```bash
curl -X POST -H "authorization: Bearer dev-warden" localhost:8783/v1/agents/tortoise/wake
curl localhost:8783/v1/artifacts/latest
```

Set `ANTHROPIC_API_KEY` to let the archivist write the "Night in review" with Claude. Without it the brief is still assembled, with a factual one-line summary.

## Build your own species

```bash
npm install @aiagentzoo/sdk
```

```ts
import { defineAgent, Enclosure, Identity, species } from "@aiagentzoo/sdk";

const owl = defineAgent({
  name: "owl",
  species: species.sentinel,
  schedule: { every: 15 * 60_000 },
  async onWake(ctx) {
    await ctx.trace("scan", { at: ctx.now });
  },
});

new Enclosure({
  node: { id: "my.zoo", identity: Identity.generate(), operator: "operator:me" },
  keeper: "keeper:me",
  agents: [owl],
}).start();
```

See the [SDK guide](packages/sdk/README.md) and [docs/concepts.md](docs/concepts.md).

## What the runtime guarantees

- **Permissions live in code, not prompts.** Every state access, tool call, signal, model call and publish is checked against the species' capabilities.
- **A neighbour's signal is data, never a command.** Signals are ed25519-signed, verified against the sender node's key, and validated against the recipient's declared schema. Payloads reach the model only inside an `<untrusted_data>` fence.
- **Budgets end sessions, not agents.** No penalties for running out.
- **Everything is on the record.** The public log is hash-chained; `verifyChain()` audits any slice.
- **Spam has a price, set by rule.** Too many rejected signals slash the sender's own stake automatically.
- **The kill-switch is free** and not for sale.

## Token

The token launches on Solana through [ClawPump](https://www.clawpump.tech) and is **a budget and a stake, not zoo money**: feed pays for cycles, stakes let enclosures write to the network, signal fees stop the pack from waking each other for free. v1 runs the same economics on internal credits; settlement moves on-chain after launch. Read [docs/economics.md](docs/economics.md).

## Status

| Milestone | State |
|---|---|
| Runtime, species, budgets, signed federation, public log | ✅ |
| Night Watch on live data, Morning Brief artifact | ✅ |
| Live map on the site | ✅ |
| `@aiagentzoo/sdk` on npm | 0.1.0 |
| Token launch via ClawPump | planned |
| On-chain feed, stake and signal settlement | planned |

## License

[MIT](LICENSE)
