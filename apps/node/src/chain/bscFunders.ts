import type { LineageView } from "./lineage.ts";
import type { PumpTape } from "./pump.ts";

/**
 * Who paid for a four.meme creator. BNB Chain has no "transactions of an address" call on a plain node, so this reads
 * BscScan (the Etherscan API, chain 56): the creator's first incoming BNB is its funder; the funder's own recent
 * transfers say who else it paid for, and the tape says which of those launched and dumped. A free key allows five
 * calls a second; a creator costs two. Nothing happens without a key.
 */

const API = "https://api.etherscan.io/v2/api";
const MORALIS = "https://deep-index.moralis.io/api/v2.2";
/** Either key traces: Moralis's free tier covers BNB Chain, Etherscan's covers it on a paid plan only. */
export const bscFundersEnabled = () => Boolean(process.env.MORALIS_API_KEY || process.env.BSCSCAN_API_KEY);
export type FunderKeys = { moralis?: string; etherscan?: string };
export const bscFunderKeys = (): FunderKeys | undefined => (process.env.MORALIS_API_KEY || process.env.BSCSCAN_API_KEY ? { moralis: process.env.MORALIS_API_KEY, etherscan: process.env.BSCSCAN_API_KEY } : undefined);
const KEEP_MS = 6 * 3_600_000;
/** A funder that moved this many transactions in a day is an exchange or a router, not a person. */
const HOT_PER_DAY = 1_000;
const WEI = 1e18;

/** Binance's BNB Chain hot wallets, as labelled on BscScan. Withdrawals from them tie no one together. */
export const BSC_EXCHANGES: Record<string, string> = {
  "0x8894e0a0c962cb723c1976a4421c95949be2d4e3": "Binance",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance",
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
  "0x9696f59e4d72e237be84ffd425dcad154bf96976": "Binance",
  "0x4976a4a02f38326660d17bf34b431dc6e2eb2327": "Binance",
  "0x5a52e96bacdabb82fd05763e25335261b270efcb": "Binance",
  "0x3c783c21a0383057d128bae431894a5c19f9cf06": "Binance",
  "0xe2fc31f816a9b94326492132018c3aecc4a93ae1": "Binance",
};
export const bscExchangeOf = (wallet: string): string | null => BSC_EXCHANGES[wallet.toLowerCase()] ?? null;

interface Tx {
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  hash: string;
  isError?: string;
}

type Fetch = typeof fetch;

async function txlist(address: string, sort: "asc" | "desc", offset: number, keys: FunderKeys, f: Fetch): Promise<Tx[] | null> {
  if (keys.moralis) {
    const url = `${MORALIS}/${address}?chain=bsc&order=${sort.toUpperCase()}&limit=${Math.min(offset, 100)}`;
    const r = await f(url, { headers: { "X-API-Key": keys.moralis, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const body = (await r.json()) as { result?: Array<{ from_address: string; to_address: string | null; value: string; block_timestamp: string; hash: string; receipt_status?: string }> };
    if (!Array.isArray(body.result)) return null;
    return body.result.map((t) => ({ from: t.from_address, to: t.to_address ?? "", value: t.value, timeStamp: String(Math.floor(new Date(t.block_timestamp).getTime() / 1000)), hash: t.hash, isError: t.receipt_status === "0" ? "1" : "0" }));
  }
  const url = `${API}?chainid=56&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${offset}&sort=${sort}&apikey=${keys.etherscan}`;
  const r = await f(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const body = (await r.json()) as { status?: string; message?: string; result?: Tx[] | string };
  if (Array.isArray(body.result)) return body.result;
  // "No transactions found" comes back as status 0 with an empty list or a message: an answer, not a failure.
  if (body.message && /no transactions/i.test(body.message)) return [];
  return null;
}

export interface BscTrace {
  funder: string | null;
  hot: boolean;
  /** Wallets the funder sent BNB to, besides the creator. */
  paid: string[];
  at: number;
}

export class BscLineage {
  private readonly traces = new Map<string, BscTrace>();
  private readonly queue: string[] = [];
  private running = false;
  private readonly tape: PumpTape;
  private readonly f: Fetch;
  private readonly keyOf: () => FunderKeys | undefined;

  constructor(tape: PumpTape, f: Fetch = fetch, keyOf: () => FunderKeys | undefined = bscFunderKeys) {
    this.tape = tape;
    this.f = f;
    this.keyOf = keyOf;
  }

  /** The traced view of a creator, as the Solana lineage gives it; undefined when not traced yet. */
  view(creator: string, now = Date.now()): LineageView | undefined {
    const t = this.traces.get(creator.toLowerCase());
    if (!t || now - t.at > KEEP_MS) return undefined;
    const funder = t.funder;
    const label = funder ? bscExchangeOf(funder) : null;
    const hot = t.hot || label !== null;
    const siblings: LineageView["siblings"] = [];
    if (funder && !hot) {
      for (const w of t.paid) {
        if (w === creator.toLowerCase()) continue;
        const rec = this.tape.creator(w, now);
        if (rec) siblings.push({ wallet: w, launches48h: rec.launches48h, dumped: rec.dumped });
      }
    }
    return {
      creator: creator.toLowerCase(),
      funder,
      funderIsHot: hot,
      funderLabel: label,
      funderService: null,
      siblings,
      siblingLaunches48h: siblings.reduce((n, s) => n + s.launches48h, 0),
      siblingDumped48h: siblings.reduce((n, s) => n + s.dumped, 0),
      tracedAt: t.at,
    };
  }

  /** Traces now: two calls to BscScan. Null when there is no key or BscScan did not answer. */
  async trace(creator: string, now = Date.now()): Promise<LineageView | null> {
    const keys = this.keyOf();
    if (!keys) return null;
    const w = creator.toLowerCase();
    const kept = this.view(w, now);
    if (kept) return kept;
    const first = await txlist(w, "asc", 25, keys, this.f);
    if (!first) return null;
    const incoming = first.find((tx) => tx.to.toLowerCase() === w && tx.from.toLowerCase() !== w && Number(tx.value) / WEI > 0 && tx.isError !== "1");
    const funder = incoming ? incoming.from.toLowerCase() : null;
    let hot = false;
    const paid: string[] = [];
    if (funder && !bscExchangeOf(funder)) {
      // Moralis hands out a hundred a page: a funder with a hundred transactions in a day is busy enough to be a service.
      const page = keys.moralis ? 100 : HOT_PER_DAY;
      const recent = await txlist(funder, "desc", page, keys, this.f);
      if (recent) {
        const day = recent.filter((tx) => now / 1000 - Number(tx.timeStamp) < 86_400).length;
        hot = day >= page;
        if (!hot) for (const tx of recent) if (tx.from.toLowerCase() === funder && Number(tx.value) / WEI > 0 && tx.to && !paid.includes(tx.to.toLowerCase())) paid.push(tx.to.toLowerCase());
      }
    }
    this.traces.set(w, { funder, hot, paid: paid.slice(0, 200), at: now });
    if (this.traces.size > 20_000) this.traces.delete(this.traces.keys().next().value!);
    return this.view(w, now) ?? null;
  }

  /** Traced in the background, one creator at a time, so the five calls a second are never reached. */
  enqueue(creator: string): void {
    if (!this.keyOf()) return;
    const w = creator.toLowerCase();
    if (this.traces.has(w) || this.queue.includes(w)) return;
    this.queue.push(w);
    if (this.queue.length > 2_000) this.queue.shift();
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const w = this.queue.shift()!;
        await this.trace(w).catch(() => null);
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      this.running = false;
    }
  }

  /** The wallet that paid for a creator, for the long memory's record. */
  funderOf(creator: string): string | null | undefined {
    return this.traces.get(creator.toLowerCase())?.funder;
  }
}
