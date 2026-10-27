/**
 * The three chains the zoo reads, told apart by the shape of an address and by what the node said: base58 is Solana;
 * 0x and forty hex digits is BNB Chain or Base, and the shape alone cannot say which. Every answer from the node names
 * its chain, and every 0x address inside it is remembered under that chain, so links and units read right. A 0x
 * address nobody has named is taken as BNB Chain, the first EVM chain the zoo read. Everything that links out or
 * names a unit asks here.
 */
export type Chain = "solana" | "bsc" | "base";
type Evm = "bsc" | "base";

export const isEvm = (address: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(address);
const known = new Map<string, Evm>();
const isEvmChain = (c: unknown): c is Evm => c === "bsc" || c === "base";

/** One 0x address on one chain, as the node said. */
export function rememberChain(address: string, chain: unknown): void {
  if (isEvm(address) && isEvmChain(chain)) known.set(address.toLowerCase(), chain);
}

/**
 * Every 0x address inside an answer from the node is on the answer's chain. An answer without a chain of its own
 * (a list of cabals, say) is walked for the parts that name one.
 */
export function rememberChains(body: unknown, chain?: unknown, depth = 0): void {
  if (!body || typeof body !== "object" || depth > 8) return;
  const own = chain ?? (body as { chain?: unknown }).chain;
  if (isEvmChain(own)) return walk(body, own, depth);
  for (const v of Array.isArray(body) ? body : Object.values(body)) rememberChains(v, undefined, depth + 1);
}
function walk(v: unknown, c: Evm, depth: number): void {
  if (depth > 10 || v === null || v === undefined) return;
  if (typeof v === "string") {
    if (isEvm(v)) known.set(v.toLowerCase(), c);
    return;
  }
  if (typeof v !== "object") return;
  for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, c, depth + 1);
}

export const chainOf = (address: string): Chain => (isEvm(address) ? (known.get(address.toLowerCase()) ?? "bsc") : "solana");
export const CHAIN_NAME: Record<Chain, string> = { solana: "Solana", bsc: "BNB Chain", base: "Base" };
export const chainName = (address: string) => CHAIN_NAME[chainOf(address)];
/** What the amounts are in on that chain. */
const UNIT: Record<Chain, string> = { solana: "SOL", bsc: "BNB", base: "ETH" };
export const unitOf = (address: string) => UNIT[chainOf(address)];
/** The launchpad the zoo reads on that chain. */
const VENUE_OF_CHAIN: Record<Chain, string> = { solana: "pump.fun", bsc: "four.meme", base: "Clanker" };
export const venueOfChain = (address: string) => VENUE_OF_CHAIN[chainOf(address)];
/** `?chain=` for a request about a 0x address whose chain this page already knows; nothing for Solana. */
export const chainQuery = (address: string) => (isEvm(address) && known.has(address.toLowerCase()) ? `?chain=${known.get(address.toLowerCase())}` : "");

/**
 * An address inside whatever was pasted: a bare one, or a four.meme, clanker.world, pump.fun, DexScreener or GMGN link.
 * A 0x address is read first and lowercased (the chain does not care about case); a Solana address is kept as it is.
 * A link that names its chain (dexscreener.com/base/…, gmgn.ai/base/…, clanker.world) names the address's chain too.
 */
export const addressIn = (text: string): string | null => {
  const evm = text.match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase() ?? null;
  if (evm) {
    if (/clanker\.world|\/base\/|chainId=8453|basescan\.org/i.test(text)) rememberChain(evm, "base");
    else if (/four\.meme|\/bsc\/|chainId=56|bscscan\.com/i.test(text)) rememberChain(evm, "bsc");
    return evm;
  }
  return text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null;
};

const EXPLORER: Record<Chain, { name: string; host: string }> = { solana: { name: "Solscan", host: "https://solscan.io" }, bsc: { name: "BscScan", host: "https://bscscan.com" }, base: { name: "BaseScan", host: "https://basescan.org" } };
/** The chain's explorer, for a wallet or token. */
export const explorer = (address: string) => (chainOf(address) === "solana" ? `https://solscan.io/account/${address}` : `${EXPLORER[chainOf(address)].host}/address/${address}`);
export const explorerName = (address: string) => EXPLORER[chainOf(address)].name;
/** A transaction's page; a 0x hash looks the same on both EVM chains, so an address near it (its token) says which. */
export const explorerTx = (tx: string, near?: string) => (tx.startsWith("0x") ? `${EXPLORER[near ? chainOf(near) : "bsc"].host}/tx/${tx}` : `https://solscan.io/tx/${tx}`);
const DEX: Record<Chain, string> = { solana: "solana", bsc: "bsc", base: "base" };
/** A chart for the token on DexScreener. */
export const chart = (mint: string) => `https://dexscreener.com/${DEX[chainOf(mint)]}/${mint}`;
