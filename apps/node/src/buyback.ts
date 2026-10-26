import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * The swap fee loop. Every trade in the X-Ray pays its fee in SOL to a hot wallet whose key lives only on this node.
 * On a schedule the node sweeps it: a tenth buys $ZOOAGENCY through Jupiter, straight into the treasury's token account,
 * the rest goes to the treasury as SOL. Every run is written down and served at /v1/buybacks, so the split can be
 * checked transaction by transaction. The hot wallet never holds more than the fees since the last sweep.
 */

const JUP = "https://lite-api.jup.ag/swap/v1";
const SOL = "So11111111111111111111111111111111111111112";
/** Kept on the hot wallet for network fees and rent. */
const RESERVE_SOL = 0.01;
/** Nothing is swept under this: a tenth of it would not be a trade. */
const MIN_SWEEP_SOL = 0.05;

export interface BuybackRun {
  at: number;
  feesSol: number;
  buySol: number;
  sweptSol: number;
  tokens: number | null;
  buyTx: string | null;
  sweepTx: string | null;
  error?: string;
}

export interface BuybackOptions {
  /** Base58 secret key of the hot wallet that receives the swap fees. */
  secret: string;
  treasury: string;
  mint: string;
  rpc: string;
  store: { get<T>(key: string): Promise<T | undefined> | T | undefined; set(key: string, value: unknown): Promise<void> | void };
  /** Share of the fees that buys the token, 0..1. */
  buyShare?: number;
  everyMs?: number;
  log?: (m: string) => void;
  fetchFn?: typeof fetch;
}

const KEY = "buyback:runs";
const KEEP = 500;

export async function buybackView(store: BuybackOptions["store"], hot: string | null, treasury: string | null, buyShare: number) {
  const runs = (await store.get<BuybackRun[]>(KEY)) ?? [];
  const done = runs.filter((r) => !r.error);
  return {
    hot,
    treasury,
    buyShare,
    totals: { feesSol: done.reduce((n, r) => n + r.feesSol, 0), boughtSol: done.reduce((n, r) => n + r.buySol, 0), sweptSol: done.reduce((n, r) => n + r.sweptSol, 0), runs: done.length },
    runs: runs.slice(0, 50),
  };
}

export async function sweepOnce(opts: BuybackOptions): Promise<BuybackRun | null> {
  const f = opts.fetchFn ?? fetch;
  const log = opts.log ?? (() => {});
  const buyShare = opts.buyShare ?? 0.1;
  const kp = Keypair.fromSecretKey(bs58.decode(opts.secret));
  const c = new Connection(opts.rpc, "confirmed");
  const treasury = new PublicKey(opts.treasury);
  const mint = new PublicKey(opts.mint);
  const balance = (await c.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
  const fees = balance - RESERVE_SOL;
  if (fees < MIN_SWEEP_SOL) return null;
  const buySol = Math.floor(fees * buyShare * 1e6) / 1e6;
  const sweepSol = Math.floor((fees - buySol) * 1e6) / 1e6;
  const run: BuybackRun = { at: Date.now(), feesSol: Math.round(fees * 1e6) / 1e6, buySol, sweptSol: sweepSol, tokens: null, buyTx: null, sweepTx: null };
  try {
    // The treasury's token account, made once by the hot wallet, so the buy lands in the treasury straight away.
    const { getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction } = await import("@solana/spl-token");
    const ata = await getAssociatedTokenAddress(mint, treasury);
    const q = await (await f(`${JUP}/quote?inputMint=${SOL}&outputMint=${opts.mint}&amount=${Math.round(buySol * LAMPORTS_PER_SOL)}&slippageBps=300`, { signal: AbortSignal.timeout(15_000) })).json() as { outAmount?: string; error?: string };
    if (!q.outAmount) throw new Error(q.error ?? "no route");
    const sw = await (await f(`${JUP}/swap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteResponse: q, userPublicKey: kp.publicKey.toBase58(), wrapAndUnwrapSol: true, destinationTokenAccount: ata.toBase58(), dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 2_000_000, priorityLevel: "high" } } }), signal: AbortSignal.timeout(20_000) })).json() as { swapTransaction?: string; error?: string };
    if (!sw.swapTransaction) throw new Error(sw.error ?? "Jupiter gave no transaction");
    // The token account first, in its own small transaction, so the swap finds it.
    const ataTx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, ata, treasury, mint));
    ataTx.feePayer = kp.publicKey;
    ataTx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
    ataTx.sign(kp);
    const ataSig = await c.sendRawTransaction(ataTx.serialize(), { skipPreflight: false });
    await c.confirmTransaction(ataSig, "confirmed");
    const tx = VersionedTransaction.deserialize(Buffer.from(sw.swapTransaction, "base64"));
    tx.sign([kp]);
    run.buyTx = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await c.confirmTransaction(run.buyTx, "confirmed");
    const supply = await c.getTokenSupply(mint);
    run.tokens = Number(q.outAmount) / 10 ** supply.value.decimals;
    // The rest of the fees to the treasury as SOL.
    const sweep = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: treasury, lamports: Math.round(sweepSol * LAMPORTS_PER_SOL) }));
    sweep.feePayer = kp.publicKey;
    sweep.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
    sweep.sign(kp);
    run.sweepTx = await c.sendRawTransaction(sweep.serialize());
    await c.confirmTransaction(run.sweepTx, "confirmed");
    log(`buyback: ${run.feesSol} SOL of fees, bought ${run.tokens ?? "?"} tokens for ${buySol} SOL (${run.buyTx}), swept ${sweepSol} SOL (${run.sweepTx})`);
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
    log(`buyback failed: ${run.error}`);
  }
  const runs = (await opts.store.get<BuybackRun[]>(KEY)) ?? [];
  await opts.store.set(KEY, [run, ...runs].slice(0, KEEP));
  return run;
}

/** Sweeps on a schedule; the first run a minute after start. */
export function startBuyback(opts: BuybackOptions): () => void {
  const every = opts.everyMs ?? 6 * 3_600_000;
  const tick = () => void sweepOnce(opts).catch((e) => opts.log?.(`buyback: ${(e as Error).message}`));
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, every);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
