import { readFileSync } from "node:fs";

/**
 * Known exchange hot wallets on Solana, from public explorer labels and the exchanges' own address lists (each entry
 * carries its sources in exchanges.json). A funder found here is named: "funded from Binance" says which exchange the
 * money left, never who the person is.
 */
interface Entry {
  address: string;
  exchange: string;
  label?: string;
}

let byAddress: Map<string, Entry> | null = null;

function load(): Map<string, Entry> {
  if (byAddress) return byAddress;
  byAddress = new Map();
  try {
    const raw = JSON.parse(readFileSync(new URL("./exchanges.json", import.meta.url), "utf8")) as { addresses?: Entry[] };
    for (const e of raw.addresses ?? []) if (e.address && e.exchange) byAddress.set(e.address, e);
  } catch {
    /* no list: every funder stays unnamed */
  }
  return byAddress;
}

/** The exchange a wallet belongs to, when it is a known hot wallet. */
export function exchangeOf(wallet: string | null | undefined): string | null {
  return wallet ? (load().get(wallet)?.exchange ?? null) : null;
}

export const exchangeCount = () => load().size;
