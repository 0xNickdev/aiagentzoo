import { exchangeOf, launcherOf } from "./exchanges.ts";

/**
 * What a wallet is, in one word each, the way traders read labels on a terminal: who it is across every launch the
 * zoo has seen, not only on this one. Several can be true at once; they are given in order of how much they matter.
 */
export type WalletTag = "crew" | "rugger" | "ring" | "serial" | "bundle" | "whale" | "dev" | "exchange" | "new" | "kol" | "smart";

export const TAGS: Record<WalletTag, string> = {
  crew: "the creator's own wallet: snipes this creator's other launches too",
  rugger: "launched tokens before and dumped most of them",
  ring: "has sniped launches together with other wallets here: one operator",
  serial: "buys launches in the first seconds to sell to whoever comes next",
  bundle: "bought in the block the token was created in, or bundles launches as a habit",
  whale: "took two percent of the supply or more",
  dev: "has launched tokens before",
  exchange: "an exchange or a launcher's wallet: it is everyone's, so it ties no one together",
  new: "never seen by the zoo before this launch",
  kol: "a KOL's wallet, as Kolscan lists it",
  smart: "a smart-money wallet: a trader with a record of winning",
};

/** A first-second or launch-block wallet as the tape reports it. */
export interface TaggedWallet {
  wallet: string;
  /** Share of the supply it took, 0..1. */
  bought?: number;
  share?: number;
  bundle?: boolean;
  snipes48h?: number;
  crew?: boolean;
  ring?: boolean;
  serial?: boolean;
}

/** The long memory's count of a wallet's roles over 90 days, when it has one. */
export interface KeptWallet {
  launches: number;
  dumped: number;
  snipes: number;
  crewHits: number;
  bundleHits: number;
  serial: boolean;
}

/** A whale took at least this share of the supply. */
export const WHALE_SHARE = 0.02;

export function tagsOf(w: TaggedWallet, kept: KeptWallet | null | undefined): WalletTag[] {
  const out: WalletTag[] = [];
  const took = w.bought ?? w.share ?? 0;
  if (w.crew || (kept?.crewHits ?? 0) >= 2) out.push("crew");
  if (kept && kept.launches >= 1 && kept.dumped >= 1 && kept.dumped / kept.launches >= 0.5) out.push("rugger");
  if (w.ring) out.push("ring");
  if (w.serial || kept?.serial || (kept?.snipes ?? 0) >= 10) out.push("serial");
  if (w.bundle || (kept?.bundleHits ?? 0) >= 3) out.push("bundle");
  if (took >= WHALE_SHARE) out.push("whale");
  if (kept && kept.launches >= 1 && !out.includes("rugger")) out.push("dev");
  if (exchangeOf(w.wallet) || launcherOf(w.wallet)) out.push("exchange");
  if (!kept && (w.snipes48h ?? 0) <= 1 && !out.length) out.push("new");
  return out;
}

/** The tags of a list of wallets, each looked up once in the long memory. */
export function tagAll<T extends TaggedWallet>(list: T[], kept: (wallet: string) => KeptWallet | null | undefined): Array<T & { tags: WalletTag[] }> {
  return list.map((w) => ({ ...w, tags: tagsOf(w, kept(w.wallet)) }));
}
