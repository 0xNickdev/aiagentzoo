import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
import { AskDesk } from "./ask.ts";
import { evolutionView } from "./agents/evolution.ts";
import { startTelegram } from "./telegram.ts";
import { startWatchdog } from "./watchdog.ts";
import { koiView } from "./agents/koi.ts";
import { agentOfWeek, beaverRecord, canyonStats, leaderboard } from "./stats.ts";
import { PassportIndex } from "./passport.ts";
import { createNodeServer } from "./server.ts";
import { allTools, chainClean } from "./sources.ts";
import { startPumpStream, startRelayFeed, tape } from "./chain/pump.ts";
import { HistoryStore, startHistory } from "./chain/history.ts";
import { lineage } from "./chain/lineage.ts";
import { socials } from "./chain/socials.ts";
import { notifyGraded } from "./notify.ts";
import { tickGene } from "./gene.ts";
import { balanceOf } from "./holders.ts";
import { openDatabase, SqliteLogStore, SqliteStateStore } from "./sqlite.ts";

const config = loadConfig();
const db = openDatabase(join(config.dataDir, "node.db"));

let model: ModelProvider | undefined;
if (process.env.OPENAI_API_KEY) {
  const { OpenAIProvider } = await import("@aiagentzoo/sdk/openai");
  model = new OpenAIProvider({ model: process.env.ZOO_MODEL });
} else if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
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

// The north node streams the chain; others read its fresh clean launches over the private network.
const northPeerUrl = config.peers.find((p) => p.id === "north.zoo")?.url;

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
  tools: [...allTools, chainClean(northPeerUrl)],
  agents: nightWatch({
    role: config.role,
    nodes: config.nodes,
    briefAt: config.briefAt,
    scanEveryMs: config.scanEveryMs,
    judgeEveryMs: Number(process.env.ZOO_JUDGE_EVERY_MS ?? 30 * 60_000),
    obsCap: Number(process.env.ZOO_OBS_CAP ?? 4000),
    onBrief: (id, markdown) => writeFileSync(join(briefsDir, `${id}.md`), markdown),
  }),
});

if (ledger) await enclosure.lockStake();
enclosure.start();

// The north node reads pump.fun straight from Solana when a Yellowstone stream is configured.
// Loud chain moments outlive a restart, so anything a post names can still be checked.
const momentsFile = join(config.dataDir, "chain-moments.json");
// The whole tape too, every few minutes and on the way down, so a deploy does not cost two days of history.
const tapeFile = join(config.dataDir, "chain-tape.json");
// Who funded which creator: slow to learn (RPC calls), so it is kept too.
const lineageFile = join(config.dataDir, "chain-lineage.json");
const socialsFile = join(config.dataDir, "chain-socials.json");
const saveTape = () => {
  writeFileSync(`${tapeFile}.tmp`, tape.snapshot());
  renameSync(`${tapeFile}.tmp`, tapeFile);
  writeFileSync(`${lineageFile}.tmp`, lineage.snapshot());
  renameSync(`${lineageFile}.tmp`, lineageFile);
  writeFileSync(`${socialsFile}.tmp`, socials.snapshot());
  renameSync(`${socialsFile}.tmp`, socialsFile);
};
if (config.role === "north") {
  if (existsSync(momentsFile)) tape.restore(readFileSync(momentsFile, "utf8"));
  if (existsSync(tapeFile)) console.log(`[${config.id}] tape restored: ${tape.load(readFileSync(tapeFile, "utf8"))} tokens`);
  if (existsSync(lineageFile)) console.log(`[${config.id}] lineage restored: ${lineage.load(readFileSync(lineageFile, "utf8"))} creators`);
  // One creator traced every 30 s by default: about 3 RPC calls each, a few hundred thousand a month.
  lineage.start(Number(process.env.ZOO_TRACE_EVERY_SEC ?? 30) * 1000);
  if (existsSync(socialsFile)) console.log(`[${config.id}] socials restored: ${socials.load(readFileSync(socialsFile, "utf8"))} launches`);
  // Each new launch's metadata, for the X accounts and Telegram groups it links to.
  socials.start(Number(process.env.ZOO_SOCIALS_PER_SEC ?? 1));
  setInterval(() => {
    try {
      saveTape();
    } catch (error) {
      console.log(`[${config.id}] tape not saved: ${(error as Error).message}`);
    }
  }, 5 * 60_000).unref();
  setInterval(() => {
    writeFileSync(`${momentsFile}.tmp`, tape.dump());
    renameSync(`${momentsFile}.tmp`, momentsFile);
  }, 60_000).unref();
}
// The long memory: what the X-Ray needs of every token for 90 days, after the tape forgets it. ZOO_HISTORY=off skips it.
const history = config.role === "north" && process.env.ZOO_HISTORY !== "off" ? new HistoryStore(join(config.dataDir, "history.db")) : null;
const stopHistory = history ? startHistory(history, tape, { funderOf: (c) => lineage.funderOf(c), log: (m) => console.log(`[${config.id}] ${m}`) }) : null;
// North reads the chain from the relay when it has one (the stream gives Railway a tenth of pump.fun), else directly.
const chainLog = (m: string) => console.log(`[${config.id}] ${m}`);
const stopStream =
  config.role !== "north"
    ? null
    : process.env.ZOO_RELAY_URL && process.env.ZOO_RELAY_TOKEN
      ? startRelayFeed(tape, { url: process.env.ZOO_RELAY_URL, token: process.env.ZOO_RELAY_TOKEN, log: chainLog })
      : process.env.SHYFT_GRPC_TOKEN
        ? await startPumpStream(tape, { url: process.env.SHYFT_GRPC_URL ?? "https://grpc.eu.shyft.to", token: process.env.SHYFT_GRPC_TOKEN, log: chainLog })
        : null;

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

// Guests with a webhook hear when their calls are graded.
if (guests) setInterval(() => void notifyGraded(enclosure, guests, config.briefAt).catch(() => {}), 10 * 60_000);
// The holders' weekly vote on the nursery's next gene: last week closes, this week opens.
if (config.role === "canyon") {
  const gene = () => void tickGene(enclosure.store, config.briefAt, (w) => balanceOf(w), model).catch((e) => console.log(`[${config.id}] gene: ${(e as Error).message}`));
  setTimeout(gene, 60_000);
  setInterval(gene, 10 * 60_000);
}

// The beaver answers anyone's question about a token, on the canyon where it lives.
const northUrl = config.peers.find((p) => p.id === "north.zoo")?.url;
const briefs = await BriefIndex.build(enclosure);
const asks = config.role === "canyon" ? new AskDesk({ enclosure, model, northUrl, perDay: Number(process.env.ZOO_ASK_PER_DAY ?? 500) }) : undefined;
const stopTelegram =
  asks && process.env.TELEGRAM_BOT_TOKEN
    ? startTelegram({
        token: process.env.TELEGRAM_BOT_TOKEN,
        desk: asks,
        store: enclosure.store,
        northUrl,
        log: (m) => console.log(`[${config.id}] ${m}`),
        data: {
          board: leaderboard(enclosure, config.briefAt) as never,
          stats: canyonStats(enclosure, config.briefAt, guests) as never,
          evolution: (() => evolutionView(enclosure.store, config.briefAt)) as never,
          koi: (() => koiView(enclosure.store, config.briefAt)) as never,
          latestBrief: async () => {
            const ref = briefs.list(1)[0];
            if (!ref) return null;
            const entry = await briefs.get(ref.id);
            const sec = (entry?.event.payload as { content?: { sections?: { launches?: number; graduated?: unknown[]; wentToZero?: unknown[]; counts?: { graduated: number; wentToZero: number } } } } | undefined)?.content?.sections;
            return { id: ref.id, night: ref.night, launches: sec?.launches, graduated: sec?.counts?.graduated ?? sec?.graduated?.length, wentToZero: sec?.counts?.wentToZero ?? sec?.wentToZero?.length };
          },
        },
      })
    : null;

// The zoo watching itself: model failures, a silent stream, a node down, a late brief, straight to the operators.
const alertChats = String(process.env.ZOO_ALERT_CHAT ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n !== 0);
const stopWatchdog =
  config.role === "canyon" && process.env.TELEGRAM_BOT_TOKEN && alertChats.length
    ? startWatchdog({
        token: process.env.TELEGRAM_BOT_TOKEN,
        chats: alertChats,
        briefAt: config.briefAt,
        subscribe: (fn) => void enclosure.log.subscribe(fn),
        latestBriefNight: briefs.list(1)[0]?.night ?? null,
        northUrl,
        peers: config.peers.map((p) => ({ name: p.id, url: p.url })),
        log: (m) => console.log(`[${config.id}] ${m}`),
      })
    : null;

const server = createNodeServer({
  enclosure,
  adminToken: config.adminToken,
  corsOrigin: config.corsOrigin,
  meta: { role: config.role, ai: Boolean(model), visitorAgents },
  passports: await PassportIndex.build(enclosure),
  briefs,
  guests,
  ...(config.role === "canyon" ? { stats: canyonStats(enclosure, config.briefAt, guests), board: leaderboard(enclosure, config.briefAt), beaverHistory: beaverRecord(enclosure, config.briefAt), weekly: agentOfWeek(enclosure, config.briefAt), asks, evolution: { briefAt: config.briefAt } } : {}),
  ...(config.role === "north" ? { watchlist: { perGuardian: 3, maxGuardians: 500, perHolder: 10 } } : {}),
  ...(history ? { history } : {}),
  visitor: {
    agents: visitorAgents,
    agentCooldownMs: Number(process.env.ZOO_VISITOR_AGENT_COOLDOWN_MS ?? 60_000),
    visitorCooldownMs: Number(process.env.ZOO_VISITOR_COOLDOWN_MS ?? 5 * 60_000),
    guardianCooldownMs: Number(process.env.ZOO_GUARDIAN_COOLDOWN_MS ?? 60_000),
  },
});

server.listen(config.port, () => {
  console.log(
    `[${config.id}] ${config.name} listening on :${config.port} - key ${config.identity.publicKey.slice(0, 12)}… - ` +
      `${config.peers.length} peer(s) - model ${model?.id ?? "none"}`,
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
    stopStream?.();
    if (config.role === "north") {
      try {
        saveTape();
      } catch {
        /* the last five-minute save stands */
      }
      try {
        stopHistory?.();
        history?.close();
      } catch {
        /* at most the last few seconds of history are lost */
      }
    }
    stopTelegram?.();
    stopWatchdog?.();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
