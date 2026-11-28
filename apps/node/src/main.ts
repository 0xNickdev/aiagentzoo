import { closeSync, existsSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { Enclosure, FeedLedger, HttpTransport, PeerDirectory, PublicLog } from "@aiagentzoo/sdk";
import { nightWatch } from "./agents/nightWatch.ts";
import { loadConfig } from "./config.ts";
import { GuestHouse } from "./guests.ts";
import { startTelegram } from "./telegram.ts";
import { startWatchdog } from "./watchdog.ts";
import { agentOfWeek, canyonStats, leaderboard, oddsRecord } from "./stats.ts";
import { PassportIndex } from "./passport.ts";
import { createNodeServer } from "./server.ts";
import { allTools, chainClean } from "./sources.ts";
import { startPumpStream, startRelayFeed, tape } from "./chain/pump.ts";
import { PoolMetaQueue } from "./chain/poolMeta.ts";
import { Adopter, adoption, patient } from "./chain/adopt.ts";
import { HistoryStore, startHistory } from "./chain/history.ts";
import { OperatorGraph } from "./chain/opgraph.ts";
import { SmartWallets, WalletLedger } from "./chain/walletpnl.ts";
import { startBackground, startPrintFeed } from "./chain/background.ts";
import { exchangeOf, launcherOf } from "./chain/exchanges.ts";
import { catchUpPinned, seedPinned } from "./chain/replay.ts";
import { CabalIndex, startCabals } from "./chain/cabals.ts";
import { labels } from "./chain/labels.ts";
import { SideWallets } from "./chain/sidewallets.ts";
import { Mentions } from "./chain/mentions.ts";
import { lineage } from "./chain/lineage.ts";
import { feedBody } from "./chain/feed.ts";
import { writeMarks } from "./chain/marks.ts";
import { markField } from "./chain/earlycalls.ts";
import { curveCap, Radar } from "./chain/radar.ts";
import { RadarV2, type V2Row } from "./chain/radar-v2.ts";
import type { RadarRecord } from "./chain/radar-record.ts";
import { earlyCallsAt, startCallers } from "./routes/calls.ts";
import { startPools } from "./routes/pools.ts";
import { socials } from "./chain/socials.ts";
import { notifyGraded } from "./notify.ts";
import { rpcRead, TOKEN_MINT, TOKEN_POOL } from "./holders.ts";
import { startBuyBot } from "./buybot.ts";
import { buybackView, startBuyback } from "./buyback.ts";
import { openDatabase, SqliteLogStore, SqliteStateStore } from "./sqlite.ts";
import { laneFromEnv } from "./x402.ts";

// A forgotten promise must not take a live node down: log it and keep serving.
process.on("unhandledRejection", (reason) => console.error(`unhandled rejection: ${(reason as Error)?.stack ?? String(reason)}`));

const config = loadConfig();
const db = openDatabase(join(config.dataDir, "node.db"));

// No model: every kept feature runs on the chain, rules and arithmetic (2026-11-20). OPENAI_API_KEY and ZOO_MODEL are no
// longer read. The one exception is the holders' on-request code check on the marsh (claims/build.ts), which reads
// ANTHROPIC_API_KEY and ZOO_BUILD_MODEL there only.

// Free by default: no feed, no stake.
// ZOO_FEED_MODE=credits switches on the old internal credit ledger, kept for the agent network's tests.
const ledger = config.feedMode === "credits" ? new FeedLedger() : undefined;
ledger?.deposit(config.keeper, config.feedGrant, "boot-grant");

// The north node streams the chain; others read its fresh clean launches over the private network.
const northPeerUrl = config.peers.find((p) => p.id === "north.zoo")?.url;

const enclosure = new Enclosure({
  node: { id: config.id, identity: config.identity, operator: config.operator },
  name: config.name,
  keeper: config.keeper,
  store: new SqliteStateStore(db),
  log: new PublicLog(new SqliteLogStore(db)),
  ledger,
  peers: new PeerDirectory(config.peers),
  transport: new HttpTransport(),
  tools: [...allTools, chainClean(northPeerUrl)],
  agents: nightWatch({
    role: config.role,
    nodes: config.nodes,
    briefAt: config.briefAt,
    scanEveryMs: config.scanEveryMs,
    obsCap: Number(process.env.ZOO_OBS_CAP ?? 4000),
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
// Who funded the first-second wallets: slow to learn (RPC calls), so it is kept too.
const sideFile = join(config.dataDir, "chain-sidewallets.json");
const sideWallets = new SideWallets(labels);
/**
 * The five-minute save, without the stall: the tape goes to disk a few hundred tokens at a time and every request
 * waiting gets its turn between the pieces. The save on the way down stays the plain one below, since nothing waits then.
 */
let saving = false;
const saveTapeGently = async () => {
  if (saving) return;
  saving = true;
  const breathe = () => new Promise<void>((r) => setImmediate(r));
  try {
    const tmp = `${tapeFile}.part`;
    const fd = openSync(tmp, "w");
    try {
      for (const piece of tape.snapshotChunks(100)) {
        writeSync(fd, piece);
        await breathe();
      }
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, tapeFile);
    for (const step of saveSteps) {
      await breathe();
      step();
    }
  } finally {
    saving = false;
  }
};
/** Everything kept beside the tape, one file a step, so the gentle save can let requests through between them. */
const saveSteps: Array<() => void> = [
  () => {
    writeFileSync(`${sideFile}.tmp`, sideWallets.snapshot());
    renameSync(`${sideFile}.tmp`, sideFile);
  },
  () => {
    writeFileSync(`${lineageFile}.tmp`, lineage.snapshot());
    renameSync(`${lineageFile}.tmp`, lineageFile);
  },
  () => {
    writeFileSync(`${socialsFile}.tmp`, socials.snapshot());
    renameSync(`${socialsFile}.tmp`, socialsFile);
  },
];
const saveTape = () => {
  writeFileSync(`${tapeFile}.tmp`, tape.snapshot());
  renameSync(`${tapeFile}.tmp`, tapeFile);
  for (const step of saveSteps) step();
};
if (config.role === "north") {
  // Every trade on $ZOOAGENCY's pool, for the buy bot in the holders' group.
  tape.follow(TOKEN_MINT, TOKEN_POOL);
  // $ZOOAGENCY is kept on the tape for good, not for two days: its x-ray reads what happens now, not a launch-day snapshot.
  tape.pin(TOKEN_MINT);
  if (existsSync(momentsFile)) tape.restore(readFileSync(momentsFile, "utf8"));
  if (existsSync(tapeFile)) console.log(`[${config.id}] tape restored: ${tape.load(readFileSync(tapeFile, "utf8"))} tokens`);
  // A coin launched straight into a Raydium pool comes with no name, symbol or supply: read from the chain afterwards.
  const poolMeta = new PoolMetaQueue((method, params) => patient(() => rpcRead(method, params)), (mint, meta) => void tape.fillMeta(mint, meta));
  tape.onPoolLaunch = (mint) => poolMeta.add(mint);
  // A coin asked about that launched before the stream watched: read from the chain once, then followed live.
  adoption.current = new Adopter(tape, { rpc: (method, params) => rpcRead(method, params), log: (m) => console.log(`[${config.id}] ${m}`) });
  setTimeout(() => void adoption.current?.resume().catch(() => {}), 30_000).unref();
  if (existsSync(lineageFile)) console.log(`[${config.id}] lineage restored: ${lineage.load(readFileSync(lineageFile, "utf8"))} creators`);
  if (existsSync(sideFile)) console.log(`[${config.id}] side wallets restored: ${sideWallets.load(readFileSync(sideFile, "utf8"))} wallets`);
  // Every launch's first-second and launch-block wallets, traced to their funder a minute and a half in.
  {
    const previous = tape.onMoment;
    tape.onMoment = (e) => {
      previous?.(e);
      if (e.kind === "launch" || e.kind === "serial") {
        setTimeout(() => {
          const early = (tape.earlyOf(e.mint) ?? []).slice(0, 10).map((w) => w.wallet);
          const bundle = (tape.token(e.mint)?.bundle ?? []).slice(0, 6).map((b) => b.wallet);
          sideWallets.enqueue([...new Set([...early, ...bundle])]);
        }, 90_000).unref();
      }
    };
  }
  sideWallets.start(Number(process.env.ZOO_SIDE_GAP_MS ?? 500));
  // A creator traced every 250 ms by default, about 3 RPC calls each; ZOO_TRACE_GAP_MS slows it for a smaller RPC plan.
  lineage.start(Number(process.env.ZOO_TRACE_GAP_MS ?? 250));
  if (existsSync(socialsFile)) console.log(`[${config.id}] socials restored: ${socials.load(readFileSync(socialsFile, "utf8"))} launches`);
  // Each new launch's metadata, for the X accounts and Telegram groups it links to.
  socials.start(Number(process.env.ZOO_SOCIALS_PER_SEC ?? 1));
  setInterval(() => {
    void saveTapeGently().catch((error) => console.log(`[${config.id}] tape not saved: ${(error as Error).message}`));
  }, 5 * 60_000).unref();
  // The feed stamps a coin with the cap it first showed at; built here too, so the stamp does not wait for a reader.
  setInterval(() => {
    try {
      feedBody();
    } catch (error) {
      console.log(`[${config.id}] feed not built: ${(error as Error).message}`);
    }
  }, 15_000).unref();
  // How each launch stood one, two, three, five and twenty minutes in (every 10 s, so the early ones land on time), and the verdict it had then: kept to test rules against later.
  setInterval(() => {
    try {
      writeMarks(join(config.dataDir, "chain-marks.jsonl"), Date.now(), (row, info) => {
        radar?.consider(row, info);
        try {
          radarV2?.consider(row as unknown as V2Row, info);
        } catch (error) {
          console.log(`[${config.id}] radar v2 not scored: ${(error as Error).message}`);
        }
      }, (mint, min, createdAt, now) => {
        // The callers who called it by the five-minute reading, and how many have a good record: kept for training, not scored.
        if (min !== 5) return null;
        const e = earlyCallsAt(mint, createdAt, now);
        return e ? { earlyCalls: markField(e) } : null;
      });
    } catch (error) {
      console.log(`[${config.id}] marks not written: ${(error as Error).message}`);
    }
  }, 10_000).unref();
  setInterval(() => {
    try {
      writeFileSync(`${momentsFile}.tmp`, tape.dump());
      renameSync(`${momentsFile}.tmp`, momentsFile);
    } catch (error) {
      console.log(`[${config.id}] moments not saved: ${(error as Error).message}`);
    }
  }, 60_000).unref();
}
// The long memory: what the X-Ray needs of every token for 90 days, after the tape forgets it. ZOO_HISTORY=off skips it.
const history = config.role === "north" && process.env.ZOO_HISTORY !== "off" ? new HistoryStore(join(config.dataDir, "history.db")) : null;
// Which launches linked which X account or Telegram, kept beside it for 90 days instead of the tape's two.
if (history) socials.attach(history.db);
// The runner radar: the models frozen on 21 Nov scored on every 5-minute reading; signals kept in radar.jsonl.
const radar = config.role === "north" && history ? new Radar(join(config.dataDir, "radar.jsonl"), history.db, undefined, (mint) => ({ cap: tape.capNow(mint), poolSol: tape.facts(mint, Date.now(), true)?.poolSol ?? null })) : null;
if (radar) {
  console.log(`[${config.id}] radar restored: ${radar.load()} signals, ${radar.restoreDay(join(config.dataDir, "radar-day.json"), join(config.dataDir, "chain-marks.jsonl"))} scored today`);
  // Confirmations given on a graduation alone, before the pool check, are taken back.
  console.log(`[${config.id}] radar restaged: ${radar.restage()} graduated-before-20 confirmations back to candidates`);
  setInterval(() => {
    try {
      radar.refresh((mint) => {
        const f = tape.facts(mint);
        if (!f) return null;
        return { cap: f.graduated ? tape.capNow(mint) : curveCap(f.curveSol), graduated: Boolean(f.graduated) };
      });
    } catch (error) {
      console.log(`[${config.id}] radar not refreshed: ${(error as Error).message}`);
    }
  }, 60_000).unref();
}
// Radar v2 on paper: the 20-minute graduation model, picks and their real entry cap in radar-v2.jsonl, shown nowhere.
const radarV2 = config.role === "north" && history
  ? new RadarV2(join(config.dataDir, "radar-v2.jsonl"), history.db, (mint) => {
      const f = tape.facts(mint);
      if (!f) return null;
      return f.graduated ? tape.capNow(mint) : curveCap(f.curveSol);
    })
  : null;
const stopHistory = history ? startHistory(history, tape, { funderOf: (c) => lineage.funderOf(c), log: (m) => console.log(`[${config.id}] ${m}`) }) : null;
// The operator graph: launch wallets tied on chain across launches, built in the background worker from the long memory;
// this thread only reads it. Every trader's SOL in and out per coin gathers here and is written there; once a day the
// worker scores the wallets with the best realized SOL into the smart list. Both off with ZOO_OPGRAPH / ZOO_WALLET_PNL=off.
const opGraphOn = Boolean(history) && process.env.ZOO_OPGRAPH !== "off";
const walletPnlOn = Boolean(history) && process.env.ZOO_WALLET_PNL !== "off";
const opGraph = history && opGraphOn ? new OperatorGraph(history.db) : null;
const walletLedger = walletPnlOn ? new WalletLedger(null) : null;
const smart = walletLedger ? new SmartWallets(join(config.dataDir, "smart-wallets.json")) : null;
if (walletLedger) tape.onFill = (w, m, sol, isBuy, ts) => walletLedger.fill(w, m, sol, isBuy, ts);
// The radar's track record is built in the same worker, hourly, from the marks file and radar.jsonl.
let radarRecord: RadarRecord | null = null;
const background = history && (opGraphOn || walletPnlOn || radar)
  ? startBackground(
      {
        dbPath: join(config.dataDir, "history.db"),
        opgraph: opGraphOn,
        pnl: walletPnlOn,
        smartFile: join(config.dataDir, "smart-wallets.json"),
        ...(radar ? { record: { marksFile: join(config.dataDir, "chain-marks.jsonl"), radarFile: join(config.dataDir, "radar.jsonl") } } : {}),
      },
      {
        onMessage: (m) => {
          if (m.t === "record") radarRecord = m.record;
          if (m.t === "min20" && radar) console.log(`[${config.id}] radar backfill: ${radar.backfill(m.rows)} of ${m.rows.length} candidates confirmed at minute 20`);
        },
        ledger: walletLedger,
        smart,
        // Wallets paid by one wallet are one hand: only the best of them is listed. Exchanges and launchers pay everyone.
        clusterOf: (w) => {
          const f = sideWallets.funderOf(w) ?? lineage.funderOf(w) ?? null;
          return f && !exchangeOf(f) && !launcherOf(f) ? `funder:${f}` : null;
        },
        log: (m) => console.log(`[${config.id}] ${m}`),
      },
    )
  : null;
const stopPrintFeed = background && opGraphOn ? startPrintFeed(tape, background) : null;
// Cabals: wallets that work as one hand, rebuilt from the long memory every hour.
const cabals = history ? new CabalIndex(history.db) : null;
const mentions = history ? new Mentions(history.db) : null;
const stopCabals = cabals ? startCabals(cabals, { log: (m) => console.log(`[${config.id}] ${m}`) }) : null;
// Who wallets are said to be: the operator's smart-money file next to the data, and Kolscan's KOLs.
let stopLabels: (() => void) | null = null;
if (config.role === "north") {
  const n = labels.loadFile(process.env.ZOO_LABELS_FILE ?? join(config.dataDir, "labels.json"));
  if (n) console.log(`[${config.id}] labels: ${n} wallets from the labels file`);
  stopLabels = labels.start((m) => console.log(`[${config.id}] ${m}`));
}
// The pinned coin: what it traded while the node was down is read before the stream starts again; never held on the tape,
// it is read whole from its launch in the background and handed over when done.
if (config.role === "north" && tape.isPinned(TOKEN_MINT)) {
  const pinLog = (m: string) => console.log(`[${config.id}] ${m}`);
  if (tape.has(TOKEN_MINT)) await Promise.race([catchUpPinned(TOKEN_MINT, tape, { log: pinLog }).catch(() => 0), new Promise((r) => setTimeout(r, 30_000))]);
  else void seedPinned(TOKEN_MINT, tape, { log: pinLog }).then((r) => pinLog(`pinned ${TOKEN_MINT}: ${JSON.stringify(r)}`), (e: unknown) => pinLog(`pinned ${TOKEN_MINT}: failed ${e instanceof Error ? e.message : String(e)}`));
}
// North reads the chain from the relay when it has one (a hosted gRPC endpoint gave a cloud container a tenth of pump.fun), else directly.
const chainLog = (m: string) => console.log(`[${config.id}] ${m}`);
const stopStream =
  config.role !== "north"
    ? null
    : process.env.ZOO_RELAY_URL && process.env.ZOO_RELAY_TOKEN
      ? startRelayFeed(tape, { url: process.env.ZOO_RELAY_URL, token: process.env.ZOO_RELAY_TOKEN, log: chainLog })
      : process.env.SHYFT_GRPC_TOKEN
        ? await startPumpStream(tape, { url: process.env.SHYFT_GRPC_URL ?? "https://grpc.eu.shyft.to", token: process.env.SHYFT_GRPC_TOKEN, log: chainLog })
        : null;
// Calls are followed from the minute they are made, so the node that reads the chain starts on its own.
if (stopStream) startCallers();
// Pools opened straight on PumpSwap never cross the launchpad stream: the node that reads the chain reads the biggest of them by hand.
if (stopStream && config.role === "north") startPools((m) => console.log(`[${config.id}] ${m}`));

const visitorAgents = enclosure
  .snapshot()
  .filter((a) => a.species === "sentinel")
  .map((a) => a.name);

// The canyon hosts the guest wing: outside agents report to the beaver, and the next-day regrade scores them.
const guests =
  config.role === "canyon" && process.env.ZOO_GUESTS !== "off"
    ? await GuestHouse.open(enclosure, {
        max: Number(process.env.ZOO_GUESTS_MAX ?? 200),
        signalCooldownMs: Number(process.env.ZOO_GUEST_COOLDOWN_MS ?? 10 * 60_000),
      })
    : undefined;

// Guests with a webhook hear when their calls are graded.
if (guests) setInterval(() => void notifyGraded(enclosure, guests, config.briefAt).catch(() => {}), 10 * 60_000);
// The bot lives on the canyon, with the contests; every x-ray it shows is read from north.
const northUrl = config.peers.find((p) => p.id === "north.zoo")?.url;
const telegramHere = config.role === "canyon" && Boolean(process.env.TELEGRAM_BOT_TOKEN);
const stopTelegram = telegramHere
  ? startTelegram({
      token: process.env.TELEGRAM_BOT_TOKEN!,
      store: enclosure.store,
      northUrl,
      marshUrl: config.peers.find((p) => p.id === "marsh.zoo")?.url,
      log: (m) => console.log(`[${config.id}] ${m}`),
      data: { board: leaderboard(enclosure, config.briefAt) },
    })
  : null;

// The buy bot: $ZOOAGENCY buys posted to the holders' group by the zoo's own bot, on the canyon where the bot lives.
const buyChat = Number(process.env.ZOO_BUYBOT_CHAT ?? 0);
const stopBuyBot =
  config.role === "canyon" && process.env.TELEGRAM_BOT_TOKEN && buyChat && northUrl
    ? startBuyBot({
        token: process.env.TELEGRAM_BOT_TOKEN,
        chat: buyChat,
        thread: Number(process.env.ZOO_BUYBOT_THREAD ?? 0) || undefined,
        northUrl,
        store: enclosure.store,
        minSol: Number(process.env.ZOO_BUYBOT_MIN_SOL ?? 1),
        image: process.env.ZOO_BUYBOT_IMAGE || "https://zooaiagency.com/telegram/buybot.jpg",
        log: (m) => console.log(`[${config.id}] ${m}`),
      })
    : null;

// The swap fee loop: a tenth of the fees buys $ZOOAGENCY into the treasury, the rest is swept there as SOL. Key on this node only.
const feeSecret = process.env.ZOO_FEE_WALLET_KEY ?? "";
const feeTreasury = process.env.ZOO_FEE_TREASURY ?? "";
const stopBuyback =
  config.role === "canyon" && feeSecret && feeTreasury && process.env.SOLANA_RPC_URL
    ? startBuyback({ secret: feeSecret, treasury: feeTreasury, mint: process.env.ZOO_TOKEN_MINT || "2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B", rpc: process.env.SOLANA_RPC_URL, store: enclosure.store, buyShare: Number(process.env.ZOO_FEE_BUY_SHARE ?? 0.1), everyMs: Number(process.env.ZOO_FEE_SWEEP_HOURS ?? 6) * 3_600_000, log: (m) => console.log(`[${config.id}] ${m}`) })
    : null;
const feeHot = process.env.ZOO_FEE_WALLET_PUBKEY ?? null;

// The zoo watching itself: a silent stream or a node down, straight to the operators.
const alertChats = String(process.env.ZOO_ALERT_CHAT ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n !== 0);
const stopWatchdog =
  config.role === "canyon" && process.env.TELEGRAM_BOT_TOKEN && alertChats.length
    ? startWatchdog({
        token: process.env.TELEGRAM_BOT_TOKEN,
        chats: alertChats,
        northUrl,
        peers: config.peers.map((p) => ({ name: p.id, url: p.url })),
        log: (m) => console.log(`[${config.id}] ${m}`),
      })
    : null;

// x402 sells the X-Ray per call on the node that reads the chain; only there is a report to sell.
const x402 = config.role === "north" ? await laneFromEnv(enclosure).catch((e: unknown) => (console.log(`[${config.id}] x402 off: ${(e as Error).message}`), null)) : null;
if (x402) for (const n of x402.networks) console.log(`[${config.id}] x402 on ${n.network}: pay to ${n.payTo}, fee payer ${n.feePayer}`);

const server = createNodeServer({
  enclosure,
  x402,
  adminToken: config.adminToken,
  corsOrigin: config.corsOrigin,
  meta: { role: config.role, ai: false, visitorAgents },
  passports: await PassportIndex.build(enclosure),
  guests,
  telegram: telegramHere,
  ...(config.role === "canyon" ? { stats: canyonStats(enclosure, config.briefAt, guests), board: leaderboard(enclosure, config.briefAt), oddsHistory: oddsRecord(enclosure, config.briefAt), weekly: agentOfWeek(enclosure, config.briefAt), contest: { briefAt: config.briefAt } } : {}),
  ...(config.role === "north" ? { watchlist: { perGuardian: 3, maxGuardians: 500, perHolder: 10 } } : {}),
  ...(history ? { history } : {}),
  ...(radar ? { radar, radarRecord: () => radarRecord } : {}),
  ...(cabals ? { cabals } : {}),
  ...(opGraph ? { opGraph } : {}),
  ...(smart ? { smart } : {}),
  ...(mentions ? { mentions } : {}),
  ...(config.role === "north" ? { sideWallets } : {}),
  buybacks: () => buybackView(enclosure.store, feeHot, feeTreasury || null, Number(process.env.ZOO_FEE_BUY_SHARE ?? 0.1)),
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
      `${config.peers.length} peer(s)`,
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
        stopCabals?.();
        stopPrintFeed?.();
        void background?.stop();
        // The last half minute of fills is written here, in one go: the node is on its way down.
        const rest = walletLedger?.drain();
        if (rest && history) new WalletLedger(history.db).writeRows(rest);
        stopLabels?.();
        stopBuyback?.();
        history?.close();
      } catch {
        /* at most the last few seconds of history are lost */
      }
    }
    stopTelegram?.();
    stopWatchdog?.();
    stopBuyBot?.();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
