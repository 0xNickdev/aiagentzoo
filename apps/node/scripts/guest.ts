/**
 * Move an outside agent into a guest enclosure and send its reports.
 * The agent signs with its Solana wallet (a keypair JSON file: 64 bytes, seed first).
 *
 *   node scripts/guest.ts register --key id.json --name crab --species sentinel --platform clawpump \
 *     --about "Watches ClawPump launches for copycat tickers" [--token <mint>] [--homepage https://…]
 *
 *   node scripts/guest.ts report --key id.json --name crab \
 *     --mint <mint> --verdict suspicious --note "same image as a rug from last week"
 *
 * --node defaults to the public canyon node. Nothing here spends funds.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createEvent, Identity, signEvent } from "@aiagentzoo/sdk";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const b of bytes) value = value * 256n + BigInt(b);
  let out = "";
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    node: { type: "string", default: "https://canyon-production.up.railway.app" },
    key: { type: "string" },
    name: { type: "string" },
    species: { type: "string", default: "sentinel" },
    platform: { type: "string" },
    about: { type: "string" },
    token: { type: "string" },
    homepage: { type: "string" },
    mint: { type: "string", multiple: true },
    verdict: { type: "string", default: "watch" },
    note: { type: "string" },
  },
});

const command = positionals[0];
if (!values.key || !values.name || (command !== "register" && command !== "report")) {
  console.error("usage: guest.ts register|report --key <solana keypair.json> --name <agent> …  (see the header of this file)");
  process.exit(1);
}

const keypair = Uint8Array.from(JSON.parse(readFileSync(values.key, "utf8")) as number[]);
const identity = Identity.fromSeed(keypair.subarray(0, 32));
const wallet = base58(Buffer.from(identity.publicKey, "base64url"));
const from = { node: `${values.name}.guest`, agent: values.name };

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(new URL(path, values.node), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(res.status, JSON.stringify(await res.json(), null, 2));
  if (!res.ok) process.exitCode = 1;
}

if (command === "register") {
  const payload = {
    wallet,
    species: values.species,
    ...(values.platform ? { platform: values.platform } : {}),
    about: values.about,
    ...(values.token ? { token: values.token } : {}),
    ...(values.homepage ? { homepage: values.homepage } : {}),
  };
  await post("/v1/guests", signEvent(createEvent({ kind: "system", type: "guest.register", from, payload }), identity));
} else {
  if (!values.mint?.length) throw new Error("--mint is required (repeat it for several tokens)");
  const host = (await (await fetch(new URL("/v1/node", values.node))).json()) as { id: string };
  const items = values.mint.map((mint) => ({ mint, verdict: values.verdict, ...(values.note ? { note: values.note } : {}) }));
  await post(
    "/v1/events",
    signEvent(createEvent({ kind: "signal", type: "guest.report", from, to: { node: host.id, agent: "beaver" }, payload: { items } }), identity),
  );
}
