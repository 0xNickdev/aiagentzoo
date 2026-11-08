/**
 * Evasion set: one hand buying a launch in ways built to slip past the bundle rules, played through the tape and the
 * check. Prints what each scenario gets. A scenario that should be caught and passes is a hole. "tape" rows have no
 * funding read: what a plain check (no ?holders=1) sees. The others trace the biggest buyers' funding as the X-Ray does.
 *   node --disable-warning=ExperimentalWarning scripts/evasion/run.ts
 */
import { PumpTape } from "../../src/chain/pump.ts";
import { checkToken } from "../../src/chain/check.ts";
import { traceHand } from "../../src/chain/hand.ts";

const BINANCE = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
/** How the hand's wallets got their SOL: a funder map, wallet to who paid it. */
type Funding = "none" | "one" | "tree3" | "exchange" | "dev";

const SLOT_MS = 400;
type Buy = { wallet: string; slot: number; tokens: number; sol?: number };
type Scenario = { name: string; hand: boolean; funding?: Funding; buys: (launch: number) => Buy[]; sells?: (launch: number) => Buy[] };

const w = (p: string, i: number) => `${p}${String(i).padStart(3, "0")}${"1".repeat(40 - p.length)}`;
// A crowd around every scenario: 40 real buyers over 30 minutes, 0.2-0.8% each, one to a block.
const crowd = (launch: number): Buy[] => Array.from({ length: 40 }, (_, i) => ({ wallet: w("Crowd", i), slot: launch + 300 + i * 110, tokens: 2_000_000 + ((i * 37) % 7) * 1_000_000 }));
// The hand takes 40% of the supply across 12 wallets, sizes jittered so they do not match.
const hand = (n = 12, share = 0.4) => Array.from({ length: n }, (_, i) => Math.round((share * 1e9 / n) * (0.8 + ((i * 7) % 5) / 10)));

const scenarios: Scenario[] = [
  { name: "control: crowd only", hand: false, buys: () => [] },
  { name: "classic: 12 wallets in the launch block", hand: true, buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l, tokens: t })) },
  { name: "3 a block over 4 blocks at launch", hand: true, buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 2 + Math.floor(i / 3), tokens: t })) },
  { name: "1 a block, first 12 blocks (~5s)", hand: true, buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 1 + i, tokens: t })) },
  { name: "1 every 10 blocks (~48s)", hand: true, buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 15 + i * 10, tokens: t })) },
  { name: "1 every 50 blocks (~4 min)", hand: true, buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 15 + i * 50, tokens: t })) },
  { name: "3 a block every 30 blocks after minute one", hand: true, buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 200 + Math.floor(i / 3) * 30, tokens: t })) },
  { name: "30 small wallets 1 every 5 blocks", hand: true, buys: (l) => hand(30).map((t, i) => ({ wallet: w("Hand", i), slot: l + 15 + i * 5, tokens: t })) },
  {
    name: "1 every 10 blocks, then dumps into the crowd",
    hand: true,
    buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 15 + i * 10, tokens: t })),
    sells: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 4000 + i * 3, tokens: t })),
  },
  { name: "1 every 10 blocks, paid by one wallet", hand: true, funding: "one", buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 15 + i * 10, tokens: t })) },
  { name: "1 every 50 blocks, paid 4 hops back (tree)", hand: true, funding: "tree3", buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 15 + i * 50, tokens: t })) },
  { name: "1 every 50 blocks, paid by the dev 2 hops back", hand: true, funding: "dev", buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 15 + i * 50, tokens: t })) },
  {
    name: "1 every 10 blocks, one wallet, then dumps",
    hand: true,
    funding: "one",
    buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 15 + i * 10, tokens: t })),
    sells: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 4000 + i * 3, tokens: t })),
  },
  { name: "1 every 50 blocks, each from an exchange", hand: true, funding: "exchange", buys: (l) => hand().map((t, i) => ({ wallet: w("Hand", i), slot: l + 15 + i * 50, tokens: t })) },
  { name: "control: crowd, all from one exchange", hand: false, funding: "exchange", buys: () => [] },
];

/** Who paid each wallet in a scenario. The crowd has its own funders, or the exchange in the exchange case. */
function funderMap(kind: Funding, creator: string): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < 40; i++) m.set(w("Crowd", i), kind === "exchange" ? BINANCE : w("Pay", i));
  for (let i = 0; i < 30; i++) {
    const h = w("Hand", i);
    if (kind === "one") m.set(h, w("Boss", 0));
    if (kind === "exchange") m.set(h, BINANCE);
    if (kind === "dev") (m.set(h, w("Mid", i % 3)), m.set(w("Mid", i % 3), creator));
    if (kind === "tree3") {
      // root -> 2 -> 4 -> the buyers: no two buyers share a direct funder past pairs.
      const a = w("Lv1", i % 2), b = w("Lv2", i % 4), c = w("Lv3", i % 6);
      m.set(h, c), m.set(c, b), m.set(b, a), m.set(a, w("Root", 0));
    }
  }
  return m;
}

const results: Array<{ name: string; hand: boolean; funded: boolean; verdict: string; score: number | null; why: string }> = [];
for (const [k, s] of scenarios.entries()) {
  const tape = new PumpTape();
  const mint = `Evas${String(k).padStart(2, "0")}${"1".repeat(37)}`;
  const creator = w("Dev", k);
  const launch = 1_000;
  const born = 1_800_000_000_000;
  const at = (slot: number) => born + (slot - launch) * SLOT_MS;
  tape.apply({ kind: "create", name: "E", symbol: "E", mint, creator, ts: born }, born, undefined, launch);
  tape.apply({ kind: "trade", mint, sol: 0.5, tokens: 15_000_000, isBuy: true, user: creator, ts: born, curveSol: 0.5 }, born, undefined, launch);
  let curve = 0.5;
  const trades = [...s.buys(launch).map((b) => ({ ...b, buy: true })), ...crowd(launch).map((b) => ({ ...b, buy: true })), ...(s.sells?.(launch) ?? []).map((b) => ({ ...b, buy: false }))].sort((a, b) => a.slot - b.slot);
  for (const t of trades) {
    const sol = t.sol ?? t.tokens / 30_000_000;
    curve = Math.max(0.1, curve + (t.buy ? sol : -sol));
    tape.apply({ kind: "trade", mint, sol, tokens: t.tokens, isBuy: t.buy, user: t.wallet, ts: at(t.slot), curveSol: curve }, at(t.slot), undefined, t.slot);
  }
  const now = at(trades.at(-1)!.slot) + 60_000;
  const found = tape.token(mint)!;
  const pays = funderMap(s.funding ?? "none", creator);
  const handReport = s.funding ? await traceHand(tape.bigBuyersOf(mint), creator, async (x) => pays.get(x) ?? null) : null;
  const c = checkToken(mint, found, { now, hand: handReport });
  results.push({ name: s.name, hand: s.hand, funded: !!s.funding, verdict: c.verdict, score: c.score, why: c.reasons.join(" | ").slice(0, 160) || "-" });
}
for (const r of results) {
  const hole = r.hand && r.verdict === "pass";
  console.log(`${hole ? "HOLE " : "     "}${r.funded ? "      " : "tape  "}${r.name.padEnd(48)} ${r.verdict.padEnd(8)} ${String(r.score ?? "").padStart(3)}  ${r.why}`);
}
