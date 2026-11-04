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
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { wrapFetchWithPayment } from "@x402/fetch";
import { toClientSvmSigner } from "@x402/svm";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const NODE = process.env.ZOO_NODE ?? "https://north.zooaiagency.com";
const KEY_FILE = process.env.AGENT_KEY_FILE ?? "agent.json";
/** Which network the agent pays on: devnet by default (free test USDC), mainnet with X402_NETWORK=mainnet. */
const MAINNET = process.env.X402_NETWORK === "mainnet";
const NETWORK = MAINNET ? "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" : "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const RPC = process.env.SOLANA_RPC_URL ?? (MAINNET ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");

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
  // An extractable key (kit's own generator makes non-extractable ones), so it can be written out the way solana-keygen writes one: 32 secret bytes then 32 public.
  const pair = (await webcrypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey));
  const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey));
  writeFileSync(KEY_FILE, JSON.stringify([...pkcs8.slice(-32), ...raw]), { mode: 0o600 });
  console.log(`wrote ${KEY_FILE}. Fund it with devnet USDC at https://faucet.circle.com (Solana Devnet):`, (await loadSigner()).address);
}

async function loadSigner() {
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(KEY_FILE, "utf8")) as number[]));
}

/** The agent's USDC balance in whole USDC, read straight from Solana. */
async function usdcBalance(owner: string, mint: string): Promise<number> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [owner, { mint }, { encoding: "jsonParsed" }] }),
  });
  const body = (await res.json()) as { result?: { value: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } } }> } };
  return (body.result?.value ?? []).reduce((sum, a) => sum + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

/** What the node's refusal means, in a sentence: the codes are x402's, the advice is ours. */
function explain(reason: string): string {
  if (/simulation_failed|insufficient/i.test(reason)) return "the USDC transfer would fail on chain: is the wallet funded with USDC on this network?";
  if (/blockhash|expired/i.test(reason)) return "the signed transfer expired before it reached the node: run it again";
  if (/duplicate/i.test(reason)) return "this exact payment was already used: each request needs a fresh one";
  return reason;
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
  // Registered for one network only, so the client pays where this wallet holds USDC, whatever the node offers first.
  const client = new x402Client().register(NETWORK, new ExactSvmScheme(toClientSvmSigner(signer), { rpcUrl: RPC }));
  // Says each x402 step out loud: the node's 402 with the price, then the retry that carries the signed USDC transfer.
  const shown = (path: string) => path.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/, (m) => `${m.slice(0, 6)}...${m.slice(-4)}`);
  const steps: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const path = shown(new URL(req.url).pathname);
    const paying = req.headers.has("PAYMENT-SIGNATURE");
    if (paying) console.log(`  -> GET ${path} + PAYMENT-SIGNATURE (USDC transfer signed by the agent)`);
    const res = await fetch(req);
    if (res.status === 402 && !paying) console.log(`  <- 402 Payment Required for GET ${path}: ${price} USDC on ${menu.cluster}`);
    return res;
  };
  const paidFetch = wrapFetchWithPayment(steps, client);
  const offered = (await (await fetch(`${NODE}/v1/x402`)).json()) as { networks: Array<{ network: string; cluster: string; asset: { mint: string } }>; resources: Array<{ url: string; price: { usdc: number } }> };
  const net = offered.networks.find((n) => n.network === NETWORK);
  if (!net) {
    console.log(`the node does not take payment on ${NETWORK}; it offers ${offered.networks.map((n) => n.cluster).join(", ")}`);
    process.exit(1);
  }
  const menu = { ...net, resources: offered.resources };
  const explorer = MAINNET ? "" : "?cluster=devnet";
  // Paying from an empty wallet only gets a refusal back: say how to fund it instead.
  const price = menu.resources.find((r) => r.url.includes(xray ? "/xray/" : "/check/"))?.price.usdc ?? 0;
  const balance = await usdcBalance(signer.address, menu.asset.mint).catch(() => null);
  if (balance !== null && balance < price * mints.length) {
    console.log(`agent ${signer.address} holds ${balance} USDC on ${menu.cluster}; ${mints.length} ${xray ? "x-ray" : "check"}(s) cost ${price * mints.length} USDC.`);
    if (menu.cluster === "devnet") console.log("Fund it with devnet USDC at https://faucet.circle.com (pick Solana Devnet). No SOL needed: the node pays the network fee.");
    process.exit(1);
  }
  console.log(`agent ${signer.address} on ${menu.cluster}; prices: ${menu.resources.map((r) => `${r.url.split("/")[5]} ${r.price.usdc} USDC`).join(", ")}\n`);

  for (const mint of mints) {
    const started = Date.now();
    const res = await paidFetch(`${NODE}/v1/x402/${xray ? "xray" : "check"}/${mint}`);
    const ms = Date.now() - started;
    if (res.status === 402) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      console.log(`${mint}: payment refused, not charged: ${explain(body.error ?? "unknown reason")}\n`);
      continue;
    }
    if (res.status !== 200 || res.headers.get("x402-charged") === "false") {
      const body = (await res.json().catch(() => ({}))) as { error?: string; verdict?: string };
      const what = body.verdict === "unknown" ? "the zoo has nothing on this token yet" : (body.error ?? `HTTP ${res.status}`);
      console.log(`${mint}: not charged: ${what}\n`);
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
    console.log(`  paid ${paid.transaction.slice(0, 16)}... https://explorer.solana.com/tx/${paid.transaction}${explorer}`);
    console.log(`  report sha256 ${res.headers.get("x-report-sha256")} (also in the node's public receipts) - ${ms} ms\n`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
