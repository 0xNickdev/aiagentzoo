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

/**
 * Launchpads that pay for every creator wallet they launch through, so, like an exchange, the funder ties no one
 * together. ClawPump's launcher: the wallet behind the creators of $ZOOAGENCY, ORACLE, VERA and the rest of its launches.
 */
const LAUNCHERS: Record<string, string> = {
  "49CfXAr58cCTGJnYsbm16fEsE5JRpdR8QQP8E1ZinGCq": "ClawPump",
};

/** The launchpad a wallet is the launcher of, when it is a known one. */
export function launcherOf(wallet: string | null | undefined): string | null {
  return wallet ? (LAUNCHERS[wallet] ?? null) : null;
}

/**
 * Launchpads that create every coin from one wallet of their own, so that wallet's record (hundreds of launches a day)
 * is the platform's, not a person's. "Launch" on Raydium LaunchLab.
 */
const DEPLOYERS: Record<string, string> = {
  HgKfkiGWeToDfhMBjfniZvg2KhHhyw6CdqWQtz6mxVdk: "Launch",
};

/** The launchpad a creator wallet deploys for, when it is a known one. */
export function deployerOf(wallet: string | null | undefined): string | null {
  return wallet ? (DEPLOYERS[wallet] ?? null) : null;
}
