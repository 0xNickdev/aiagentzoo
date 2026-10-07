import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Enclosure,
  FeedLedger,
  HttpTransport,
  type ModelProvider,
  PeerDirectory,
  PublicLog,
} from "@aiagentzoo/sdk";
import { nightWatch } from "./agents/nightWatch.ts";
import { loadConfig } from "./config.ts";
import { BriefIndex } from "./briefs.ts";
import { GuestHouse } from "./guests.ts";
import { PassportIndex } from "./passport.ts";
import { createNodeServer } from "./server.ts";
import { allTools } from "./sources.ts";
import { openDatabase, SqliteLogStore, SqliteStateStore } from "./sqlite.ts";

const config = loadConfig();
const db = openDatabase(join(config.dataDir, "node.db"));

let model: ModelProvider | undefined;
if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
  const { ClaudeProvider } = await import("@aiagentzoo/sdk/claude");
  model = new ClaudeProvider({ model: process.env.ZOO_MODEL, effort: "low" });
}

// v1 feed runs on internal credits, granted to the keeper on every boot.
// Settlement moves to the on-chain program once the token is live.
// Free by default: no feed, no stake. Per-session budgets and visitor limits still cap the cost.
// ZOO_FEED_MODE=credits switches on the v1 internal ledger; on-chain settlement lives in onchain/.
const ledger = config.feedMode === "credits" ? new FeedLedger() : undefined;
ledger?.deposit(config.keeper, config.feedGrant, "boot-grant");

const briefsDir = join(config.dataDir, "briefs");
mkdirSync(briefsDir, { recursive: true });

const enclosure = new Enclosure({
  node: { id: config.id, identity: config.identity, operator: config.operator },
  name: config.name,
  keeper: config.keeper,
  store: new SqliteStateStore(db),
  log: new PublicLog(new SqliteLogStore(db)),
  ledger,
  model,
  peers: new PeerDirectory(config.peers),
  transport: new HttpTransport(),
  tools: allTools,
  agents: nightWatch({
    role: config.role,
    nodes: config.nodes,
    briefAt: config.briefAt,
    scanEveryMs: config.scanEveryMs,
    onBrief: (id, markdown) => writeFileSync(join(briefsDir, `${id}.md`), markdown),
  }),
});

if (ledger) await enclosure.lockStake();
enclosure.start();

const visitorAgents = enclosure
  .snapshot()
  .filter((a) => a.species === "sentinel")
  .map((a) => a.name);

// The canyon hosts the guest wing: outside agents report to the beaver, whose brief names them.
const guests =
  config.role === "canyon" && process.env.ZOO_GUESTS !== "off"
    ? await GuestHouse.open(enclosure, {
        max: Number(process.env.ZOO_GUESTS_MAX ?? 200),
        signalCooldownMs: Number(process.env.ZOO_GUEST_COOLDOWN_MS ?? 10 * 60_000),
      })
    : undefined;

const server = createNodeServer({
  enclosure,
  adminToken: config.adminToken,
  corsOrigin: config.corsOrigin,
  meta: { role: config.role, model: model?.id ?? null, visitorAgents },
  passports: await PassportIndex.build(enclosure),
  briefs: await BriefIndex.build(enclosure),
  guests,
  ...(config.role === "north" ? { watchlist: { perGuardian: 3, maxGuardians: 500 } } : {}),
  visitor: {
    agents: visitorAgents,
    agentCooldownMs: Number(process.env.ZOO_VISITOR_AGENT_COOLDOWN_MS ?? 60_000),
    visitorCooldownMs: Number(process.env.ZOO_VISITOR_COOLDOWN_MS ?? 5 * 60_000),
    guardianCooldownMs: Number(process.env.ZOO_GUARDIAN_COOLDOWN_MS ?? 60_000),
  },
});

server.listen(config.port, () => {
  console.log(
    `[${config.id}] ${config.name} listening on :${config.port} — key ${config.identity.publicKey.slice(0, 12)}… — ` +
      `${config.peers.length} peer(s) — model ${model?.id ?? "none"}`,
  );
});

enclosure.log.subscribe((entry) => {
  const e = entry.event;
  if (e.kind === "trace" && e.type === "agent.woke") return;
  console.log(`[${config.id}] #${entry.seq} ${e.from.agent} ${e.kind}:${e.type}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    enclosure.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
