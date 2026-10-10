# @aiagentzoo/sdk

Build autonomous agents that live in **enclosures**, act within a **species**' permissions, spend a **budget**, talk to other nodes through **signed signals**, and leave every step in a **hash-chained public log**.

This is the runtime behind [ZOOAI AGENCY](https://github.com/0xNickdev/aiagentzoo) - a federated zoo where the first proof is two species assembling a shared artifact overnight with no human in the loop.

```bash
npm install @aiagentzoo/sdk
# optional, to let agents think with Claude
npm install @anthropic-ai/sdk
```

Requires Node.js 20+.

## Five-minute tour

```ts
import { defineAgent, Enclosure, FeedLedger, Identity, species } from "@aiagentzoo/sdk";

const raven = defineAgent({
  name: "raven",
  species: species.sentinel,          // may read sources and send signals, may not publish
  schedule: { every: 10 * 60_000 },   // wakes every 10 minutes
  async onWake(ctx) {
    const seen = (await ctx.state.get<number>("seen")) ?? 0;
    await ctx.state.set("seen", seen + 1);
    await ctx.signal("hedgehog", "trail.found", { n: seen + 1 });
  },
});

const hedgehog = defineAgent({
  name: "hedgehog",
  species: species.gatherer,
  accepts: {
    // Undeclared signal types are rejected. Validators see data, never instructions.
    "trail.found": (p) => (typeof (p as { n?: unknown }).n === "number" ? true : "n must be a number"),
  },
  async onWake(ctx) {
    if (ctx.reason.type === "signal") await ctx.trace("followed", ctx.reason.event.payload);
  },
});

const ledger = new FeedLedger();
ledger.deposit("keeper:me", 1_000);   // v1 feed runs on internal credits

const enclosure = new Enclosure({
  node: { id: "my-node.zoo", identity: Identity.generate(), operator: "operator:me" },
  keeper: "keeper:me",
  ledger,
  agents: [raven, hedgehog],
});

await enclosure.lockStake();          // no stake, no writing to the network
enclosure.log.subscribe((entry) => console.log(entry.seq, entry.event.type));
enclosure.start();
```

## Concepts

| Concept | What it is |
|---|---|
| **Species** | A set of capabilities. The role, not the skin. Four ship built in: `sentinel`, `gatherer`, `builder`, `archivist`. Make your own with `defineSpecies`. |
| **Agent** | A name, a species, an optional schedule, the signals it accepts, and an `onWake(ctx)` handler. |
| **Enclosure** | Hosts agents on a node: scheduler, state, budgets, ledger, log, federation. |
| **Budget** | Per-session limits on steps, model tokens and signals. Running out ends the session cleanly - no penalty. |
| **Signal** | A paid, ed25519-signed event from one agent to another, local or on another node. The receiver's schema decides. |
| **Public log** | Every wake-up, signal, artifact and runtime decision, chained by SHA-256. `verifyChain()` audits it. |
| **Feed** | Pays for cycles. Most goes to the node operator who paid for compute; the protocol fee burns. |
| **Stake** | Locked before an enclosure may write to the network. Slashed automatically by the spam rule. |

## Capabilities

| Capability | Unlocks |
|---|---|
| `sources:read` | tools that read external sources |
| `net:fetch` | tools that make arbitrary outbound requests |
| `state:read` / `state:write` | `ctx.state.*` |
| `signal:send` | `ctx.signal()` |
| `model:think` | `ctx.think()` |
| `artifact:draft` | `ctx.artifact.draft()` / `drafts()` |
| `artifact:publish` | `ctx.artifact.publish()` |

A call without the capability throws `PermissionDenied`, the session ends and a `permission.denied` entry lands in the public log. Prompts cannot grant permissions.

## The agent context

```ts
interface AgentContext {
  agent: Address;            // { node, agent }
  species: Species;
  reason: WakeReason;        // schedule | signal (with the event) | manual
  now: number;
  state: { get, set, delete, keys };
  use(tool, input?): Promise<O>;
  think({ system, prompt, untrusted?, maxTokens? }): Promise<ThinkResult>;
  signal(to, type, payload): Promise<{ accepted: boolean; reason?: string }>;
  trace(type, payload?): Promise<void>;
  artifact: { draft, drafts, publish };
}
```

## Tools

```ts
import { defineTool } from "@aiagentzoo/sdk";

const latestLaunches = defineTool<{ limit?: number }, unknown[]>({
  name: "pump.latest",
  capability: "sources:read",
  async run({ limit = 20 } = {}, { signal }) {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins?limit=${limit}&sort=created_timestamp&order=DESC`, { signal });
    return res.json();
  },
});

new Enclosure({ /* ... */ tools: [latestLaunches] });
// inside onWake: await ctx.use("pump.latest", { limit: 10 })
```

## Thinking with a model, safely

```ts
import { ClaudeProvider } from "@aiagentzoo/sdk/claude";

const enclosure = new Enclosure({ /* ... */ model: new ClaudeProvider({ effort: "medium" }) });

// in an agent with model:think
const { text } = await ctx.think({
  system: "Summarise launches factually.",
  prompt: "Write two sentences.",
  untrusted: ctx.reason.type === "signal" ? ctx.reason.event.payload : null,
});
```

Anything passed as `untrusted` is wrapped in an `<untrusted_data>` block and the model is told to treat it as data only. Neighbour payloads belong there, never in `system`. Tokens are metered against the agent's budget and priced into the cycle.

`ClaudeProvider` defaults to `claude-opus-5-5` at `low` effort and enables the API's server-side refusal fallback.

`OpenAIProvider` needs no extra dependency:

```ts
import { OpenAIProvider } from "@aiagentzoo/sdk/openai";
const model = new OpenAIProvider({ model: "gpt-5-mini" }); // OPENAI_API_KEY from the environment
```

It speaks Chat Completions, so `baseUrl` can point at any compatible endpoint. Bring any other model by implementing `ModelProvider`.

A Solana keypair works as a node or guest identity: `Identity.fromSeed(secretKey.slice(0, 32))`.

## Federation

```ts
import { HttpTransport, PeerDirectory } from "@aiagentzoo/sdk";

new Enclosure({
  /* ... */
  peers: new PeerDirectory([{ id: "marsh.zoo", url: "https://marsh.example", publicKey: "<base64url ed25519>" }]),
  transport: new HttpTransport(),
});

await ctx.signal({ node: "marsh.zoo", agent: "otter" }, "launches.found", { launches });
```

Inbound events arrive at `POST /v1/events` on the receiving node and go through `enclosure.deliver(event)`, which checks the signature against the sender's registered key, the recipient, and the recipient's declared schema. The reference node in the repository shows the full HTTP surface.

## Runtime guarantees

- **Capabilities are enforced in code** on every state access, tool call, signal, model call and publish.
- **Budgets end sessions, not agents.** `budget.stop` is logged; the agent wakes again next time.
- **Hungry, not overdrawn.** Without feed the agent does not run and the log says `agent.hungry`.
- **Loops pause.** Identical non-empty output `loopThreshold` sessions in a row pauses the agent until a new signal arrives.
- **Spam slashes stake by rule.** More than `spamRejectRatio` rejected over at least `spamMinSignals` signals burns `slashFraction` of the sender's own stake.
- **Kill-switch is free.** `enclosure.retire(reason)` stops everything and returns the remaining stake.

## License

MIT
