import { AnimatePresence, motion } from "framer-motion";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { nodeOf, useGuardian } from "../../zoo";
import { Reveal, Section } from "../ui";
import { t } from "../../i18n";
import type { Ask, CleanLaunch, CreatorRecord, Recent } from "./types";
import { graded, mintIn, pctOf, TONE } from "./shared";
import { Answer, CreatorBlock } from "./Answer";


/* ---------- the page ---------- */

export default function AskPage() {
  // A link from the x-ray (/ask?mint=...) arrives with the token already in the box.
  const [input, setInput] = useState(() => mintIn(new URLSearchParams(window.location.search).get("mint") ?? "") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [recent, setRecent] = useState<Recent | null>(null);
  const [wallet, setWallet] = useState<CreatorRecord | null>(null);
  const [clean, setClean] = useState<CleanLaunch[] | null>(null);
  const { session, signIn, busy: signing } = useGuardian();
  const [holder, setHolder] = useState<{ holder: boolean; balance: number | null; min: number } | null>(null);
  const base = useRef<string | null>(null);
  const northBase = useRef<string | null>(null);

  const north = useCallback(async () => {
    if (!northBase.current) northBase.current = (await nodeOf("raven"))?.url ?? null;
    return northBase.current;
  }, []);

  const loadClean = useCallback(async () => {
    const url = await north();
    if (!url) return;
    try {
      const r = await fetch(`${url}/v1/chain/clean?limit=9`);
      if (r.ok) setClean(((await r.json()) as { launches: CleanLaunch[] }).launches);
    } catch {
      /* optional */
    }
  }, [north]);

  const canyon = useCallback(async () => {
    if (!base.current) base.current = (await nodeOf("beaver"))?.url ?? null;
    return base.current;
  }, []);

  const loadRecent = useCallback(async () => {
    const url = await canyon();
    if (!url) return;
    try {
      const r = await fetch(`${url}/v1/asks?limit=12`);
      if (r.ok) setRecent((await r.json()) as Recent);
    } catch {
      /* the feed is optional */
    }
  }, [canyon]);

  // A shared link, /ask#<id>, opens that answer.
  useEffect(() => {
    void loadRecent();
    void loadClean();
    const timer = window.setInterval(() => void loadClean(), 60_000);
    const id = location.hash.slice(1);
    if (!/^[0-9a-f]{10}$/.test(id)) return;
    void (async () => {
      const url = await canyon();
      if (!url) return;
      const r = await fetch(`${url}/v1/ask/${id}`).catch(() => null);
      if (r?.ok) setAsk((await r.json()) as Ask);
    })();
    return () => clearInterval(timer);
  }, [canyon, loadRecent, loadClean]);

  // A signed-in wallet: does it hold enough $ZOOAGENCY for the larger allowance?
  useEffect(() => {
    setHolder(null);
    if (!session) return;
    void (async () => {
      const url = await canyon();
      const r = url ? await fetch(`${url}/v1/holder/${session.publicKey}`).catch(() => null) : null;
      if (r?.ok) setHolder((await r.json()) as { holder: boolean; balance: number | null; min: number });
    })();
  }, [session, canyon]);

  const askAbout = async (mint: string) => {
    setBusy(true);
    setError(null);
    setWallet(null);
    try {
      const url = await canyon();
      if (!url) throw new Error("The beaver's node did not answer. Try again in a minute.");
      const r = await fetch(`${url}/v1/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          mint,
          ...(session ? { guardian: { publicKey: session.publicKey, message: session.message, signature: session.signature } } : {}),
        }),
      });
      const body = (await r.json()) as { ask?: Ask; error?: string };
      if (r.status === 404) {
        // Not a token anyone trades: maybe it is a creator's wallet.
        const n = await north();
        const w = n ? await fetch(`${n}/v1/chain/creator/${mint}`).catch(() => null) : null;
        if (w?.ok) {
          setAsk(null);
          setWallet((await w.json()) as CreatorRecord);
          history.replaceState(null, "", "/ask");
          return;
        }
      }
      if (!r.ok || !body.ask) throw new Error(body.error ?? "Something went wrong.");
      setAsk(body.ask);
      history.replaceState(null, "", `/ask#${body.ask.id}`);
      void loadRecent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Read the field itself too: a value set by a script (a password manager, a test agent) never reaches React's state.
    const mint = mintIn(input) ?? mintIn(String(new FormData(e.currentTarget).get("mint") ?? ""));
    if (!mint) {
      setError("Paste a Solana token address, a creator's wallet, or a pump.fun or DexScreener link.");
      return;
    }
    await askAbout(mint);
  };

  return (
    <>
      <Section className="!pb-10" backdrop={{ src: "/backdrops/cycle.webp", tint: "200,170,110", glowAt: "50% 35%", opacity: 0.35 }}>
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="tabular-nums text-[13px] text-fg-3">{t("Ask the beaver · graded by reality tomorrow")}</p>
          <h1 className="font-display mt-4 text-5xl leading-[1.02] sm:text-6xl md:text-7xl">
            {t("Is it a rug?")}
            <br />
            <span className="accent">{t("Ask the beaver.")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[15px] font-normal leading-relaxed text-fg-4">
            {t("Paste any token from Solana, BNB Chain or Base, or a creator's wallet to see how often it rugs. The beaver judges a token with the same playbook it uses every night, from the market and, for fresh pump.fun tokens, straight from the chain.")}{" "}
            {t("Tomorrow its answer is checked against what the token actually did. Signed on the public log either way.")}
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <form onSubmit={submit} className="bg-night-surface border border-white/[0.08] mx-auto mt-10 flex max-w-2xl flex-col gap-2 rounded-2xl p-2 sm:flex-row sm:rounded-full">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              name="mint"
              placeholder={t("token, creator wallet, or pump.fun link")}
              spellCheck={false}
              autoComplete="off"
              className="font-mono min-w-0 flex-1 bg-transparent px-5 py-3 text-[14px] text-white outline-none placeholder:text-fg-4"
              aria-label={t("Token address")}
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-white px-7 py-3 text-[14px] font-medium text-black transition hover:bg-white/90 disabled:opacity-60"
            >
              {busy ? t("The beaver is reading…") : t("Ask")}
            </button>
          </form>
          {error && <p className="mt-4 text-center text-[13px] text-[#ff8a7e]">{error}</p>}
          <p className="tabular-nums mt-4 text-center text-[13px] text-fg-3">
            {!session ? (
              <>
                {t("holding $ZOOAGENCY?")}{" "}
                <button type="button" onClick={() => void signIn()} disabled={signing} className="text-warn underline decoration-amber-100/30 underline-offset-4 hover:text-warn">
                  {t("sign in with your wallet")}
                </button>{" "}
                {t("for 30 questions an hour instead of 6")}
              </>
            ) : holder?.holder ? (
              <span className="text-warn">{t("● holder · 30 questions an hour · 10 tokens under watch")}</span>
            ) : holder ? (
              <>{t("signed in · hold {n} $ZOOAGENCY for 30 questions an hour", { n: holder.min.toLocaleString("en-US") })}</>
            ) : (
              <>{t("signed in · checking your wallet…")}</>
            )}
          </p>
        </Reveal>
      </Section>

      <AnimatePresence mode="wait">
        {ask && <Answer key={ask.id} a={ask} />}
        {wallet && !ask && (
          <motion.section key={wallet.wallet} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-5 pb-6 sm:px-8">
            <div className="bg-night-surface border border-white/[0.08] mx-auto max-w-7xl rounded-2xl p-6 sm:p-8">
              <CreatorBlock r={wallet} big />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <Section className="!pb-6 !pt-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-2xl">{t("Passed the basic checks")}</h2>
          <p className="tabular-nums text-[13px] text-fg-3">{t("fresh pump.fun launches · live from the chain")}</p>
        </div>
        <p className="mb-5 max-w-3xl text-[13px] font-normal leading-relaxed text-fg-3">
          {t("10 to 180 minutes old, the creator has not sold, the wallet is not a serial launcher, 25+ buyers with no five of them holding most of it, buys ahead of sells.")}{" "}
          {t("That only means the usual rug signs are absent so far. It is not a call and not advice; most of these still die. Ask the beaver before anything else.")}
        </p>
        {!clean ? (
          <p className="text-[13px] text-fg-3">{t("Reading the chain…")}</p>
        ) : clean.length === 0 ? (
          <p className="text-[13px] text-fg-3">{t("Nothing passes right now. On pump.fun that is a normal hour.")}</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {clean.map((c) => (
              <li key={c.mint} className="rounded-2xl bg-black/40 px-4 py-3 ring-1 ring-white/10">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display truncate text-[17px]">${c.symbol}</span>
                  <span className="tabular-nums shrink-0 text-[13px] text-fg-4">{t("{n} min old", { n: c.ageMin })}</span>
                </div>
                <p className="tabular-nums mt-1 text-[13px] text-fg-3">
                  {t("{b} buyers · {r} came back · top 5 hold {p}", { b: c.buyersMore ? `${c.buyers}+` : c.buyers, r: c.repeatBuyers, p: pctOf(c.top5Share) })}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setInput(c.mint);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                    void askAbout(c.mint);
                  }}
                  className="tabular-nums mt-2 text-[13px] text-warn underline decoration-amber-100/30 underline-offset-4 hover:text-warn disabled:opacity-50"
                >
                  {t("ask the beaver →")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section className="!pt-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-2xl">{t("Recent questions")}</h2>
          {recent && (
            <p className="tabular-nums text-[13px] text-fg-3">
              {t("{n} asked · beaver on asks:", { n: recent.asked.toLocaleString("en-US") })}{" "}
              {recent.record.graded ? t("{p} balanced · {n} graded", { p: pctOf(recent.record.skill), n: recent.record.graded }) : t("first grades after a day")}
            </p>
          )}
        </div>
        {!recent?.asks.length ? (
          <p className="text-[13px] text-fg-3">{t("No questions yet. Be the first.")}</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recent.asks.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    setAsk(a);
                    history.replaceState(null, "", `/ask#${a.id}`);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="w-full rounded-2xl bg-black/40 px-4 py-3 text-left ring-1 ring-white/10 transition hover:bg-black/55 hover:ring-white/25"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display truncate text-[17px]">${a.symbol}</span>
                    <span className={`tabular-nums shrink-0 text-[13px] ${TONE[a.verdict].text}`}>{t(TONE[a.verdict].label)}</span>
                  </div>
                  <p className="tabular-nums mt-1 truncate text-[13px] text-fg-4">{graded(a)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
