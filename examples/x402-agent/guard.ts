/**
 * ZOO GUARD: a seatbelt for a trading agent, paid per call over x402.
 *
 * Before a swap the agent asks ZOOAI who is behind the coin. There is no API key and no sign-up: the first request
 * comes back 402 with the price, @x402/fetch signs a USDC transfer with the agent's wallet and retries, the node
 * settles it on Solana and answers with the report. The agent then decides: avoid -> no trade.
 *
 *   npm run keygen                         # makes agent.json, prints the address to fund with devnet USDC
 *   npm run guard -- <mint> [<mint> ...]   # 0.001 USDC check per coin
 *   npm run guard -- --xray <mint>         # 0.01 USDC full X-Ray: dev history, funders, first-seconds wallets, money trail
 *
 * The agent only needs USDC: the node pays the network fee. Devnet USDC: https://faucet.circle.com (Solana Devnet).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createKeyPairSignerFromBytes, generateKeyPairSigner } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { wrapFetchWithPayment } from "@x402/fetch";
import { toClientSvmSigner } from "@x402/svm";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const NODE = process.env.ZOO_NODE ?? "https://north.zooaiagency.com";
const KEY_FILE = process.env.AGENT_KEY_FILE ?? "agent.json";
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

interface Check {
  verdict: "avoid" | "caution" | "pass" | "unknown";
  symbol?: string;
  reasons?: string[];
  proceed?: boolean;
  odds?: { run: number | null; vsAverage: number | null; devDumps: number | null } | null;
}
interface XRay {
  symbol?: string;
  creator?: string;
  check: Check;
  creatorRecord?: { launches48h?: number; dumped?: number } | null;
  trail?: { says?: string } | null;
}

async function keygen(): Promise<void> {
  if (existsSync(KEY_FILE)) return console.log(`${KEY_FILE} exists; fund this address with devnet USDC:`, (await loadSigner()).address);
  const { webcrypto } = await import("node:crypto");
  // An extractable key, so it can be written out the way solana-keygen writes one: 32 secret bytes then 32 public.
  const pair = (await webcrypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey));
  const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey));
  writeFileSync(KEY_FILE, JSON.stringify([...pkcs8.slice(-32), ...raw]), { mode: 0o600 });
  console.log(`wrote ${KEY_FILE}. Fund it with devnet USDC at https://faucet.circle.com (Solana Devnet):`, (await loadSigner()).address);
  void generateKeyPairSigner; // kit's own generator makes non-extractable keys, hence WebCrypto above
}

async function loadSigner() {
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(KEY_FILE, "utf8")) as number[]));
}

const pct = (x: number | null | undefined) => (x == null ? "?" : `${Math.round(x * 100)}%`);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--keygen")) return keygen();
  const xray = args.includes("--xray");
  const mints = args.filter((a) => !a.startsWith("--"));
  if (!mints.length) {
    console.log("usage: npm run guard -- [--xray] <mint> [<mint> ...]");
    process.exit(1);
  }

  const signer = await loadSigner();
  const client = new x402Client().register("solana:*", new ExactSvmScheme(toClientSvmSigner(signer), { rpcUrl: RPC }));
  const paidFetch = wrapFetchWithPayment(fetch, client);
  const menu = (await (await fetch(`${NODE}/v1/x402`)).json()) as { cluster: string; resources: Array<{ url: string; price: { usdc: number } }> };
  console.log(`agent ${signer.address} on ${menu.cluster}; prices: ${menu.resources.map((r) => `${r.url.split("/")[5]} ${r.price.usdc} USDC`).join(", ")}\n`);

  for (const mint of mints) {
    const started = Date.now();
    const res = await paidFetch(`${NODE}/v1/x402/${xray ? "xray" : "check"}/${mint}`);
    const ms = Date.now() - started;
    if (res.status !== 200 || res.headers.get("x402-charged") === "false") {
      const body = await res.text();
      const charged = res.headers.get("x402-charged");
      console.log(`${mint}: ${res.status}${charged === "false" ? " (not charged)" : ""} ${body.slice(0, 200)}\n`);
      continue;
    }
    const paid = decodePaymentResponseHeader(res.headers.get("payment-response")!);
    const body = (await res.json()) as Check | XRay;
    const check: Check = "check" in body && body.check ? body.check : (body as Check);
    const symbol = body.symbol ? `$${body.symbol}` : mint.slice(0, 6);
    const decision = check.verdict === "avoid" ? "REFUSE the swap" : check.verdict === "caution" ? "trade small, set a tight exit" : "no red flags so far: the agent may trade";
    console.log(`${symbol}  ${check.verdict.toUpperCase()}  -> ${decision}`);
    for (const r of (check.reasons ?? []).slice(0, 3)) console.log(`  - ${r}`);
    if (check.odds) console.log(`  odds it runs: ${pct(check.odds.run)} (${check.odds.vsAverage ?? "?"}x the average), dev still dumps: ${pct(check.odds.devDumps)}`);
    if ("trail" in body && body.trail?.says) console.log(`  money: ${body.trail.says}`);
    console.log(`  paid ${paid.transaction.slice(0, 16)}... https://explorer.solana.com/tx/${paid.transaction}?cluster=${menu.cluster}`);
    console.log(`  report sha256 ${res.headers.get("x-report-sha256")} (also in the node's public receipts) - ${ms} ms\n`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
