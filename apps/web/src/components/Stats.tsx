import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Btn, Page, Panel, Tile } from "./site/Panel";
import { t } from "../i18n";
import { num, short } from "../format";
import { useLive } from "../hooks";
import { SOLSCAN_URL, ZOOAGENCY_CLAWPUMP_URL } from "../links";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const pctOf = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "-");

interface Day {
  day: string;
  xrays: number;
  checks: number;
  users: number;
}
interface Usage {
  days: Day[];
  last7: { xrays: number; checks: number; users: number };
}
interface Chain {
  live: boolean;
  tracked: number;
  seen: { launches: number; trades: number; launchlab?: number; dbc?: number };
  perMinute: { launches: number; trades: number };
}
interface Side {
  n: number;
  dead: number;
  alive: number;
  unknown: number;
  /** Read, between the dead and alive lines. Older nodes only send unknown. */
  between?: number;
  /** No curve or pool reading: left out of the table. */
  unread?: number;
}
/** The table asks one thing, dead or not: everything read that did not die is still trading. */
const tally = (s: Side) => {
  const n = s.n - (s.unread ?? 0);
  return { n, dead: s.dead, trading: n - s.dead };
};
interface CheckRecord {
  window: string;
  flaggedAvoid: Side;
  notFlagged: Side;
}
const LINK = "underline decoration-line-2 underline-offset-4 hover:text-white";

/** One measure by day as bars: a value over each, the day under it, today marked as still counting. */
function Bars({ title, note, days, pick }: { title: string; note: string; days: Day[]; pick: (d: Day) => number }) {
  const max = Math.max(1, ...days.map(pick));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Panel title={t(title)} meta={t(note)} className="lg:col-span-6">
      {days.length ? (
        <>
          <div className="flex h-44 items-end gap-1 border-b border-line sm:gap-2">
            {days.map((d) => {
              const v = pick(d);
              return (
                <div key={d.day} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${d.day}: ${num(v)}`}>
                  <span className="mb-1 text-[10.5px] text-dim sm:text-[11.5px]">{num(v)}</span>
                  <div className={`w-full max-w-[48px] rounded-t-[3px] transition ${d.day === today ? "bg-moss-edge" : "bg-[#5d6b63]"} group-hover:bg-moss`} style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-1 sm:gap-2">
            {days.map((d) => (
              <span key={d.day} className="min-w-0 flex-1 truncate text-center text-[10.5px] text-faint sm:text-[11.5px]">
                {d.day === today ? t("today") : d.day.slice(8)}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="py-12 text-center text-[12.5px] text-faint">{t("Loading…")}</p>
      )}
    </Panel>
  );
}

/** Our own numbers, live from its public endpoints, with what each one does and does not count. */
export default function Stats() {
  const usage = useLive<Usage>(`${NORTH}/v1/usage`, 60_000);
  const chain = useLive<Chain>(`${NORTH}/v1/chain`, 60_000);
  const record = useLive<CheckRecord>(`${NORTH}/v1/check/record`, 60_000);
  // The counter started on 19 October: days before it are not zero, they were not counted.
  const days = (usage?.days ?? []).filter((d) => d.day >= "2026-10-19").slice(-14);
  const a = record?.flaggedAvoid;
  const n = record?.notFlagged;

  return (
    <Page
      title={t("Stats")}
      lead={t("How much the X-Ray is used, what the chain stream sees and how our verdicts held up, read from the same public endpoints anyone can open.")}
      side={<span className="flex items-center gap-2 text-[12px] text-dim"><span className="h-1.5 w-1.5 rounded-full bg-moss" />{t("live · refreshed every minute")}</span>}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <section className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-line bg-night-surface lg:col-span-12 lg:grid-cols-4">
          <Tile k={t("full x-rays, 7 days")} v={usage ? num(usage.last7.xrays) : "-"} sub={t("whole reports opened")} className="border-b border-r border-line lg:border-b-0" />
          <Tile k={t("verdict checks, 7 days")} v={usage ? num(usage.last7.checks) : "-"} sub={t("mostly the extension")} className="border-b border-line lg:border-b-0 lg:border-r" />
          <Tile k={t("launches now")} v={chain ? `${chain.perMinute.launches}/min` : "-"} sub={chain ? (chain.live ? t("stream live") : t("stream behind")) : ""} tone={chain && !chain.live ? "warn" : "fg"} className="border-r border-line" />
          <Tile k={t("trades now")} v={chain ? `${num(chain.perMinute.trades)}/min` : "-"} sub={chain ? t("{n} tokens on the tape", { n: num(chain.tracked) }) : ""} />
        </section>

        <Bars title="Full X-Rays by day" note="UTC · today still counting" days={days} pick={(d) => d.xrays} />
        <Bars title="Verdict checks by day" note="includes automatic ones" days={days} pick={(d) => d.checks} />
        <p className="text-[12px] leading-[1.6] text-dim lg:col-span-12">
          {t("A full X-Ray is a person opening the whole report: on the site with a token pasted, in the extension's panel, or in the bot. A verdict check is the short answer; the extension asks for one on every token page and every address on X, and /xray asks for one per example card, so checks run well ahead of people. Callers are counted as hashes, never addresses. Days are UTC.")}
        </p>

        <Panel title={t("How the verdicts held up")} meta={t("launched 24 to 48 hours ago, verdict at 5 minutes")} className="lg:col-span-7" bodyClass="px-3.5 pb-3.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 border-b border-line py-2 text-[11.5px] text-faint sm:grid-cols-[minmax(0,1fr)_5rem_8rem_8rem]">
            <span>{t("at 5 minutes")}</span>
            <span className="hidden text-right sm:block">{t("tokens")}</span>
            <span className="text-right">{t("dead")}</span>
            <span className="text-right">{t("still trading")}</span>
          </div>
          {[
            [t("flagged avoid"), a, "text-danger"],
            [t("not flagged"), n, "text-moss"],
          ].map(([label, s, tone]) => {
            const v = s ? tally(s as Side) : null;
            return (
              <div key={label as string} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 border-b border-line py-2.5 text-[12.5px] sm:grid-cols-[minmax(0,1fr)_5rem_8rem_8rem]">
                <span className={`${tone as string}`}>{label as string}</span>
                <span className="hidden text-right text-fg-2 sm:block">{v ? num(v.n) : "-"}</span>
                <span className="text-right text-fg-2">{v ? <>{num(v.dead)} <span className="text-faint">· {pctOf(v.dead, v.n)}</span></> : "-"}</span>
                <span className="text-right text-fg-2">{v ? <>{num(v.trading)} <span className="text-faint">· {pctOf(v.trading, v.n)}</span></> : "-"}</span>
              </div>
            );
          })}
          <p className="mt-3 text-[12.5px] leading-[1.6] text-fg-2">
            {t("Read it honestly: on pump.fun almost every launch dies within two days, flagged or not. The verdict does not find the survivors: it names the dev who dumps, the snipers and who paid for them. The odds are what rank them: the launches they put in the top tenth climbed past 85 SOL seven times as often as the average one.")}
          </p>
        </Panel>

        {/* Where the token's creator fees go: pump.fun pays them to the creator wallet, so the proof is the buybacks and burns themselves. */}
        <Panel title={t("$ZOOAGENCY creator fees")} meta={t("buybacks and burns")} className="lg:col-span-5">
          <p className="text-[12.5px] leading-[1.6] text-fg-2">
            {t("pump.fun pays a coin's creator fees to the creator wallet, with no split on chain. ClawPump splits ours after that: 61.5% buys $ZOOAGENCY back and burns it. Its page lists every buyback with its transaction and how much has been burned, so the proof is not our word.")}
          </p>
          <Btn href={ZOOAGENCY_CLAWPUMP_URL} className="mt-3.5">
            {t("See the buybacks and burns on ClawPump")} ↗
          </Btn>
        </Panel>

        <FeeLoop />

        <p className="text-[12px] text-faint lg:col-span-12">
          {t("raw:")}{" "}
          {["/v1/usage", "/v1/chain", "/v1/check/record"].map((p, i) => (
            <span key={p}>
              {i > 0 && " · "}
              <a href={`${NORTH}${p}`} className={`font-mono ${LINK}`}>
                {p}
              </a>
            </span>
          ))}
        </p>
      </div>
    </Page>
  );
}


interface BuybackRun { at: number; feesSol: number; buySol: number; sweptSol: number; tokens: number | null; buyTx: string | null; sweepTx: string | null; error?: string }
interface Buybacks { hot: string | null; treasury: string | null; buyShare: number; totals: { feesSol: number; boughtSol: number; sweptSol: number; runs: number }; runs: BuybackRun[] }
const CANYON_URL = NODE_URLS.find((u) => u.includes("canyon")) ?? "";

/** The swap fee loop, run by run: what came in, the tenth that bought $ZOOAGENCY, the rest swept to the treasury. */
function FeeLoop() {
  const [b, setB] = useState<Buybacks | null>(null);
  useEffect(() => {
    if (!CANYON_URL) return;
    fetch(`${CANYON_URL}/v1/buybacks`).then((r) => (r.ok ? r.json() : null)).then((d) => setB(d as Buybacks | null)).catch(() => null);
  }, []);
  if (!b?.hot) return null;
  const sol = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return (
    <Panel title={t("Swap fees")} meta={t("{p}% buys $ZOOAGENCY back, the rest goes to the treasury", { p: Math.round(b.buyShare * 100) })} className="lg:col-span-12">
      <p className="max-w-[80ch] text-[12.5px] leading-[1.6] text-fg-2">
        {t("Every trade in the X-Ray pays its fee in SOL to a hot wallet. Every six hours the node sweeps it: a tenth buys $ZOOAGENCY through Jupiter straight into the treasury, the rest goes to the treasury as SOL. Each run below links both transactions.")}
      </p>
      <div className="mt-3.5 grid grid-cols-2 overflow-hidden rounded-[9px] border border-line sm:grid-cols-4">
        <Tile k={t("fees swept")} v={`${sol(b.totals.feesSol)}`} sub="SOL" className="border-b border-r border-line sm:border-b-0" />
        <Tile k={t("spent on buybacks")} v={`${sol(b.totals.boughtSol)}`} sub="SOL" className="border-b border-line sm:border-b-0 sm:border-r" />
        <Tile k={t("to the treasury")} v={`${sol(b.totals.sweptSol)}`} sub="SOL" className="border-r border-line" />
        <Tile k={t("runs")} v={b.totals.runs} sub={t("every six hours")} />
      </div>
      <p className="mt-3 text-[12px] text-dim">
        {t("hot wallet")} <a href={`${SOLSCAN_URL}/account/${b.hot}`} target="_blank" rel="noopener noreferrer" className={`font-mono ${LINK}`}>{short(b.hot)}</a>
        {b.treasury && <> · {t("treasury")} <a href={`${SOLSCAN_URL}/account/${b.treasury}`} target="_blank" rel="noopener noreferrer" className={`font-mono ${LINK}`}>{short(b.treasury)}</a></>}
      </p>
      {b.runs.length > 0 && (
        <ul className="mt-3 divide-y divide-line border-t border-line text-[12.5px]">
          {b.runs.slice(0, 20).map((r) => (
            <li key={r.at} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2 text-fg-2">
              <span className="text-faint">{new Date(r.at).toISOString().slice(0, 16).replace("T", " ")}</span>
              {r.error ? (
                <span className="text-danger">{t("failed")}: {r.error}</span>
              ) : (
                <>
                  <span>{sol(r.feesSol)} SOL {t("in")}</span>
                  <span className="text-white">{sol(r.buySol)} SOL → {r.tokens ? `${Math.round(r.tokens).toLocaleString("en-US")} ZOOAGENCY` : "ZOOAGENCY"}</span>
                  {r.buyTx && <a href={`${SOLSCAN_URL}/tx/${r.buyTx}`} target="_blank" rel="noopener noreferrer" className={LINK}>{t("buy")} ↗</a>}
                  <span>{sol(r.sweptSol)} SOL {t("to the treasury")}</span>
                  {r.sweepTx && <a href={`${SOLSCAN_URL}/tx/${r.sweepTx}`} target="_blank" rel="noopener noreferrer" className={LINK}>{t("sweep")} ↗</a>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
