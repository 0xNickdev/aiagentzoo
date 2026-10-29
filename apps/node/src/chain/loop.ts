/**
 * The loop: does the money come back? A paymaster funds many fresh dev wallets (lineage sees that incoming leg).
 * This reads the paymaster's own incoming transfers and asks which of those devs sent SOL back to it. Funding out
 * and proceeds in, closing on the same wallet, is one hand running the lot, not a shared service.
 *
 * Needs Helius (the enhanced transactions API parses native transfers for us). Bounded: a few pages per call, on
 * demand only, never in a background loop, so it costs what one lookup costs.
 */

const RPC = process.env.SOLANA_RPC_URL ?? "";
const KEY = process.env.HELIUS_API_KEY || (/api-key=([^&]+)/.exec(RPC)?.[1] ?? "");
export const loopEnabled = () => KEY !== "";

const LAMPORTS = 1_000_000_000;
/** Ignore dust: a real pay-back is at least this much SOL. */
const MIN_SOL = 0.02;

interface EnhancedTx {
  nativeTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; amount?: number }>;
}

async function pageOf(address: string, before: string | undefined, f: typeof fetch): Promise<EnhancedTx[] | null> {
  const u = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${KEY}&limit=100${before ? `&before=${before}` : ""}`;
  try {
    const r = await f(u, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    return (await r.json()) as EnhancedTx[];
  } catch {
    return null;
  }
}

export interface Loop {
  funder: string;
  devs: number;
  /** Devs that sent SOL back to the funder, and the total that came back. */
  paidBack: Array<{ wallet: string; sol: number }>;
  backSol: number;
  /** How closed the ring is: share of funded devs that returned money. 0..1. */
  closed: number;
  pages: number;
}

/**
 * Reads the funder's incoming native transfers (a few pages) and keeps the ones from wallets it funded.
 * `devs` is the set of creators the lineage already saw this wallet fund.
 */
export async function loopOf(funder: string, devs: Set<string>, f: typeof fetch = fetch, maxPages = 4): Promise<Loop | null> {
  if (!loopEnabled() || !devs.size) return null;
  const back = new Map<string, number>();
  let before: string | undefined;
  let pages = 0;
  for (; pages < maxPages; pages++) {
    const txs = await pageOf(funder, before, f);
    if (!txs || !txs.length) break;
    for (const tx of txs) {
      for (const t of tx.nativeTransfers ?? []) {
        if (t.toUserAccount !== funder) continue;
        const from = t.fromUserAccount;
        if (!from || !devs.has(from)) continue;
        const sol = (t.amount ?? 0) / LAMPORTS;
        if (sol < MIN_SOL) continue;
        back.set(from, (back.get(from) ?? 0) + sol);
      }
    }
    const last = txs[txs.length - 1] as { signature?: string } | undefined;
    before = last?.signature;
    if (!before) break;
  }
  const paidBack = [...back.entries()].map(([wallet, sol]) => ({ wallet, sol: Math.round(sol * 1000) / 1000 })).sort((a, b) => b.sol - a.sol);
  const backSol = Math.round(paidBack.reduce((n, p) => n + p.sol, 0) * 1000) / 1000;
  return { funder, devs: devs.size, paidBack, backSol, closed: Math.round((paidBack.length / devs.size) * 100) / 100, pages };
}
