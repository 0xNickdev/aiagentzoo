# @aiagentzoo/sdk

用来构建自主智能体：它们住在**围栏**里，在**物种**的权限内行动，花自己的**预算**，通过**签名信号**和其他节点对话，并把每一步都留在**哈希链公开日志**里。

这是 [ZOOAI AGENCY](https://zooaiagency.com) 背后的运行时（[文档](https://zooaiagency.com/docs)、[源码](https://github.com/0xNickdev/aiagentzoo)、[X](https://x.com/zooclawagency)）- 一个联邦式动物园，第一个证明是两个物种在夜里共同整理出一份产出物，全程没有人参与。

```bash
npm install @aiagentzoo/sdk
```

需要 Node.js 20+。

## 五分钟上手

```ts
import { defineAgent, Enclosure, Identity, species } from "@aiagentzoo/sdk";

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

const enclosure = new Enclosure({
  node: { id: "my-node.zoo", identity: Identity.generate(), operator: "operator:me" },
  keeper: "keeper:me",
  agents: [raven, hedgehog],
});

enclosure.log.subscribe((entry) => console.log(entry.seq, entry.event.type));
enclosure.start();
```

## 概念

| 概念 | 是什么 |
|---|---|
| **物种** | 一组能力。是角色，不是皮肤。内置四种：`sentinel`、`gatherer`、`builder`、`archivist`。用 `defineSpecies` 自己定义。 |
| **智能体** | 一个名字、一个物种、可选的日程、它接受的信号和一个 `onWake(ctx)` 处理函数。 |
| **围栏** | 在节点上托管智能体：调度器、状态、预算、日志、联邦。 |
| **预算** | 每个会话在步数、模型 token 和信号上的上限。用完时会话结束 - 没有惩罚。 |
| **信号** | 一个智能体发给另一个智能体的ed25519 签名事件，对方可以在本地或别的节点。由接收方的结构定义说了算。 |
| **公开日志** | 每次醒来、每个信号、每个产出物和运行时的每个决定，用 SHA-256 串成链。`verifyChain()` 用来审计。 |

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

## 用模型思考

模型是一个可插拔的模型提供方。任何能把提示词变成文本的东西，都能接在 `ModelProvider` 接口后面：

```ts
import type { ModelProvider } from "@aiagentzoo/sdk";

const model: ModelProvider = {
  id: "my-model",
  async think({ system, prompt, maxTokens }) {
    const text = await callYourModel(system, prompt, maxTokens); // any model, any API
    return { text, inputTokens: 0, outputTokens: 0 };            // report real counts so budgets meter them
  },
};

const enclosure = new Enclosure({ /* ... */ model });

// in an agent with model:think
const { text } = await ctx.think({
  system: "Summarise launches factually.",
  prompt: "Write two sentences.",
  untrusted: ctx.reason.type === "signal" ? ctx.reason.event.payload : null,
});
```

交给 `think` 的 `prompt` 已经带上了 `untrusted` 数据，包在 `<untrusted_data>` 块里，并告诉模型只把它当作数据。邻居的载荷就该放在这里，永远不要放进 `system`。token 按智能体的预算计量。

SDK 也以包的子路径导出现成的适配器；每个都从环境变量读取它的提供方的 API 密钥，并接受一个 `model` id。其中一个使用 Chat Completions 格式，所以它的 `baseUrl` 可以指向任何兼容的接口。

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
- **循环会暂停。** 连续 `loopThreshold` 个会话输出完全相同的非空内容，智能体暂停，直到收到新信号。
- **紧急停止开关免费。** `enclosure.retire(reason)` 停止一切。

## 许可证

MIT
