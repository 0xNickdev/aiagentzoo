/**
 * The two chains the zoo reads, told apart by the shape of an address: base58 on Solana, 0x and forty hex digits on
 * BNB Chain. Everything that links out or names a unit asks here.
 */
export type Chain = "solana" | "bsc";

export const chainOf = (address: string): Chain => (/^0x[0-9a-fA-F]{40}$/.test(address) ? "bsc" : "solana");
export const CHAIN_NAME: Record<Chain, string> = { solana: "Solana", bsc: "BNB Chain" };
export const chainName = (address: string) => CHAIN_NAME[chainOf(address)];
/** What the amounts are in on that chain. */
export const unitOf = (address: string) => (chainOf(address) === "bsc" ? "BNB" : "SOL");

/**
 * An address inside whatever was pasted: a bare one, or a four.meme, pump.fun, DexScreener or GMGN link. A 0x address
 * is read first and lowercased (the chain does not care about case); a Solana address is kept as it is.
 */
export const addressIn = (text: string): string | null => text.match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase() ?? text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null;

/** The chain's explorer, for a wallet or token. */
export const explorer = (address: string) => (chainOf(address) === "bsc" ? `https://bscscan.com/address/${address}` : `https://solscan.io/account/${address}`);
export const explorerName = (address: string) => (chainOf(address) === "bsc" ? "BscScan" : "Solscan");
export const explorerTx = (tx: string) => (tx.startsWith("0x") ? `https://bscscan.com/tx/${tx}` : `https://solscan.io/tx/${tx}`);
/** A chart for the token: its launchpad's own page while it is young there, DexScreener otherwise. */
export const chart = (mint: string) => (chainOf(mint) === "bsc" ? `https://dexscreener.com/bsc/${mint}` : `https://dexscreener.com/solana/${mint}`);
