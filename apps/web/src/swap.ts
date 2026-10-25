/**
 * The swap inside the X-Ray: a Jupiter route, signed by the reader's own wallet, with a small fee in SOL to the zoo's
 * treasury on every trade (a plain transfer in the same transaction, so the fee is SOL whichever way the trade goes).
 * Nothing is held by us: the wallet signs one transaction and keeps the keys. web3.js loads only when a swap starts.
 */

import { walletProvider } from "./zoo";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUP = "https://lite-api.jup.ag/swap/v1";
const RPC = ((import.meta.env.VITE_SOLANA_RPC as string | undefined) ?? "").trim() || "https://api.mainnet-beta.solana.com";

/** Where the fee goes; the swap stays hidden until a deployment sets it. */
export const TREASURY: string = ((import.meta.env.VITE_SWAP_TREASURY as string | undefined) ?? "").trim();
/** Fee in basis points of the SOL side of the trade. 100 = 1%. */
export const FEE_BPS: number = Math.min(500, Math.max(0, Number(import.meta.env.VITE_SWAP_FEE_BPS) || 100));
export const swapEnabled = () => TREASURY.length >= 32 && FEE_BPS > 0;

export interface Quote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: Array<{ swapInfo: { label: string } }>;
  [k: string]: unknown;
}

interface JupIx {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: string;
}

interface SwapIxs {
  computeBudgetInstructions: JupIx[];
  setupInstructions: JupIx[];
  swapInstruction: JupIx;
  cleanupInstruction: JupIx | null;
  otherInstructions?: JupIx[];
  addressLookupTableAddresses: string[];
  blockhashWithMetadata?: { blockhash: number[]; lastValidBlockHeight: number };
  simulationError?: { error?: string; errorCode?: string } | null;
}

export async function quote(inputMint: string, outputMint: string, amount: bigint, slippageBps = 300): Promise<Quote> {
  const u = `${JUP}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(12_000) });
  const body = (await r.json()) as Quote & { error?: string };
  if (!r.ok || body.error || !body.outAmount) throw new Error(body.error || "no route for this trade right now");
  return body;
}

/** Fee in lamports for a quote: a share of whichever side is SOL. */
export function feeLamports(q: Quote): bigint {
  const sol = q.inputMint === SOL_MINT ? BigInt(q.inAmount) : q.outputMint === SOL_MINT ? BigInt(q.outAmount) : 0n;
  return (sol * BigInt(FEE_BPS)) / 10_000n;
}

export interface SwapResult {
  signature: string;
}

/** Decimals of a mint, for showing amounts; pump.fun tokens are 6, SOL is 9. Read once per mint. */
const decimalsKept = new Map<string, number>([[SOL_MINT, 9]]);
export async function decimalsOf(mint: string): Promise<number> {
  const hit = decimalsKept.get(mint);
  if (hit !== undefined) return hit;
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const c = new Connection(RPC, "confirmed");
  const d = (await c.getTokenSupply(new PublicKey(mint))).value.decimals;
  decimalsKept.set(mint, d);
  return d;
}

/** The reader's balance of a mint, in whole tokens (SOL: lamports as SOL). */
export async function balanceOf(owner: string, mint: string): Promise<number> {
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const c = new Connection(RPC, "confirmed");
  const o = new PublicKey(owner);
  if (mint === SOL_MINT) return (await c.getBalance(o)) / 1e9;
  const accounts = await c.getParsedTokenAccountsByOwner(o, { mint: new PublicKey(mint) });
  return accounts.value.reduce((n, a) => n + (Number(a.account.data.parsed?.info?.tokenAmount?.uiAmount) || 0), 0);
}

/**
 * Builds, signs and sends the trade: Jupiter's instructions plus one SOL transfer to the treasury, in one versioned
 * transaction the wallet signs. Returns the signature once the wallet has sent it.
 */
export async function swap(q: Quote, owner: string): Promise<SwapResult> {
  const wallet = walletProvider();
  if (!wallet?.signAndSendTransaction) throw new Error("this wallet cannot sign transactions here");
  const r = await fetch(`${JUP}/swap-instructions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: q, userPublicKey: owner, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 2_000_000, priorityLevel: "high" } } }),
    signal: AbortSignal.timeout(15_000),
  });
  const ixs = (await r.json()) as SwapIxs & { error?: string };
  if (!r.ok || ixs.error) throw new Error(ixs.error || "Jupiter could not prepare the trade");
  if (ixs.simulationError?.error) throw new Error(`the trade would fail: ${ixs.simulationError.error}`);

  const { Connection, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } = await import("@solana/web3.js");
  const { Buffer } = await import("buffer");
  const toIx = (ix: JupIx) =>
    new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
      data: Buffer.from(ix.data, "base64"),
    });
  const payer = new PublicKey(owner);
  const fee = feeLamports(q);
  const feeIx = fee > 0n ? [SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(TREASURY), lamports: fee })] : [];
  const instructions = [
    ...ixs.computeBudgetInstructions.map(toIx),
    ...ixs.setupInstructions.map(toIx),
    ...feeIx,
    toIx(ixs.swapInstruction),
    ...(ixs.cleanupInstruction ? [toIx(ixs.cleanupInstruction)] : []),
    ...(ixs.otherInstructions ?? []).map(toIx),
  ];
  const c = new Connection(RPC, "confirmed");
  const tables = (
    await Promise.all(ixs.addressLookupTableAddresses.map(async (a) => (await c.getAddressLookupTable(new PublicKey(a))).value))
  ).filter((t): t is NonNullable<typeof t> => t !== null);
  const blockhash = ixs.blockhashWithMetadata ? new PublicKey(Uint8Array.from(ixs.blockhashWithMetadata.blockhash)).toBase58() : (await c.getLatestBlockhash("confirmed")).blockhash;
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message(tables);
  const tx = new VersionedTransaction(message);
  const sent = await wallet.signAndSendTransaction(tx);
  return { signature: typeof sent === "string" ? sent : sent.signature };
}

/** Waits for the transaction to land (confirmed) or fail, up to about a minute. */
export async function landed(signature: string): Promise<"confirmed" | "failed" | "unknown"> {
  const { Connection } = await import("@solana/web3.js");
  const c = new Connection(RPC, "confirmed");
  for (let i = 0; i < 30; i++) {
    const s = (await c.getSignatureStatuses([signature])).value[0];
    if (s?.err) return "failed";
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return "confirmed";
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return "unknown";
}
