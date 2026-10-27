import { existsSync, readFileSync } from "node:fs";

/**
 * Who a wallet is said to be, from outside the chain: the KOLs on Kolscan's leaderboard (their wallets and X handles,
 * read from the page every six hours) and the smart-money wallets the operator keeps in a file next to the node's
 * data (never in the repository). A KOL or a smart wallet in the first seconds is worth knowing, not a risk in itself.
 */

export interface KolLabel {
  name: string;
  x: string | null;
}
export interface SmartLabel {
  name?: string;
  pnlSol?: number;
  winrate?: number;
  closed?: number;
}

const KOLSCAN = "https://kolscan.io/leaderboard";
const B58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

/** Kolscan's page carries its rows as escaped JSON: each wallet, the name and the X link written just before it. */
export function parseKolscan(html: string): Map<string, KolLabel> {
  const text = html.replace(/\\"/g, '"');
  const out = new Map<string, KolLabel>();
  const re = /"(?:address|wallet|walletAddress|wallet_address)":"([1-9A-HJ-NP-Za-km-z]{32,44})"/g;
  for (const m of text.matchAll(re)) {
    const wallet = m[1]!;
    if (out.has(wallet)) continue;
    const back = text.slice(Math.max(0, m.index! - 600), m.index!);
    const names = [...back.matchAll(/"name":"([^"]{1,40})"/g)];
    const xs = [...back.matchAll(/"twitter":"([^"]{0,120})"/g)];
    const name = names.length ? names[names.length - 1]![1]! : null;
    if (!name) continue;
    const x = xs.length ? xs[xs.length - 1]![1] || null : null;
    out.set(wallet, { name, x: x && /^https?:\/\//.test(x) ? x : null });
  }
  return out;
}

export class Labels {
  private kols = new Map<string, KolLabel>();
  private smart = new Map<string, SmartLabel>();
  private timer: ReturnType<typeof setInterval> | null = null;
  kolsAt = 0;

  /** The operator's file: { "smart": [{ "wallet", "name"?, "pnlSol"?, "winrate"?, "closed"? }], "kols"?: [{ "wallet", "name", "x"? }] }. */
  loadFile(path: string): number {
    if (!existsSync(path)) return 0;
    try {
      const d = JSON.parse(readFileSync(path, "utf8")) as { smart?: Array<SmartLabel & { wallet: string }>; kols?: Array<KolLabel & { wallet: string }> };
      for (const s of d.smart ?? []) if (B58.test(s.wallet)) this.smart.set(s.wallet, { ...(s.name ? { name: s.name } : {}), ...(s.pnlSol !== undefined ? { pnlSol: s.pnlSol } : {}), ...(s.winrate !== undefined ? { winrate: s.winrate } : {}), ...(s.closed !== undefined ? { closed: s.closed } : {}) });
      for (const k of d.kols ?? []) if (B58.test(k.wallet) && k.name) this.kols.set(k.wallet, { name: k.name, x: k.x ?? null });
      return this.smart.size + this.kols.size;
    } catch {
      return 0;
    }
  }

  async readKolscan(f: typeof fetch = fetch, now = Date.now()): Promise<number> {
    const r = await f(KOLSCAN, { headers: { "user-agent": "Mozilla/5.0 (zooaiagency.com)" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`kolscan ${r.status}`);
    const found = parseKolscan(await r.text());
    if (!found.size) throw new Error("kolscan: no rows");
    for (const [w, k] of found) this.kols.set(w, k);
    this.kolsAt = now;
    return found.size;
  }

  /** Reads Kolscan now and every six hours; failures are logged and tried again next time. */
  start(log: (m: string) => void = () => {}, everyMs = 6 * 3_600_000): () => void {
    const run = () => void this.readKolscan().then((n) => log(`labels: ${n} KOL wallets from Kolscan, ${this.kols.size} kept, ${this.smart.size} smart wallets`)).catch((e) => log(`labels: kolscan not read (${(e as Error).message?.slice(0, 80)})`));
    run();
    this.timer = setInterval(run, everyMs);
    this.timer.unref?.();
    return () => {
      if (this.timer) clearInterval(this.timer);
    };
  }

  kol(wallet: string): KolLabel | null {
    return this.kols.get(wallet) ?? null;
  }
  smartOf(wallet: string): SmartLabel | null {
    return this.smart.get(wallet) ?? null;
  }
  counts(): { kols: number; smart: number } {
    return { kols: this.kols.size, smart: this.smart.size };
  }
}

/** The one set of labels per node process. */
export const labels = new Labels();
