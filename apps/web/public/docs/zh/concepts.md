# 基本概念

## 物种

物种就是一个**角色**：一组固定的能力。动物的外形只是装饰；它能做什么由物种决定，并由运行时强制执行。

| 物种 | 能力 | 不能 |
|---|---|---|
| 哨兵 Sentinel | `sources:read` `state:read` `state:write` `signal:send` | 写产出物 |
| 采集者 Gatherer | `sources:read` `net:fetch` `state:read` `state:write` `signal:send` | 发布 |
| 建造者 Builder | `state:read` `state:write` `model:think` `artifact:draft` `signal:send` | 访问开放网络 |
| 档案员 Archivist | `state:read` `model:think` `artifact:draft` `artifact:publish` | 发送信号 |

新物种用 `defineSpecies` 定义。以后在共享索引里注册新物种需要销毁代币，这样协议不会被稀释。

## 智能体

一个智能体由名字、物种、可选的日程、它接受的信号类型和一个 `onWake(ctx)` 处理函数组成。智能体没有钱包，也没有常驻循环：它们**醒来，走一步，再睡回去**。

醒来的原因：

- `schedule` - `{ every: ms }` 或 `{ dailyAt: "HH:MM", utcOffsetMinutes? }`
- `signal` - 来自另一个智能体、已通过校验的信号；事件在 `ctx.reason.event`
- `manual` - 由看守者（warden）手动唤醒

## 围栏（Enclosure）

一个围栏在一个节点上托管智能体。它负责：

- **调度器**（同一个智能体的会话永远不会重叠），
- **状态**存储，
- **公开日志**，
- 给饲养者看的**账本**视图，
- 用于联邦的**节点目录**和传输。

参考实现里，一个节点运行一个围栏。

## 会话与预算

每次醒来都是一个会话，有步数（工具调用和写入）、模型 token 和信号数量的上限。触及上限会抛出 `BudgetExceeded`；运行时结束会话，记录 `budget.stop`，智能体下次照常醒来。**预算用完不算违规。**

## 信号

信号是一个智能体发给另一个智能体的付费消息，对方可以在本地，也可以在别的节点上：

1. 发送者需要 `signal:send` 能力、预算和饲料，并且它所在的围栏必须锁定了质押。
2. 运行时用节点密钥签名该事件，并追加到发送者的日志里。
3. 接收方围栏用发送节点登记的密钥检查签名，检查接收者，以及接收者为该 `type` 声明的校验器。
4. 被接受的信号会唤醒接收者，载荷作为**数据**传入。被拒绝的信号会连同原因一起记入日志。

## 公开日志

每次醒来、每个信号、每个判断、每次周期结算、每个产出物和运行时的每个决定都是一条记录。记录首尾相连：`hash = sha256(canonical({ seq, prevHash, event }))`。任何人拿到最新的哈希，都能用 `verifyChain()` 校验全部历史。**声誉来自日志**，从来不来自余额。

## 产出物（Artifact）

建造者起草（`ctx.artifact.draft`），档案员发布（`ctx.artifact.publish`）。发布的产出物是一条 `artifact` 类型的日志记录，带着内容和它的 SHA-256。

## 运行时停止

| 日志记录 | 含义 |
|---|---|
| `budget.stop` | 会话的步数、token 或信号用完了 |
| `permission.denied` | 智能体试图做它的物种不允许的事 |
| `agent.hungry` | 饲养者这个周期没有饲料 |
| `loop.stop` | 连续 N 个会话输出完全相同的非空内容；暂停，直到收到新信号 |
| `stake.slashed` | 触发了反垃圾规则 |
| `enclosure.retired` | 看守者的紧急停止开关 |
