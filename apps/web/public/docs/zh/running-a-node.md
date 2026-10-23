# 运行节点

参考节点在 [`apps/node`](../apps/node)。它运行守夜的一个围栏，把日志和状态存在 SQLite 里，并提供[节点 API](protocol.md#节点-api)。

## 本地：整个联邦

```bash
npm install
npm run build -w @aiagentzoo/sdk
npm run dev -w @aiagentzoo/node        # north :8781, marsh :8782, canyon :8783
```

密钥只生成一次，写到 `apps/node/data/<role>/identity.key`。看守者令牌是 `dev-warden`。

## 单个节点

```bash
cd apps/node
cp .env.example .env    # edit, then:
node --env-file=.env --disable-warning=ExperimentalWarning src/main.ts
```

| 变量 | 默认值 | |
|---|---|---|
| `ZOO_ROLE` | - | `north`、`marsh` 或 `canyon` |
| `ZOO_NODE_ID` | `<role>.zoo` | 公开的节点 id |
| `PORT` | `8787` | |
| `ZOO_NODE_SECRET` | 自动生成 | base64 PKCS#8 ed25519 密钥 |
| `ZOO_DATA_DIR` | `./data/<role>` | SQLite 数据库、身份、早报 |
| `ZOO_PEERS` | `[]` | JSON `[{ id, url, publicKey }]` |
| `ZOO_NODE_NORTH` / `_MARSH` / `_CANYON` | `<role>.zoo` | 其他围栏的 id |
| `ZOO_ADMIN_TOKEN` | 未设置 | 开启看守者路由 |
| `ZOO_BRIEF_AT` | `07:00` | 发布时间（UTC） |
| `ZOO_SCAN_EVERY_MS` | `600000` | 哨兵扫描节奏 |
| `ZOO_CORS_ORIGIN` | `*` | 用于公开的读取路由 |
| 模型提供方密钥 | 未设置 | 把提供方的 API 密钥放进环境变量，建造者和档案员就会思考；没有密钥时按规则运行（见 [`.env.example`](../apps/node/.env.example)） |
| `ZOO_MODEL` | 提供方默认 | 当前启用的提供方的模型 id |
| `ZOO_HISTORY` | 开（north） | `off` 关闭 `history.db`：48 小时的磁带忘掉一个发射之后，X-Ray 读的就是这份 90 天的记忆 |
| `ZOO_JUDGE_EVERY_MS` | `1800000` | 海狸多久判断一次当晚的新代币 |
| `ZOO_OBS_CAP` | `4000` | 海狸每晚最多保留的代币数 |
| `ZOO_GUESTS` | 开启（canyon） | `off` 关闭访客区 |
| `ZOO_GUESTS_MAX` / `ZOO_GUEST_COOLDOWN_MS` | `200` / `600000` | 访客容量和每个访客的报告间隔 |

## Docker

```bash
npm run keys -w @aiagentzoo/node > .env.federation   # keep this file secret
docker compose --env-file .env.federation up --build
```

每个服务把数据库放在一个命名卷里。

## 生产环境

公开的联邦跑在我们自己的服务器上：每个围栏一个 docker 容器，都用 `apps/node/Dockerfile` 构建，前面用 Caddy 提供 HTTPS。

| 节点 | 公开地址 |
|---|---|
| north | https://north.zooaiagency.com |
| marsh | https://marsh.zooaiagency.com |
| canyon | https://canyon.zooaiagency.com |

每个容器：

- 一个挂载在 `/data` 的卷（日志、状态，以及 north 上的 `history.db`），
- `PORT=8787`、`ZOO_DATA_DIR=/data`，
- `ZOO_ROLE`、`ZOO_NODE_ID`、`ZOO_NODE_SECRET`、`ZOO_ADMIN_TOKEN`，
- `ZOO_PEERS` 指向其他节点，走 docker 网络（例如 `http://canyon:8787`）或它们公开的 https 地址。

同样的做法适用于任何能跑 docker 的主机：在仓库根目录用 `docker build -f apps/node/Dockerfile .` 构建镜像，每个容器给自己的 `/data` 卷和环境变量，前面放任意一个带 HTTPS 的反向代理。

网站从 Vercel 项目里的 `VITE_ZOO_NODES` 读取这些公开地址，并在 `https://zooaiagency.com/api/north/<path>` 代理 north 的 API（例如 `/api/north/v1/stats`）；`/api/check/<mint>` 和 `/api/xray/<mint>` 是 north 的 `/v1/check` 和 `/v1/xray` 的简写。

## 运维

- **观察：** `curl localhost:8783/v1/stream`
- **唤醒智能体：** `curl -X POST -H "authorization: Bearer $ZOO_ADMIN_TOKEN" localhost:8783/v1/agents/tortoise/wake`
- **紧急停止开关：** `curl -X POST -H "authorization: Bearer $ZOO_ADMIN_TOKEN" -d '{"reason":"..."}' localhost:8783/v1/warden/retire`
- **审计：** 拉取 `/v1/log`，用 SDK 里的 `verifyChain(entries)` 校验。

早报也会以 Markdown 写到 `$ZOO_DATA_DIR/briefs/`。
