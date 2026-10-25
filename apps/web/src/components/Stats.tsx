import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Reveal, Section, SectionHead } from "./ui";
import { t } from "../i18n";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const num = (n: number) => n.toLocaleString("en-US");
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
interface Dev {
  wallet: string;
  launches48h: number;
  dumped: number;
  graduated: number;
  medianDumpMin?: number | null;
}

/** Fetches one public endpoint every minute; null until it answers. */
function useLive<T>(path: string): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(`${NORTH}${path}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: T | null) => b && setV(b))
        .catch(() => {});
    void load();
    const id = window.setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [path]);
  return v;
}

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="bg-night-surface px-5 py-4">
      <p className="tabular-nums text-[12px] [&::first-letter]:uppercase text-fg-4">{k}</p>
      <p className="tabular-nums mt-2 text-[26px] leading-none text-fg">{v}</p>
      {sub && <p className="mt-2 text-[13px] text-fg-4">{sub}</p>}
    </div>
  );
}

/** One measure by day as bars: a value over each, the day under it, today marked as still counting. */
function Bars({ title, note, days, pick }: { title: string; note: string; days: Day[]; pick: (d: Day) => number }) {
  const max = Math.max(1, ...days.map(pick));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-5 sm:p-6">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl text-fg">{t(title)}</h3>
        <span className="tabular-nums text-[12px] text-fg-4">{t(note)}</span>
      </div>
      <div className="flex h-44 items-end gap-3 border-b border-white/15 pb-0">
        {days.map((d) => {
          const v = pick(d);
          return (
            <div key={d.day} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${d.day}: ${num(v)}`}>
              <span className="tabular-nums mb-1.5 text-[12.5px] text-fg-3">{num(v)}</span>
              <div className={`w-full max-w-[56px] rounded-t-[4px] transition ${d.day === today ? "bg-white/35" : "bg-white/75"} group-hover:bg-white`} style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3">
        {days.map((d) => (
          <span key={d.day} className="tabular-nums flex-1 text-center text-[12px] text-fg-4">
            {d.day.slice(5)}
            {d.day === today ? ` · ${t("so far")}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function DevTable({ title, note, rows, good }: { title: string; note: string; rows: Dev[] | null; good?: boolean }) {
  return (
    <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-5 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl text-fg">{t(title)}</h3>
        <span className="tabular-nums text-[12px] text-fg-4">{t(note)}</span>
      </div>
      <div className="tabular-nums grid grid-cols-[minmax(0,1fr)_3.6rem_3.6rem_4.2rem] sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem] gap-3 border-b border-white/[0.08] pb-2 text-[12px] text-fg-4">
        <span>{t("dev wallet")}</span>
        <span className="text-right">{t("launched")}</span>
        <span className="text-right">{t("dumped")}</span>
        <span className="text-right">{t("graduated")}</span>
      </div>
      {!rows && <p className="py-6 text-center text-[13px] text-fg-3">{t("Reading the chain…")}</p>}
      {rows?.map((r) => (
        <a key={r.wallet} href={`/xray?wallet=${r.wallet}`} className="tabular-nums grid grid-cols-[minmax(0,1fr)_3.6rem_3.6rem_4.2rem] sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem] items-baseline gap-3 border-t border-white/[0.08] py-2 text-[12px] transition first:border-t-0 hover:bg-white/[0.03]">
          <span className="truncate text-fg-2">{short(r.wallet)}</span>
          <span className="text-right text-fg-4">{num(r.launches48h)}</span>
          <span className={`text-right ${!good && r.dumped ? "text-[#ff8a7e]" : "text-fg-4"}`}>{num(r.dumped)}</span>
          <span className={`text-right ${good && r.graduated ? "text-[#a6e3b4]" : "text-fg-4"}`}>{num(r.graduated)}</span>
        </a>
      ))}
    </div>
  );
}

/** Every number the zoo has about itself, live from its public endpoints, with what each one does and does not count. */
export default function Stats() {
  const usage = useLive<Usage>("/v1/usage");
  const chain = useLive<Chain>("/v1/chain");
  const record = useLive<CheckRecord>("/v1/check/record");
  const ruggers = useLive<{ ruggers: Dev[] }>("/v1/chain/ruggers?limit=10");
  const builders = useLive<{ builders: Dev[] }>("/v1/chain/builders?limit=10");
  // The counter started on 19 October: days before it are not zero, they were not counted.
  const days = (usage?.days ?? []).filter((d) => d.day >= "2026-10-19");
  const a = record?.flaggedAvoid;
  const n = record?.notFlagged;

  return (
    <Section className="!pt-10">
      <SectionHead
        eyebrow={t("Stats · live · refreshed every minute")}
        title={[t("Our numbers,"), t("as they are.")]}
        text={t("How much the X-Ray is used, what the chain stream sees and how our verdicts held up, read from the same public endpoints anyone can open.")}
      />

      <div className="mx-auto max-w-7xl space-y-4">
        <Reveal className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.06] lg:grid-cols-4">
          <Tile k={t("full x-rays")} v={usage ? num(usage.last7.xrays) : "…"} sub={t("since the counter started, 19 Oct")} />
          <Tile k={t("verdict checks")} v={usage ? num(usage.last7.checks) : "…"} sub={t("most fired on their own by the extension and /xray")} />
          <Tile k={t("launches now")} v={chain ? `${chain.perMinute.launches}/min` : "…"} sub={chain ? (chain.live ? t("stream live") : t("stream behind")) : ""} />
          <Tile k={t("trades now")} v={chain ? `${num(chain.perMinute.trades)}/min` : "…"} sub={chain ? t("{n} tokens on the tape", { n: num(chain.tracked) }) : ""} />
        </Reveal>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <Reveal>
            <Bars title="Full X-Rays by day" note="someone opened a whole report" days={days} pick={(d) => d.xrays} />
          </Reveal>
          <Reveal delay={0.05}>
            <Bars title="Verdict checks by day" note="includes automatic ones" days={days} pick={(d) => d.checks} />
          </Reveal>
        </div>
        <p className="mx-auto max-w-3xl text-center text-[12.5px] leading-relaxed text-fg-3">
          {t("A full X-Ray is a person opening the whole report: on the site with a token pasted, in the extension's panel, in the bot or the Telegram app. A verdict check is the short answer; the extension asks for one on every token page and every address on X, and /xray asks for one per example card, so checks run well ahead of people. Callers are counted as hashes, never addresses. Days are UTC.")}
        </p>

        <Reveal className="bg-night-surface border border-white/[0.08] rounded-2xl p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-display text-xl text-fg">{t("How the verdicts held up")}</h3>
            <span className="tabular-nums text-[12px] text-fg-4">{t("tokens launched 24 to 48 hours ago, verdict taken at 5 minutes")}</span>
          </div>
          <div className="tabular-nums grid grid-cols-[minmax(0,1fr)_7rem_6rem] sm:grid-cols-[minmax(0,1fr)_5.5rem_9rem_9rem] gap-3 border-b border-white/[0.08] pb-2 text-[12px] text-fg-4">
            <span>{t("at 5 minutes")}</span>
            <span className="hidden text-right sm:block">{t("tokens")}</span>
            <span className="text-right">{t("dead")}</span>
            <span className="text-right">{t("still trading")}</span>
          </div>
          {[
            [t("flagged avoid"), a],
            [t("not flagged"), n],
          ].map(([label, s]) => (
            <div key={label as string} className="tabular-nums grid grid-cols-[minmax(0,1fr)_7rem_6rem] sm:grid-cols-[minmax(0,1fr)_5.5rem_9rem_9rem] items-baseline gap-3 border-t border-white/[0.08] py-2.5 text-[12.5px] first:border-t-0">
              <span className="text-fg-2">{label as string}</span>
              {(() => {
                const v = s ? tally(s as Side) : null;
                return (
                  <>
                    <span className="hidden text-right text-fg-3 sm:block">{v ? num(v.n) : "…"}</span>
                    <span className="text-right text-fg-3">{v ? `${num(v.dead)} · ${pctOf(v.dead, v.n)}` : "…"}</span>
                    <span className="text-right text-fg-3">{v ? `${num(v.trading)} · ${pctOf(v.trading, v.n)}` : "…"}</span>
                  </>
                );
              })()}
            </div>
          ))}
          <p className="mt-4 text-[12.5px] leading-relaxed text-fg-3">
            {t("Read it honestly: on pump.fun almost every launch dies within two days, flagged or not. The check does not find the survivors. What it does is name the dev who dumps, the snipers and who paid for them, so you know who is on the other side before you buy.")}
          </p>
        </Reveal>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <Reveal>
            <DevTable title="Serial dumpers" note="last 48 hours · tap a wallet" rows={ruggers?.ruggers ?? null} />
          </Reveal>
          <Reveal delay={0.05}>
            <DevTable title="Builders" note="launches graduated, not dumped" rows={builders?.builders ?? null} good />
          </Reveal>
        </div>

        {/* Where the token's creator fees go: pump.fun pays them to the creator wallet, so the proof is the buybacks and burns themselves. */}
        <Reveal className="bg-night-surface border border-white/[0.08] rounded-2xl p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-display text-xl text-fg">{t("$ZOOAGENCY creator fees")}</h3>
            <span className="tabular-nums text-[12px] text-fg-4">{t("buybacks and burns")}</span>
          </div>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-fg-3">
            {t("pump.fun pays a coin's creator fees to the creator wallet, with no split on chain. ClawPump splits ours after that: 61.5% buys $ZOOAGENCY back and burns it. Its page lists every buyback with its transaction and how much has been burned, so the proof is not our word.")}
          </p>
          <a
            href="https://clawpump.tech/tokens/2dZn4npTgAexBYquT3UqQXGiBdZf4F9tDTw419jEoS6B"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/[0.12] px-5 py-2.5 text-[13.5px] text-fg-2 transition hover:text-white"
          >
            {t("See the buybacks and burns on ClawPump")} ↗
          </a>
        </Reveal>

        <p className="tabular-nums pt-2 text-center text-[12.5px] text-fg-4">
          {t("raw:")}{" "}
          {["/v1/usage", "/v1/chain", "/v1/check/record", "/v1/chain/ruggers", "/v1/chain/builders"].map((p, i) => (
            <span key={p}>
              {i > 0 && " · "}
              <a href={`${NORTH}${p}`} className="underline decoration-white/25 underline-offset-4 hover:text-white">
                {p}
              </a>
            </span>
          ))}
        </p>
      </div>
    </Section>
  );
}
