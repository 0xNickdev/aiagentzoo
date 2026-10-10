/**
 * Listens to the pump.fun stream for a while and prints what the tape makes of it. Checks a Yellowstone
 * endpoint and token before they go on a node; nothing is stored.
 *
 *   SHYFT_GRPC_TOKEN=... [SHYFT_GRPC_URL=https://grpc.eu.shyft.to] node scripts/chain-probe.ts [seconds]
 */
import { startPumpStream, tape } from "../src/chain/pump.ts";

const token = process.env.SHYFT_GRPC_TOKEN;
if (!token) {
  console.error("set SHYFT_GRPC_TOKEN");
  process.exit(1);
}
const seconds = Number(process.argv[2] ?? 30);
const stop = await startPumpStream(tape, { url: process.env.SHYFT_GRPC_URL ?? "https://grpc.eu.shyft.to", token });
await new Promise((r) => setTimeout(r, seconds * 1000));
stop();
console.log(JSON.stringify(tape.status()));
for (const l of tape.launches(8)) {
  console.log(`${l.symbol.padEnd(12)} ${l.mint}  age ${l.chain.ageMin}m  buys ${l.chain.buys} sells ${l.chain.sells}  creator sold ${l.chain.creatorSold ?? "-"}  creator launches today ${l.chain.creatorLaunches24h}`);
}
process.exit(0);
