import { useEffect, useState } from "react";
import { nodeOf, useGuardian } from "../../zoo";
import { t, tChain } from "../../i18n";
import { BOT_URL } from "../../links";
import { Panel, Tile } from "../site/Panel";
import { opponentOf, pct, timeLeft, type HumansView, useContestApi, type Verdict } from "./data";

const PRIZE = (import.meta.env.VITE_HUMANS_PRIZE as string | undefined) ?? "SOL";
const usd = (n: number | null | undefined) => (n === null || n === undefined ? "-" : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`);
const CHOICES: Array<[Verdict, string, string]> = [
  ["suspicious", "Rug", "border-danger/60 bg-danger/10 text-danger"],
  ["watch", "Watch", "border-line-2 bg-night-raised text-white"],
  ["promising", "Alive", "border-moss/60 bg-moss/10 text-moss"],
];
const BTN = "inline-flex h-8 items-center rounded-[7px] border border-line-2 bg-night-raised px-3 text-[12.5px] font-medium text-white hover:border-[#3a4640] disabled:opacity-50";

/** Humans vs the odds model: holders call tonight's coins, and the next day's market grades them and the model alike. */
export default function Humans() {
  const { session, signIn, busy: signing, error: signError } = useGuardian();
  const { data: view, failed, reload } = useContestApi<HumansView>(`/v1/humans${session ? `?wallet=${session.publicKey}` : ""}`, 300_000);
  const [picks, setPicks] = useState<Record<string, Verdict>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tg, setTg] = useState<{ code: string; holder: boolean } | null>(null);
  // Saved answers come back with each read; picks not yet locked in stay as they are.
  useEffect(() => setPicks((p) => ({ ...(view?.mine ?? {}), ...p })), [view]);

  const post = async (path: string, body: object) => {
    const n = await nodeOf("beaver");
    if (!n || !session) return null;
    return fetch(`${n.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guardian: { publicKey: session.publicKey, message: session.message, signature: session.signature }, ...body }),
    }).catch(() => null);
  };

  const save = async () => {
    if (!session) return void signIn();
    setSaving(true);
    setMsg(null);
    const r = await post("/v1/humans/answer", { answers: Object.entries(picks).filter(([mint]) => view?.exam.some((x) => x.mint === mint)).map(([mint, verdict]) => ({ mint, verdict })) });
    const body = r ? ((await r.json().catch(() => ({}))) as { answered?: number; error?: string }) : { error: t("the node did not answer") };
    setSaving(false);
    setMsg(r?.ok ? t("Locked in: {n} answers. Reality grades them tomorrow.", { n: body.answered ?? 0 }) : (body.error ?? t("Could not save.")));
    if (r?.ok) reload();
  };

  // Holders get chain alerts first in Telegram: a one-time code ties the bot chat to this wallet.
  const linkTelegram = async () => {
    if (!session) return void signIn();
    const r = await post("/v1/tg/link", {});
    if (r?.ok) setTg((await r.json()) as { code: string; holder: boolean });
    else setMsg(t("Could not make a code. Try again in a minute."));
  };

  const model = opponentOf(view);
  const human = view?.standings[0];
  const answered = view ? view.exam.filter((x) => picks[x.mint]).length : 0;
  const hold = (view?.rules.holdMin ?? 500_000).toLocaleString("en-US");

  return (
    <>
      <Panel
        id="humans"
        title={t("Humans vs the odds model")}
        meta={t("every night · holders of {h} $ZOOAGENCY · top 3 each week win {prize}", { h: hold, prize: PRIZE })}
        className="lg:col-span-12"
        bodyClass="p-0"
      >
        <div className="grid grid-cols-2 border-b border-line sm:grid-cols-4">
          <Tile k={t("odds model, this week")} v={model ? pct(model.score) : "-"} sub={model ? t("{n} graded", { n: model.graded }) : t("grades after the first night")} className="border-b border-r border-line sm:border-b-0" />
          <Tile k={t("best human, this week")} v={human ? pct(human.score) : "-"} sub={human ? t("{name} · {n} graded", { name: human.id, n: human.graded }) : t("nobody yet, be first")} tone={human && model && human.score > model.score ? "moss" : "fg"} className="border-b border-line sm:border-b-0 sm:border-r" />
          <Tile k={t("week ends in")} v={view ? timeLeft(view.week.endsAt) : "-"} sub={view ? `${view.week.start} → ${view.week.end} · UTC` : undefined} className="border-r border-line" />
          <Tile k={t("tonight's exam")} v={view ? view.exam.length : "-"} sub={view ? t("night of {n}", { n: view.night }) : undefined} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
          <p className="text-[13px] text-fg-2">{t("Rug, watch or alive? Call each coin before the night ends. \"Watch\" counts as a miss, like it does for the model.")}</p>
          {!session ? (
            <button type="button" onClick={() => void signIn()} disabled={signing} className="btn-moss inline-flex h-8 items-center rounded-[7px] px-3.5 text-[12.5px] font-medium">
              {signing ? t("Signing…") : t("Sign in with your wallet")}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[12px] text-dim">{`${session.publicKey.slice(0, 4)}…${session.publicKey.slice(-4)}`}</span>
              {tg ? (
                <a href={`${BOT_URL}?start=link-${tg.code}`} target="_blank" rel="noopener noreferrer" className={BTN}>
                  {t("Open the bot to link ↗")}
                </a>
              ) : (
                <button type="button" onClick={() => void linkTelegram()} className={BTN}>
                  {t("Get alerts first in Telegram")}
                </button>
              )}
            </div>
          )}
        </div>
        {tg && (
          <p className="px-3.5 pb-3 text-[12.5px] text-dim">
            {t(tg.holder ? "You hold enough: alerts on tokens you watch reach you 10 minutes before everyone else." : "This wallet holds less than the minimum, so alerts arrive with everyone else's until you top up.")}{" "}
            {t("Or send")} <span className="font-mono text-fg-2">/link {tg.code}</span> {t("to the bot. The code lasts 15 minutes.")}
          </p>
        )}
        {signError && <p className="px-3.5 pb-3 text-[12.5px] text-danger">{signError}</p>}

        <div className="border-t border-line p-3.5">
          {!view ? (
            <p className="text-[13px] text-dim">{t(failed ? "The contest node did not answer. Try again in a minute." : "Loading tonight's exam…")}</p>
          ) : !view.exam.length ? (
            <p className="text-[13px] text-dim">{t("Tonight's exam is set once enough fresh tokens have been seen. Come back in a little while.")}</p>
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {view.exam.map((x) => (
                  <div key={x.mint} className="flex min-w-0 flex-col rounded-[10px] border border-line bg-night p-3.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <a href={`/xray?mint=${x.mint}`} className="truncate text-[16px] font-medium tracking-[-0.02em] text-white hover:underline">
                        ${x.symbol}
                      </a>
                      {x.graduated && <span className="text-[11.5px] text-moss">{t("graduated")}</span>}
                    </div>
                    <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                      <Fact k={t("liquidity")} v={x.market?.liq === null || x.market?.liq === undefined ? (x.graduated ? "-" : t("on curve")) : usd(x.market.liq)} />
                      <Fact k="24h" v={x.market?.change24h === null || x.market?.change24h === undefined ? "-" : `${Math.round(x.market.change24h)}%`} />
                      <Fact k={t("buys/sells")} v={x.market ? `${x.market.buys24h}/${x.market.sells24h}` : "-"} />
                      <Fact k={t("socials")} v={x.hasSocials === null || x.hasSocials === undefined ? "?" : t(x.hasSocials ? "yes" : "none")} />
                      {x.chain && <Fact k={t("dev sold")} v={pct(x.chain.creatorSold)} />}
                      {x.chain && <Fact k={t("top 5 buyers")} v={pct(x.chain.top5Share)} />}
                    </dl>
                    {!!x.flags?.length && <p className="mt-2 text-[12px] text-danger">{x.flags.slice(0, 2).map(tChain).join(" · ")}</p>}
                    <div className="mt-auto grid grid-cols-3 gap-1.5 pt-3.5">
                      {CHOICES.map(([v, label, on]) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={picks[x.mint] === v}
                          onClick={() => setPicks((p) => ({ ...p, [x.mint]: v }))}
                          className={`h-8 rounded-[7px] border text-[12.5px] transition-colors ${picks[x.mint] === v ? on : "border-line text-dim hover:text-white"}`}
                        >
                          {t(label)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12.5px] text-dim">{t("{a}/{n} answered · change answers until the night ends", { a: answered, n: view.exam.length })}</p>
                <button type="button" onClick={() => void save()} disabled={saving || !answered} className="btn-moss inline-flex h-9 items-center rounded-[8px] px-4 text-[13px] font-medium disabled:opacity-50">
                  {session ? (saving ? t("Saving…") : t("Lock in my answers")) : t("Sign in to lock in")}
                </button>
              </div>
              {msg && <p className="mt-2.5 text-[12.5px] text-fg-2">{msg}</p>}
            </>
          )}
        </div>
      </Panel>

      <Panel title={t("This week's humans")} meta={t("score · graded")} className="lg:col-span-8 lg:self-start" bodyClass="px-3.5 pb-2">
        {!view?.standings.length && <p className="py-3.5 text-[13px] text-dim">{t("No graded answers yet this week. Answer tonight, get graded tomorrow.")}</p>}
        <ol>
          {view?.standings.map((r, i) => (
            <li key={r.id} className={`flex items-baseline justify-between gap-3 border-b border-line py-2 text-[12.5px] last:border-b-0 ${r.you ? "text-warn" : "text-white"}`}>
              <span className="min-w-0 truncate">
                <span className="mr-3 text-faint">{String(i + 1).padStart(2, "0")}</span>
                {r.id}
                {r.you ? t(" · you") : ""}
              </span>
              <span className="shrink-0">
                {pct(r.score)} <span className="text-faint">· {r.graded}</span>
                {!r.ranked && <span className="ml-2 text-warn">{t("qualifying")}</span>}
              </span>
            </li>
          ))}
        </ol>
        {model && (
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line-2 py-2 text-[12.5px] text-dim">
            <span>{t("odds model, the bar to beat")}</span>
            <span>
              {pct(model.score)} <span className="text-faint">· {model.graded}</span>
            </span>
          </div>
        )}
      </Panel>

      <Panel title={t("The rules")} meta={t("humans")} className="lg:col-span-4 lg:self-start" bodyClass="p-3.5 text-[12.5px] leading-[1.5] text-fg-2">
        <ul className="grid gap-2">
          <li>{t("Hold {h}+ $ZOOAGENCY and sign in. Answer tonight's coins. Tomorrow the same re-check grades humans and the odds model.", { h: hold })}</li>
          <li>{t("The balance is read again when the night is graded. A wallet under the minimum by then gets nothing for that night.")}</li>
          <li>{t("Balanced accuracy: half for the dead, half for the living, so calling everything a rug scores 50%.")}</li>
          <li>{t("To place: {g}+ graded answers in the week, with {s}+ dead and {s}+ living tokens among them.", { g: view?.rules.minGraded ?? 15, s: view?.rules.minSide ?? 2 })}</li>
        </ul>
        <div className="mt-3.5 border-t border-line pt-3">
          <p className="text-[12px] text-warn">{t("last week's top 3")}</p>
          {view?.lastWeekTop.length ? (
            <ol className="mt-1.5 grid gap-1">
              {view.lastWeekTop.map((w, i) => (
                <li key={w.wallet} className="flex justify-between gap-3">
                  <span className="truncate">
                    {i + 1}. {w.wallet}
                  </span>
                  <span>{pct(w.score)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1 text-dim">{t("No human placed last week. The first winners could be you.")}</p>
          )}
        </div>
      </Panel>
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-faint">{k}</dt>
      <dd className="truncate text-fg-2">{v}</dd>
    </div>
  );
}
