/**
 * Any-chain funding for the X-Ray buy, through Aurora Intents (NEAR Intents underneath): the reader pays in what they
 * hold on another chain, Aurora swaps it into SOL delivered to their own Solana wallet, then the Jupiter buy runs as
 * usual. Swap API: quote -> deposit address -> the reader sends -> we submit the tx hash -> poll until SUCCESS or
 * REFUNDED. With no Aurora key configured the same calls go to NEAR Intents 1Click directly.
 */
const AURORA_KEY = ((import.meta.env.VITE_AURORA_KEY as string | undefined) ?? "").trim();
const AURORA = "https://intents-api.aurora.dev/api";
const ONECLICK = "https://1click.chaindefuser.com/v0";

const url = (path: "tokens" | "quote" | "deposit/submit" | "status", query = "") =>
  AURORA_KEY ? `${AURORA}/${path}/${AURORA_KEY}${query}` : `${ONECLICK}/${path}${query}`;

export const SOL_ASSET = "nep141:sol.omft.near";

export interface Token {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  price: number;
  contractAddress?: string;
}

/** EVM chains the reader can pay from with one click in their browser wallet. */
export const EVM: Record<string, { id: number; name: string; explorer: string }> = {
  base: { id: 8453, name: "Base", explorer: "https://basescan.org/tx/" },
  arb: { id: 42161, name: "Arbitrum", explorer: "https://arbiscan.io/tx/" },
  eth: { id: 1, name: "Ethereum", explorer: "https://etherscan.io/tx/" },
  bsc: { id: 56, name: "BNB Chain", explorer: "https://bscscan.com/tx/" },
  op: { id: 10, name: "Optimism", explorer: "https://optimistic.etherscan.io/tx/" },
  pol: { id: 137, name: "Polygon", explorer: "https://polygonscan.com/tx/" },
};
/** Other chains: the reader sends from any wallet to the deposit address and gives a refund address there. */
export const OTHER: Record<string, string> = { btc: "Bitcoin", tron: "Tron", ton: "TON", sui: "Sui", doge: "Dogecoin", xrp: "XRP", ltc: "Litecoin", near: "NEAR" };
const SYMBOLS = new Set(["USDC", "USDT", "ETH", "BNB", "POL", "BTC", "TRX", "TON", "SUI", "DOGE", "XRP", "LTC", "NEAR", "wNEAR"]);

export const chainName = (b: string) => EVM[b]?.name ?? OTHER[b] ?? b;

let tokensCache: Promise<Token[]> | null = null;
/** What the reader can pay with: stablecoins and native coins on the chains above, priced in USD. */
export function sources(): Promise<Token[]> {
  tokensCache ??= fetch(url("tokens"))
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`tokens ${r.status}`))))
    .then((list: Token[]) => {
      const order = [...Object.keys(EVM), ...Object.keys(OTHER)];
      return list
        .filter((t) => (EVM[t.blockchain] || OTHER[t.blockchain]) && SYMBOLS.has(t.symbol) && t.price > 0)
        .sort((a, b) => order.indexOf(a.blockchain) - order.indexOf(b.blockchain) || a.symbol.localeCompare(b.symbol));
    })
    .catch((e) => {
      tokensCache = null;
      throw e;
    });
  return tokensCache;
}

export interface IntentQuote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd?: string;
  amountInUsd?: string;
  timeEstimate?: number;
  deadline?: string;
}

/** A quote for `amount` (atomic units of `from`) into SOL for `recipient`; refunds go to `refundTo` on the origin chain. */
export async function quoteSol(from: Token, amount: bigint, recipient: string, refundTo: string, dry: boolean): Promise<IntentQuote> {
  const body = {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: from.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: SOL_ASSET,
    amount: amount.toString(),
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    referral: "zooai",
    quoteWaitingTimeMs: 3000,
  };
  const r = await fetch(url("quote"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { quote?: IntentQuote; message?: string };
  if (!r.ok || !j.quote) throw new Error(friendly(j.message ?? `quote failed (${r.status})`));
  return j.quote;
}

/** Tells the solver network the deposit is on its way, so it does not wait to notice it. Best effort. */
export async function submitDeposit(txHash: string, depositAddress: string): Promise<void> {
  await fetch(url("deposit/submit"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash, depositAddress }) }).catch(() => null);
}

export type IntentStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";
export interface StatusReply {
  status: IntentStatus;
  swapDetails?: { amountOutFormatted?: string; amountOut?: string; destinationChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>; refundedAmountFormatted?: string };
}
export async function status(depositAddress: string): Promise<StatusReply> {
  const r = await fetch(url("status", `?depositAddress=${encodeURIComponent(depositAddress)}`));
  if (!r.ok) throw new Error(`status ${r.status}`);
  return (await r.json()) as StatusReply;
}

function friendly(m: string): string {
  const low = /too low.*?(\d+)/i.exec(m);
  if (low) return "That amount is below the bridge minimum: try a bit more (about $1 or above).";
  return m;
}

/** Amount typed by the reader -> atomic units, without float drift on 18-decimal tokens. */
export function toAtomic(v: string, decimals: number): bigint {
  const [i, f = ""] = v.trim().split(".");
  if (!/^\d*$/.test(i) || !/^\d*$/.test(f)) return 0n;
  return BigInt((i || "0") + (f + "0".repeat(decimals)).slice(0, decimals));
}

// ---- the reader's EVM wallet (MetaMask, Rabby, Coinbase, Phantom's EVM side), no library ----

interface Eip1193 {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
}
export function evmProvider(): Eip1193 | null {
  const w = window as unknown as { ethereum?: Eip1193; phantom?: { ethereum?: Eip1193 } };
  return w.ethereum ?? w.phantom?.ethereum ?? null;
}

export async function evmConnect(): Promise<string> {
  const p = evmProvider();
  if (!p) throw new Error("No EVM wallet found: install MetaMask, Rabby or Phantom, or send from any wallet with the address option.");
  const [a] = (await p.request({ method: "eth_requestAccounts" })) as string[];
  return a;
}

/** Sends `amount` of `token` to `to` on the token's chain from the connected EVM wallet; returns the tx hash. */
export async function evmSend(from: string, token: Token, to: string, amount: bigint): Promise<string> {
  const p = evmProvider();
  const chain = EVM[token.blockchain];
  if (!p || !chain) throw new Error("not an EVM source");
  const hexId = "0x" + chain.id.toString(16);
  if ((await p.request({ method: "eth_chainId" })) !== hexId) {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] }).catch(() => {
      throw new Error(`Switch your wallet to ${chain.name} and try again.`);
    });
  }
  const native = !token.contractAddress;
  const tx = native
    ? { from, to, value: "0x" + amount.toString(16) }
    : {
        from,
        to: token.contractAddress,
        value: "0x0",
        // ERC-20 transfer(address,uint256)
        data: "0xa9059cbb" + to.toLowerCase().replace(/^0x/, "").padStart(64, "0") + amount.toString(16).padStart(64, "0"),
      };
  return (await p.request({ method: "eth_sendTransaction", params: [tx] })) as string;
}

export const usingAurora = () => AURORA_KEY.length > 0;
