// The chain relay: reads pump.fun, LaunchLab, Meteora and PumpSwap from the Yellowstone stream on a server the stream
// reaches at full speed, parses every transaction into the tape's events and hands them to north as lines of JSON.
// The stream gave Railway a tenth of pump.fun; from a plain server it gives all of it.
//
//   SHYFT_GRPC_TOKEN=... ZOO_RELAY_TOKEN=... node scripts/relay.ts
//   GET /events?after=<seq>   Authorization: Bearer <ZOO_RELAY_TOKEN>   one JSON line per event, kept open
//   GET /health               how far it got, for a person or a watchdog
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { type PumpEvent, startPumpStream, type StreamSink } from "../src/chain/pump.ts";

const TOKEN = process.env.ZOO_RELAY_TOKEN;
const GRPC_TOKEN = process.env.SHYFT_GRPC_TOKEN;
if (!TOKEN || !GRPC_TOKEN) throw new Error("set ZOO_RELAY_TOKEN and SHYFT_GRPC_TOKEN");
const PORT = Number(process.env.PORT ?? 8797);
/** About ten minutes of events at a busy 400 a second: enough for north to pick up after a deploy. */
const KEEP = 250_000;

const epoch = randomUUID();
let seq = 0;
let ring: string[] = [];
let lastAt = 0;
const clients = new Set<ServerResponse>();

function send(res: ServerResponse, line: string) {
  // A reader that stopped reading is dropped, not buffered without end.
  if (res.writableLength > 64 << 20) {
    res.destroy();
    clients.delete(res);
    return;
  }
  res.write(line);
}

const sink: StreamSink = {
  connected: false,
  apply(ev: PumpEvent, _now?: number, tx?: string, slot?: number) {
    seq += 1;
    lastAt = Date.now();
    const line = `${JSON.stringify([seq, ev, tx ?? null, slot ?? null])}\n`;
    ring.push(line);
    if (ring.length > KEEP * 1.2) ring = ring.slice(-KEEP);
    for (const c of clients) send(c, line);
  },
  poolAddresses: () => [],
  prune: () => {},
};

await startPumpStream(sink, { url: process.env.SHYFT_GRPC_URL ?? "https://grpc.eu.shyft.to", token: GRPC_TOKEN, allPools: true, log: (m) => console.log(`[relay] ${m}`) });

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://relay");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ live: sink.connected && Date.now() - lastAt < 60_000, seq, lastEventSecAgo: Math.round((Date.now() - lastAt) / 1000), readers: clients.size }));
    return;
  }
  if (url.pathname !== "/events") {
    res.writeHead(404).end();
    return;
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401).end();
    return;
  }
  const after = Number(url.searchParams.get("after") ?? 0) || 0;
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  res.write(`${JSON.stringify({ hello: epoch })}\n`);
  // What the reader missed while it was away, as far back as the ring goes.
  const first = seq - ring.length + 1;
  for (let i = Math.max(0, after + 1 - first); i < ring.length; i++) send(res, ring[i]!);
  clients.add(res);
  req.on("close", () => clients.delete(res));
}).listen(PORT, () => console.log(`[relay] listening on :${PORT}`));

// An empty line every 15 s keeps proxies from closing a quiet connection.
setInterval(() => {
  for (const c of clients) send(c, "\n");
}, 15_000).unref();
