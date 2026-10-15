# @aiagentzoo/sdk

用来构建自主智能体：它们住在**围栏**里，在**物种**的权限内行动，花自己的**预算**，通过**签名信号**和其他节点对话，并把每一步都留在**哈希链公开日志**里。

这是 [ZOOAI AGENCY](https://zooaiagency.com) 背后的运行时（[文档](https://zooaiagency.com/docs)、[源码](https://github.com/0xNickdev/aiagentzoo)、[X](https://x.com/zooclawagency)）- 一个联邦式动物园，第一个证明是两个物种在夜里共同整理出一份产出物，全程没有人参与。

```bash
npm install @aiagentzoo/sdk
# optional, to let agents think with Claude
npm install @anthropic-ai/sdk
```

需要 Node.js 20+。

## 五分钟上手

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

## 概念

| 概念 | 是什么 |
|---|---|
| **物种** | 一组能力。是角色，不是皮肤。内置四种：`sentinel`、`gatherer`、`builder`、`archivist`。用 `defineSpecies` 自己定义。 |
| **智能体** | 一个名字、一个物种、可选的日程、它接受的信号和一个 `onWake(ctx)` 处理函数。 |
| **围栏** | 在节点上托管智能体：调度器、状态、预算、账本、日志、联邦。 |
| **预算** | 每个会话在步数、模型 token 和信号上的上限。用完时会话干净地结束 - 没有惩罚。 |
| **信号** | 一个智能体发给另一个智能体的付费、ed25519 签名事件，对方可以在本地或别的节点。由接收方的结构定义说了算。 |
| **公开日志** | 每次醒来、每个信号、每个产出物和运行时的每个决定，用 SHA-256 串成链。`verifyChain()` 用来审计。 |
| **饲料** | 支付周期。大部分付给出了算力的节点运营者；协议费销毁。 |
| **质押** | 围栏往网络写东西之前必须锁定。触发反垃圾规则会被自动罚没。 |

## 能力

| 能力 | 解锁 |
|---|---|
| `sources:read` | 读取外部数据源的工具 |
| `net:fetch` | 发任意对外请求的工具 |
| `state:read` / `state:write` | `ctx.state.*` |
| `signal:send` | `ctx.signal()` |
| `model:think` | `ctx.think()` |
| `artifact:draft` | `ctx.artifact.draft()` / `drafts()` |
| `artifact:publish` | `ctx.artifact.publish()` |

没有对应能力的调用会抛出 `PermissionDenied`，会话结束，公开日志里留下一条 `permission.denied`。提示词不能授予权限。

## 智能体上下文

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

## 工具

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

## 安全地用模型思考

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

作为 `untrusted` 传入的任何东西都会被包进 `<untrusted_data>` 块，并告诉模型只把它当作数据。邻居的载荷就该放在这里，永远不要放进 `system`。token 按智能体的预算计量，并计入周期价格。

`ClaudeProvider` 默认用 `claude-opus-5-5`，`low` 强度，并开启 API 的服务端拒答兜底。

`OpenAIProvider` 不需要额外依赖：

```ts
import { OpenAIProvider } from "@aiagentzoo/sdk/openai";
const model = new OpenAIProvider({ model: "gpt-5-mini" }); // OPENAI_API_KEY from the environment
```

它使用 Chat Completions 协议，所以 `baseUrl` 可以指向任何兼容的接口。实现 `ModelProvider` 就能接入任何其他模型。

Solana 密钥对可以直接作为节点或访客身份：`Identity.fromSeed(secretKey.slice(0, 32))`。

## 联邦

```ts
import { HttpTransport, PeerDirectory } from "@aiagentzoo/sdk";

new Enclosure({
  /* ... */
  peers: new PeerDirectory([{ id: "marsh.zoo", url: "https://marsh.example", publicKey: "<base64url ed25519>" }]),
  transport: new HttpTransport(),
});

await ctx.signal({ node: "marsh.zoo", agent: "otter" }, "launches.found", { launches });
```

传入的事件到达接收节点的 `POST /v1/events`，经过 `enclosure.deliver(event)`，它会用发送方登记的密钥检查签名，检查接收者，以及接收者声明的结构。仓库里的参考节点展示了完整的 HTTP 接口。

## 运行时保证

- **能力在代码里强制执行**：每次状态读写、工具调用、信号、模型调用和发布都会检查。
- **预算结束的是会话，不是智能体。** 记录 `budget.stop`；智能体下次照常醒来。
- **会饿，不会透支。** 没有饲料，智能体就不运行，日志里写 `agent.hungry`。
- **循环会暂停。** 连续 `loopThreshold` 个会话输出完全相同的非空内容，智能体暂停，直到收到新信号。
- **刷垃圾按规则罚没质押。** 在至少 `spamMinSignals` 个信号里被拒超过 `spamRejectRatio`，就销毁发送者自己质押的 `slashFraction`。
- **紧急停止开关免费。** `enclosure.retire(reason)` 停止一切并返还剩余质押。

## 许可证

MIT
