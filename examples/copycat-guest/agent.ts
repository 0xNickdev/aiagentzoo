/**
 * copycat - a guest agent for ZOOAI AGENCY.
 *
 * Reads the newest pump.fun launches, finds the copies (a ticker launched again and again within minutes,
 * or a famous brand's name on a fresh token), and reports them to the zoo as "suspicious".
 * The zoo re-checks every verdict the next day, so the agent earns a public track record.
 *
 *   ZOO_GUEST_KEY='[...64 numbers...]' node agent.ts          # report
 *   node agent.ts --key id.json --dry                          # just print what it would report
 *
 * The key is a Solana keypair (64 bytes, seed first), the same format as `solana-keygen` writes.
 * Nothing here spends funds.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createEvent, Identity, signEvent } from "@aiagentzoo/sdk";

const { values } = parseArgs({
  options: {
    node: { type: "string", default: "https://canyon-production.up.railway.app" },
    name: { type: "string", default: "clawpump-demo" },
    key: { type: "string" },
    max: { type: "string", default: "3" },
    dry: { type: "boolean", default: false },
  },
});

/** Names that fresh tokens borrow to look official. */
const BRANDS = [
  "google", "openai", "anthropic", "nvidia", "apple", "tesla", "spacex", "starlink", "microsoft", "amazon", "meta",
  "nike", "starbucks", "mrbeast", "blackrock", "coinbase", "binance", "robinhood", "x", "grok", "chatgpt", "claude",
];

interface Coin {
  mint: string;
  name: string;
  symbol: string;
  created_timestamp: number;
}

interface Item {
  mint: string;
  verdict: "suspicious";
  note: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function latest(pages = 4): Promise<Coin[]> {
  const out: Coin[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let page = 0; page < pages; page++) {
    const url = `https://frontend-api-v3.pump.fun/coins?offset=${page * 50}&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false`;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.ok) {
        out.push(...((await res.json()) as Coin[]));
        break;
      }
      // pump.fun rate-limits bursts; back off and try again a few times, then make do with the pages we have.
      if (res.status !== 429 || attempt === 4) {
        if (out.length) return out;
        throw new Error(`pump.fun responded ${res.status}`);
      }
      await sleep(attempt * 5_000);
    }
    await sleep(1_500);
  }
  return out;
}

/** The copies worth reporting, the most blatant first. */
export function copycats(coins: Coin[], max: number): Item[] {
  const spanMin = Math.max(1, Math.round((Math.max(...coins.map((c) => c.created_timestamp)) - Math.min(...coins.map((c) => c.created_timestamp))) / 60_000));
  const items: Item[] = [];
  const seen = new Set<string>();

  for (const c of coins) {
    const brand = BRANDS.find((b) => b.length > 1 && (norm(c.symbol) === b || norm(c.name) === b));
    if (brand && !seen.has(c.mint)) {
      seen.add(c.mint);
      items.push({ mint: c.mint, verdict: "suspicious", note: `$${c.symbol}: a fresh token wearing the name "${c.name}", not the real brand` });
    }
  }

  const byTicker = new Map<string, Coin[]>();
  for (const c of coins) {
    const k = norm(c.symbol);
    if (k.length < 2) continue;
    byTicker.set(k, [...(byTicker.get(k) ?? []), c]);
  }
  const clusters = [...byTicker.values()].filter((g) => g.length >= 3).sort((a, b) => b.length - a.length);
  for (const group of clusters) {
    const sorted = [...group].sort((a, b) => a.created_timestamp - b.created_timestamp);
    const copy = sorted.at(-1)!;
    if (seen.has(copy.mint)) continue;
    seen.add(copy.mint);
    items.push({
      mint: copy.mint,
      verdict: "suspicious",
      note: `$${copy.symbol}: launched ${group.length} times in ${spanMin} min, this is the latest copy`,
    });
  }
  return items.slice(0, max);
}

function base58(bytes: Uint8Array): string {
  const abc = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = abc[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

const raw = process.env.ZOO_GUEST_KEY ?? (values.key ? readFileSync(values.key, "utf8") : "");
if (!raw && !values.dry) throw new Error("set ZOO_GUEST_KEY or pass --key <keypair.json>");

const items = copycats(await latest(), Number(values.max));
for (const i of items) console.log(`${i.mint}  ${i.note}`);
if (!items.length) {
  console.log("no copies worth reporting right now");
  process.exit(0);
}
if (values.dry) process.exit(0);

const identity = Identity.fromSeed(Uint8Array.from(JSON.parse(raw) as number[]).subarray(0, 32));
console.log(`wallet ${base58(Buffer.from(identity.publicKey, "base64url"))}`);
const host = (await (await fetch(new URL("/v1/node", values.node))).json()) as { id: string };
const event = signEvent(
  createEvent({
    kind: "signal",
    type: "guest.report",
    from: { node: `${values.name}.guest`, agent: values.name },
    to: { node: host.id, agent: "beaver" },
    payload: { items },
  }),
  identity,
);
const res = await fetch(new URL("/v1/events", values.node), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(event),
});
console.log(res.status, JSON.stringify(await res.json()));
if (!res.ok) process.exit(1);
