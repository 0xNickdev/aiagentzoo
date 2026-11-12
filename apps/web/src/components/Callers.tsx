import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Reveal, Section, SectionHead } from "./ui";
import { t } from "../i18n";
import { num, short } from "../format";
import { navigate } from "../router";

/**
 * Caller Truth: every pump.fun callout set against the chain for the 24 hours after it. One row per caller, and a
 * caller opens into each call with where the coin went. The wallet is the one pump.fun lists next to the caller.
 */

interface CallerRecord {
  wallet: string;
  name: string;
  twitter: string | null;
  followers: number | null;
  calls: number;
  coins: number;
  settled: number;
  alive: number;
  dead: number;
  up: number;
  medianX: number | null;
  bestX: number | null;
  walletSeen: number;
  boughtBefore: number;
  soldWithinHour: number;
  soldAfter: number;
  devDumpedAfter: number;
  lastAt: number;
}
interface Outcome {
  at: number;
  calledUsd: number;
  h1Usd: number | null;
  peakUsd: number | null;
  endUsd: number | null;
  firstAt: number;
  state: "alive" | "dead" | "between";
  devDumpedAt: number | null;
  walletSeen: boolean;
  boughtAt: number | null;
  exitAt: number | null;
  done: boolean;
}
interface Call {
  post: number;
  mint: string;
  symbol: string;
  text: string;
  at: number;
  calledMcUsd: number | null;
  url: string;
  outcome: Outcome | null;
}
interface ListBody {
  since?: number;
  followed?: number;
  settled?: number;
  minSettled?: number;
  callers: CallerRecord[];
}
interface CallerBody {
  record: CallerRecord | null;
  calls: Call[];
}
type Sort = "settled" | "dead" | "sold";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const usd = (n: number | null) => (n === null ? "-" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const times = (x: number | null) => (x === null ? "-" : `${x >= 10 ? Math.round(x) : x.toFixed(2)}x`);
const span = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 1 ? t("under a minute") : m < 90 ? t("{m} min", { m }) : t("{h} h", { h: Math.round(m / 60) });
};
const when = (at: number) => {
  const h = Math.max(0, (Date.now() - at) / 3_600_000);
  return h < 1 ? t("{m} min ago", { m: Math.max(1, Math.round(h * 60)) }) : h < 48 ? t("{h} h ago", { h: Math.round(h) }) : t("{d} d ago", { d: Math.round(h / 24) });
};
const HOUR = 3_600_000;

/** How a call stands: still inside its day, ran it, or never on our tape. */
function state(o: Outcome | null): { text: string; tone: string } {
  if (!o) return { text: t("not followed"), tone: "text-fg-4" };
  if (!o.done) return { text: t("following"), tone: "text-fg-3" };
  return o.state === "alive" ? { text: t("alive"), tone: "text-[#a6e3b4]" } : o.state === "dead" ? { text: t("dead"), tone: "text-[#ff8a7e]" } : { text: t("in between"), tone: "text-fg-3" };
}

/** What the listed wallet did around the call, in words; empty when it was not among the buyers we track. */
function walletLine(o: Outcome | null): string {
  if (!o || !o.walletSeen) return "";
  const parts: string[] = [];
  if (o.boughtAt !== null) parts.push(o.boughtAt < o.at ? t("in {s} before the call", { s: span(o.at - o.boughtAt) }) : t("in {s} after the call", { s: span(o.boughtAt - o.at) }));
  if (o.exitAt !== null) parts.push(o.exitAt > o.at ? t("sold out {s} after it", { s: span(o.exitAt - o.at) }) : t("sold out before it"));
  return parts.join(" · ");
}

function Tile({ k, v, tone = "text-fg" }: { k: string; v: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-black/30 px-3 py-2 ring-1 ring-white/[0.06]">
      <p className="text-[13px] text-fg-4">{k}</p>
      <p className={`mt-0.5 text-[16px] ${tone}`}>{v}</p>
    </div>
  );
}

export default function Callers() {
  const [body, setBody] = useState<ListBody | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<Sort>("settled");
  const [open, setOpen] = useState<{ wallet: string; body: CallerBody | null } | null>(null);
  const wanted = new URLSearchParams(location.search).get("wallet");

  useEffect(() => {
    setBody(null);
    fetch(`${NORTH}/v1/callers?limit=200&sort=${sort}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: ListBody) => (setBody(b), setFailed(false)))
      .catch(() => setFailed(true));
  }, [sort]);

  const load = (wallet: string) => {
    setOpen({ wallet, body: null });
    fetch(`${NORTH}/v1/caller/${wallet}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: CallerBody | null) => setOpen(b ? { wallet, body: b } : null))
      .catch(() => setOpen(null));
  };
  useEffect(() => {
    if (wanted) load(wanted);
  }, [wanted]);

  const show = (wallet: string) => {
    history.pushState(null, "", `/callers?wallet=${wallet}`);
    load(wallet);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const close = () => {
    setOpen(null);
    history.pushState(null, "", "/callers");
  };

  const rec = open?.body?.record ?? null;
  const COLS = "grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_4rem] sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_6rem_7rem_7rem]";
  const CALL_COLS = "grid-cols-[minmax(0,1fr)_4rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_5.5rem_5.5rem_5rem]";

  return (
    <Section className="overflow-x-clip !pt-32 sm:!pt-40" backdrop={{ glowAt: "30% 10%" }}>
      <SectionHead
        eyebrow={t("Caller Truth · pump.fun callouts · each one followed for 24 hours")}
        title={[t("What happened"), t("after the call.")]}
        text={t("Every callout is set against the chain for the day after it: where the coin stood 24 hours later, whether it was still alive, and what the caller's listed wallet did around the call. The wallet is the one pump.fun prints next to the caller. A caller shows up here once five of their calls have run their day. This is a record of calls, and it says nothing about who owns a wallet.")}
      />

      {open && (
        <Reveal className="bg-night-surface border border-white/[0.08] mb-6 rounded-2xl p-5 sm:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display truncate text-2xl">{rec?.name || short(open.wallet)}</h2>
              <p className="mt-1 truncate text-[13px] text-fg-3">
                {rec?.twitter ? `${rec.twitter} · ` : ""}
                {rec?.followers ? `${t("{n} followers on pump.fun", { n: num(rec.followers) })} · ` : ""}
                <button type="button" onClick={() => navigate(`/xray?wallet=${open.wallet}`)} className="font-mono text-fg-3 underline decoration-white/20 underline-offset-4 hover:text-white">
                  {short(open.wallet)}
                </button>
              </p>
            </div>
            <button type="button" onClick={close} className="tabular-nums rounded-full px-2.5 py-1 text-[13px] text-fg-3 ring-1 ring-white/10 hover:text-white">
              {t("close")}
            </button>
          </div>
          {!open.body && <p className="py-8 text-center text-[13px] text-fg-3">{t("Reading the calls…")}</p>}
          {rec && (
            <>
              <div className="tabular-nums mt-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
                <Tile k={t("calls, 30 days")} v={num(rec.calls)} />
                <Tile k={t("ran their day")} v={num(rec.settled)} />
                <Tile k={t("dead a day later")} v={rec.settled ? `${rec.dead} ${t("of")} ${rec.settled}` : "-"} tone={rec.dead ? "text-[#ff8a7e]" : "text-fg"} />
                <Tile k={t("ended above the call")} v={rec.settled ? `${rec.up} ${t("of")} ${rec.settled}` : "-"} />
                <Tile k={t("median, end over call")} v={times(rec.medianX)} />
                <Tile k={t("best peak we saw")} v={times(rec.bestX)} />
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-fg-3">
                {rec.walletSeen
                  ? t("The listed wallet was among the buyers we track on {n} of these coins: in before the call on {b}, sold out within an hour after it on {s}.", { n: rec.walletSeen, b: rec.boughtBefore, s: rec.soldWithinHour })
                  : t("The listed wallet was not among the buyers we track on any of these coins.")}
              </p>
            </>
          )}
          {open.body && (
            <div className="mt-5">
              <div className={`tabular-nums grid ${CALL_COLS} gap-3 border-b border-white/[0.08] pb-2 text-[13px] text-fg-4`}>
                <span>{t("coin")}</span>
                <span className="hidden text-right sm:block">{t("called at")}</span>
                <span className="hidden text-right sm:block">{t("1 h later")}</span>
                <span className="hidden text-right sm:block">{t("peak seen")}</span>
                <span className="text-right">{t("day later")}</span>
                <span className="hidden text-right sm:block">{t("end / call")}</span>
                <span className="text-right">{t("state")}</span>
              </div>
              {open.body.calls.map((c) => {
                const o = c.outcome;
                const st = state(o);
                const wl = walletLine(o);
                return (
                  <button key={c.post} type="button" onClick={() => navigate(`/xray?mint=${c.mint}`)} className="block w-full border-b border-white/[0.06] py-2 text-left text-[13px] hover:bg-white/[0.03]">
                    <span className={`tabular-nums grid ${CALL_COLS} items-baseline gap-3`}>
                      <span className="min-w-0">
                        <span className="block truncate text-fg-2">
                          ${c.symbol.replace(/^\$/, "") || short(c.mint)} <span className="text-fg-4">{when(c.at)}</span>
                        </span>
                        <span className="block truncate text-[12.5px] text-fg-4 sm:hidden">{t("called at {c}", { c: usd(c.calledMcUsd) })}</span>
                      </span>
                      <span className="hidden text-right text-fg-3 sm:block">{usd(c.calledMcUsd)}</span>
                      <span className="hidden text-right text-fg-3 sm:block">{usd(o?.h1Usd ?? null)}</span>
                      <span className="hidden text-right text-fg-3 sm:block">{o && o.firstAt - o.at <= 5 * 60_000 ? usd(o.peakUsd) : "-"}</span>
                      <span className="text-right text-fg-2">{o?.done ? usd(o.endUsd) : "-"}</span>
                      <span className="hidden text-right text-fg-3 sm:block">{o?.done && o.endUsd !== null ? times(o.endUsd / o.calledUsd) : "-"}</span>
                      <span className={`whitespace-nowrap text-right ${st.tone}`}>{st.text}</span>
                    </span>
                    {(wl || (o?.devDumpedAt ?? null) !== null) && (
                      <span className="mt-1 block truncate text-[12.5px] text-fg-4">
                        {wl ? `${t("listed wallet")}: ${wl}` : ""}
                        {wl && o?.devDumpedAt ? " · " : ""}
                        {o?.devDumpedAt ? t("the dev dumped {s} after the call", { s: span(o.devDumpedAt - o.at) }) : ""}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Reveal>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["settled", t("most calls followed")],
            ["dead", t("most dead a day later")],
            ["sold", t("wallet sold within the hour")],
          ] as Array<[Sort, string]>
        ).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setSort(id)} className={`rounded-full px-3.5 py-1.5 text-[13px] ring-1 transition ${sort === id ? "bg-white text-black ring-white" : "text-fg-3 ring-white/10 hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>

      <Reveal className="bg-night-surface border border-white/[0.08] overflow-hidden rounded-2xl">
        <div className={`tabular-nums grid ${COLS} gap-3 border-b border-white/[0.08] px-5 py-3 text-[13px] text-fg-4`}>
          <span>{t("caller")}</span>
          <span className="text-right">{t("calls")}</span>
          <span className="hidden text-right sm:block">{t("ran their day")}</span>
          <span className="text-right">{t("dead")}</span>
          <span className="text-right">{t("end / call")}</span>
          <span className="hidden text-right sm:block">{t("in before call")}</span>
          <span className="hidden text-right sm:block">{t("sold within 1 h")}</span>
        </div>
        {failed && <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t("The chain reader did not answer. Try again in a minute.")}</p>}
        {!failed && !body && <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t("Reading the calls…")}</p>}
        {body && body.callers.length === 0 && <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t("No caller has five calls that ran their day yet. The first ones land within hours.")}</p>}
        {body?.callers.map((c) => (
          <button key={c.wallet} type="button" onClick={() => show(c.wallet)} className={`tabular-nums grid w-full ${COLS} items-center gap-3 border-b border-white/[0.06] px-5 py-3 text-left text-[13px] transition hover:bg-white/[0.03]`}>
            <span className="min-w-0">
              <span className="block truncate text-[14px] text-fg">{c.name || short(c.wallet)}</span>
              <span className="block truncate text-fg-4">
                {c.twitter ? `${c.twitter} · ` : ""}
                {c.followers ? t("{n} followers", { n: num(c.followers) }) : short(c.wallet)}
              </span>
            </span>
            <span className="text-right text-fg-2">{c.calls}</span>
            <span className="hidden text-right text-fg-3 sm:block">{c.settled}</span>
            <span className={`text-right ${c.dead * 2 >= c.settled ? "text-[#ff8a7e]" : "text-fg-2"}`}>
              {c.dead}/{c.settled}
            </span>
            <span className="text-right text-fg-2">{times(c.medianX)}</span>
            <span className="hidden text-right text-fg-3 sm:block">{c.walletSeen ? `${c.boughtBefore}/${c.walletSeen}` : "-"}</span>
            <span className={`hidden text-right sm:block ${c.soldWithinHour ? "text-[#ff8a7e]" : "text-fg-3"}`}>{c.walletSeen ? `${c.soldWithinHour}/${c.walletSeen}` : "-"}</span>
          </button>
        ))}
      </Reveal>

      <p className="mt-5 max-w-3xl text-[13px] leading-relaxed text-fg-4">
        {body?.followed !== undefined && body.since
          ? t("{f} calls followed since {d}, {s} of them through their full day. ", { f: num(body.followed), s: num(body.settled ?? 0), d: new Date(body.since - 47 * HOUR).toISOString().slice(0, 10) })
          : ""}
        {t("Dead is the line our agents are graded by, read a day after the call: under 0.4 SOL left in the pool, or a curve back near where it opened. Alive is 4 SOL or more in the pool, or a curve at about three times its opening cap. The rest sits in between. End over call is the cap a day later against the cap pump.fun printed when the call was made, the median across a caller's coins. A second call on the same coin is not judged again. A call on a coin older than our two-day tape cannot be followed and is left out. The wallet columns only count coins where the listed wallet was among the buyers we track.")}
      </p>
    </Section>
  );
}
