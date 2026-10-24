import { useCallback, useEffect, useState } from "react";
import { nodeOf, useGuardian } from "../zoo";
import GeneVote from "./GeneVote";
import { Reveal, Section, SectionHead } from "./ui";
import { t, tChain } from "../i18n";

type Verdict = "suspicious" | "watch" | "promising";
interface ExamToken {
  mint: string;
  symbol: string;
  graduated?: boolean;
  hasSocials?: boolean | null;
  market?: { liq: number | null; vol24h: number | null; change24h: number | null; buys24h: number; sells24h: number } | null;
  flags?: string[];
  chain?: { creatorSold: number | null; creatorLaunches24h: number; buyers: number; top5Share: number | null; bundleWallets?: number | null } | null;
}
interface Row {
  id: string;
  graded: number;
  score: number;
  dead: number;
  alive: number;
  ranked: boolean;
  you?: boolean;
}
interface View {
  night: string;
  exam: ExamToken[];
  mine: Record<string, Verdict>;
  rules: { minGraded: number; minSide: number };
  week: { start: string; end: string; endsAt: string };
  bestJudge: { name: string; score: number; graded: number } | null;
  standings: Row[];
  lastWeekTop: Array<{ wallet: string; score: number; graded: number }>;
}

const PRIZE = (import.meta.env.VITE_HUMANS_PRIZE as string | undefined) ?? "SOL";
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${Math.round(x * 100)}%`);
const usd = (n: number | null | undefined) => (n === null || n === undefined ? "-" : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`);
const CHOICES: Array<[Verdict, string, string]> = [
  ["suspicious", "Rug", "bg-[#ff7a6e]/15 text-[#ff8a7e] ring-[#ff7a6e]/40"],
  ["watch", "Watch", "bg-white/10 text-white ring-white/30"],
  ["promising", "Alive", "bg-[#8ff0a4]/15 text-[#9df3b0] ring-[#8ff0a4]/40"],
];

/** Humans vs the beaver: holders sit the nursery's nightly exam and are graded by the same re-check. */
export default function Play() {
  const { session, signIn, busy: signing, error: signError } = useGuardian();
  const [view, setView] = useState<View | null>(null);
  const [picks, setPicks] = useState<Record<string, Verdict>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const n = await nodeOf("beaver");
    if (!n) return;
    const r = await fetch(`${n.url}/v1/humans${session ? `?wallet=${session.publicKey}` : ""}`).catch(() => null);
    if (r?.ok) {
      const v = (await r.json()) as View;
      setView(v);
      setPicks(v.mine ?? {});
    }
  }, [session]);
  useEffect(() => void load(), [load]);

  const save = async () => {
    if (!session) return void signIn();
    setSaving(true);
    setMsg(null);
    const n = await nodeOf("beaver");
    const r = await fetch(`${n!.url}/v1/humans/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guardian: { publicKey: session.publicKey, message: session.message, signature: session.signature },
        answers: Object.entries(picks).map(([mint, verdict]) => ({ mint, verdict })),
      }),
    }).catch(() => null);
    const body = r ? ((await r.json()) as { answered?: number; error?: string }) : { error: t("the node did not answer") };
    setSaving(false);
    setMsg(r?.ok ? t("Locked in: {n} answers. Reality grades them tomorrow.", { n: body.answered ?? 0 }) : (body.error ?? t("Could not save.")));
    if (r?.ok) void load();
  };

  const answered = Object.keys(picks).length;

  // Holders get chain alerts first in Telegram: a one-time code ties the bot chat to this wallet.
  const [tg, setTg] = useState<{ code: string; holder: boolean } | null>(null);
  const linkTelegram = async () => {
    if (!session) return void signIn();
    const n = await nodeOf("beaver");
    const r = await fetch(`${n!.url}/v1/tg/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guardian: { publicKey: session.publicKey, message: session.message, signature: session.signature } }),
    }).catch(() => null);
    if (r?.ok) setTg((await r.json()) as { code: string; holder: boolean });
    else setMsg(t("Could not make a code. Try again in a minute."));
  };

  return (
    <>
      <Section className="!pb-8" backdrop={{ src: "/backdrops/play.jpg", tint: "120,160,200", glowAt: "50% 40%", opacity: 0.6 }}>
        <SectionHead
          eyebrow={t("Humans vs the beaver · every night · holders only")}
          title={[t("Can you beat"), t("an AI that evolves?")]}
          text={t("Every night our AI judges sit an exam of fresh Solana tokens. Sit the same one. Tomorrow reality grades everyone on one honest scale, and every week the top 3 humans win {prize}. Rewarded for being right, not for holding.", { prize: PRIZE })}
        />
        <Reveal className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-3">
          <Stat k={t("best AI judge this week")} v={view?.bestJudge ? pct(view.bestJudge.score) : "-"} sub={view?.bestJudge ? t("{name} · {n} graded", { name: view.bestJudge.name, n: view.bestJudge.graded }) : t("grades after the first night")} />
          <Stat k={t("best human this week")} v={view?.standings[0] ? pct(view.standings[0].score) : "-"} sub={view?.standings[0] ? t("{name} · {n} graded", { name: view.standings[0].id, n: view.standings[0].graded }) : t("nobody yet. be first")} />
          <Stat k={t("week ends")} v={view ? view.week.end.slice(5) : "-"} sub={t("monday 00:00 UTC")} />
        </Reveal>
      </Section>

      <Section className="!pt-0 !pb-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[12px] text-fg-3">{t("tonight's exam · night of {n}", { n: view?.night ?? "…" })}</p>
            <h2 className="font-display mt-1 text-3xl">{t("Rug, watch or alive?")}</h2>
          </div>
          {!session ? (
            <button type="button" onClick={() => void signIn()} disabled={signing} className="rounded-full bg-white px-6 py-3 text-[14px] font-medium text-black hover:bg-white/90">
              {signing ? t("Signing…") : t("Sign in with your wallet")}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-[12.5px] text-fg-3">{t("signed in · {w}", { w: `${session.publicKey.slice(0, 4)}…${session.publicKey.slice(-4)}` })}</p>
              {tg ? (
                <a href={`https://t.me/zooaiagency_bot?start=link-${tg.code}`} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white px-5 py-2.5 text-[13px] font-medium text-black hover:bg-white/90">
                  {t("Open the bot to link ↗")}
                </a>
              ) : (
                <button type="button" onClick={() => void linkTelegram()} className="rounded-full px-5 py-2.5 text-[13px] text-fg-2 ring-1 ring-white/20 hover:ring-white/40">
                  {t("Get alerts first in Telegram")}
                </button>
              )}
            </div>
          )}
        </div>
        {tg && (
          <p className="mb-3 text-[13px] font-light text-fg-4">
            {t(tg.holder ? "You hold enough: alerts on tokens you watch reach you 10 minutes before everyone else." : "This wallet holds less than the minimum, so alerts arrive with everyone else's until you top up.")}{" "}
            {t("Or send")} <span className="font-mono text-fg-2">/link {tg.code}</span> {t("to the bot. The code lasts 15 minutes.")}
          </p>
        )}
        {signError && <p className="mb-3 text-[13px] text-[#ff8a7e]">{signError}</p>}
        {!view ? (
          <p className="text-[13px] text-fg-3">{t("Loading tonight's exam…")}</p>
        ) : !view.exam.length ? (
          <p className="liquid-glass rounded-3xl p-6 text-[14px] font-light text-fg-4">{t("Tonight's exam is set once enough fresh tokens have been seen. Come back in a little while.")}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {view.exam.map((x) => (
                <div key={x.mint} className="liquid-glass flex flex-col rounded-3xl p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-display truncate text-xl">${x.symbol}</span>
                    {x.graduated && <span className="font-mono text-[11.5px] text-[#9df3b0]">{t("graduated")}</span>}
                  </div>
                  <dl className="font-mono mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                    <Fact k={t("liquidity")} v={x.market?.liq === null || x.market?.liq === undefined ? (x.graduated ? "-" : t("on curve")) : usd(x.market.liq)} />
                    <Fact k="24h" v={x.market?.change24h === null || x.market?.change24h === undefined ? "-" : `${Math.round(x.market.change24h)}%`} />
                    <Fact k={t("buys/sells")} v={x.market ? `${x.market.buys24h}/${x.market.sells24h}` : "-"} />
                    <Fact k={t("socials")} v={x.hasSocials === null || x.hasSocials === undefined ? "?" : t(x.hasSocials ? "yes" : "none")} />
                    {x.chain && <Fact k={t("dev sold")} v={pct(x.chain.creatorSold)} />}
                    {x.chain && <Fact k={t("top 5 buyers")} v={pct(x.chain.top5Share)} />}
                  </dl>
                  {!!x.flags?.length && <p className="mt-2 text-[13px] font-light text-[#ffb3ab]">{x.flags.slice(0, 2).map(tChain).join(" · ")}</p>}
                  <div className="mt-auto grid grid-cols-3 gap-1.5 pt-4">
                    {CHOICES.map(([v, label, on]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setPicks((p) => ({ ...p, [x.mint]: v }))}
                        className={`rounded-full py-2 text-[12px] ring-1 transition ${picks[x.mint] === v ? on : "text-fg-4 ring-white/10 hover:text-white"}`}
                      >
                        {t(label)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[12.5px] text-fg-3">
                {t("{a}/{n} answered · \"watch\" counts as a miss, like it does for the AI · change answers until the night ends", { a: answered, n: view.exam.length })}
              </p>
              <button type="button" onClick={() => void save()} disabled={saving || !answered} className="rounded-full bg-white px-6 py-3 text-[14px] font-medium text-black hover:bg-white/90 disabled:opacity-50">
                {session ? (saving ? t("Saving…") : t("Lock in my answers")) : t("Sign in to lock in")}
              </button>
            </div>
            {msg && <p className="mt-3 text-[13px] text-fg-3">{msg}</p>}
          </>
        )}
      </Section>

      <Section className="!pt-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="liquid-glass rounded-3xl p-6">
            <div className="font-mono flex justify-between text-[12px] text-fg-3">
              <span>{t("this week's humans")}</span>
              <span>{t("score · graded")}</span>
            </div>
            {!view?.standings.length && <p className="mt-5 text-[13.5px] font-light text-fg-4">{t("No graded answers yet this week. Answer tonight, get graded tomorrow.")}</p>}
            <ol className="mt-2">
              {view?.standings.map((r, i) => (
                <li key={r.id} className={`flex items-baseline justify-between gap-3 border-b border-dashed border-white/10 py-2.5 ${r.you ? "text-amber-100" : ""}`}>
                  <span className="font-mono text-[13px]">
                    <span className="mr-3 text-fg-4">{String(i + 1).padStart(2, "0")}</span>
                    {r.id}
                    {r.you ? t(" · you") : ""}
                  </span>
                  <span className="font-mono text-[13px]">
                    {pct(r.score)} <span className="text-fg-4">· {r.graded}</span>
                    {!r.ranked && <span className="ml-2 text-[12px] text-warn">{t("qualifying")}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-col gap-3">
            <div className="liquid-glass rounded-3xl p-6">
              <p className="font-mono text-[12px] text-warn">{t("last week's top 3")}</p>
              {view?.lastWeekTop.length ? (
                <ol className="mt-3 space-y-1.5">
                  {view.lastWeekTop.map((w, i) => (
                    <li key={w.wallet} className="font-mono flex justify-between text-[13px]">
                      <span>
                        {i + 1}. {w.wallet}
                      </span>
                      <span>{pct(w.score)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-[13.5px] font-light text-fg-4">{t("The first week is open. The first winners could be you.")}</p>
              )}
            </div>
            <div className="liquid-glass rounded-3xl p-6 text-[13px] font-light leading-relaxed text-fg-3">
              <p className="font-mono mb-2 text-[12px] text-fg-3">{t("the rules")}</p>
              <p>{t("Hold 500,000+ $ZOOAGENCY and sign in. Answer tonight's tokens. Tomorrow the same re-check grades humans and AI.")}</p>
              <p className="mt-2">{t("Balanced accuracy: half for the dead, half for the living, so calling everything a rug scores 50%.")}</p>
              <p className="mt-2">{t("To place: {g}+ graded answers in the week, with {s}+ dead and {s}+ living tokens among them.", { g: view?.rules.minGraded ?? 15, s: view?.rules.minSide ?? 2 })}</p>
              <p className="mt-2">{t("The week's best human also names the nursery's next newborn.")}</p>
            </div>
          </div>
        </div>
      </Section>
      <GeneVote />
    </>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="liquid-glass rounded-3xl p-5 text-center">
      <p className="font-mono text-[12px] text-fg-3">{k}</p>
      <p className="font-display mt-1 text-4xl">{v}</p>
      <p className="font-mono mt-1 truncate text-[12px] text-fg-3">{sub}</p>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-4">{k}</dt>
      <dd className="truncate text-fg-2">{v}</dd>
    </div>
  );
}
