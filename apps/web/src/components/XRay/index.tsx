import { AnimatePresence } from "framer-motion";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { rememberChains } from "../../chain";
import { Reveal, Section } from "../ui";
import { t } from "../../i18n";
import WalletProfile from "../WalletProfile";
import type { XRayReport } from "./types";
import { mintIn, NORTH } from "./shared";
import { Report } from "./Report";
import { Start } from "./Start";
export { KIND, kindOf } from "../XRayRadar";
export type { Early, Odds, Verdict, XRayReport } from "./types";
export { TONE } from "./shared";

/** One token, seen through: who got in first, who they are across launches, who paid for the creator, what is churn. */
export default function XRay() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last mint that failed on a dropped request, so the error line can offer to try it again.
  const [retry, setRetry] = useState<string | null>(null);
  const [report, setReport] = useState<XRayReport | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);

  const showWallet = (w: string) => {
    setReport(null);
    setError(null);
    setInput(w);
    setWallet(w);
    history.pushState(null, "", `/xray?wallet=${w}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  useEffect(() => {
    const on = (e: Event) => showWallet((e as CustomEvent<string>).detail);
    window.addEventListener("zoo-wallet", on);
    return () => window.removeEventListener("zoo-wallet", on);
  }, []);

  // Each run gets a number; an answer that comes back after a newer run started is dropped, not shown.
  const runSeq = useRef(0);
  const run = async (mint: string) => {
    const seq = ++runSeq.current;
    const stale = () => seq !== runSeq.current;
    setBusy(true);
    setError(null);
    setRetry(null);
    setWallet(null);
    try {
      const r = await fetch(`${NORTH}/v1/xray/${mint}`).catch(() => null);
      if (stale()) return;
      if (!r) {
        // The node did not answer: keep a report already on screen, say so plainly and offer to try again.
        setRetry(mint);
        setError(t("The chain reader did not answer. Try again in a minute."));
        return;
      }
      const body = (await r.json().catch(() => ({}))) as XRayReport & { error?: string; chain?: string };
      if (stale()) return;
      // A 0x address is BNB Chain or Base: the node says which, and every wallet in the report is on that chain too.
      rememberChains(body);
      if (r.ok && !body.check) {
        // A 200 that is not a report (a proxy page, a cut-off answer): the same as no answer.
        setRetry(mint);
        setError(t("The chain reader did not answer. Try again in a minute."));
        return;
      }
      if (r.status === 429 || r.status >= 500) {
        // Rate limit or a node hiccup: the report on screen stays, the line above it says why.
        setRetry(mint);
        setError(r.status === 429 ? t("Ten x-rays a minute on the free tier. Try again in a minute.") : t("The chain reader did not answer. Try again in a minute."));
        return;
      }
      // Not a token the stream saw: perhaps a wallet, a dev, a sniper or a funder.
      if (r.status === 404) {
        const w = await fetch(`${NORTH}/v1/wallet/${mint}`).then((x) => x.status).catch(() => 0);
        if (stale()) return;
        if (w === 200) {
          setReport(null);
          setWallet(mint);
          history.replaceState(null, "", `/xray?wallet=${mint}`);
          return;
        }
      }
      if (!r.ok) throw new Error(body.error ? t("Not a launch or a wallet the stream saw in the last two days (pump.fun, LaunchLab, Meteora, four.meme, Flap, Clanker).") : t("Something went wrong."));
      setReport(body);
      const keepTab = new URLSearchParams(window.location.search).get("tab");
      history.pushState(null, "", `/xray?mint=${mint}${keepTab ? `&tab=${encodeURIComponent(keepTab)}` : ""}`);
    } catch (err) {
      if (stale()) return;
      setReport(null);
      setError((err as Error).message);
    } finally {
      if (!stale()) setBusy(false);
    }
  };

  useEffect(() => {
    const read = () => {
      const q = new URLSearchParams(location.search);
      const mint = mintIn(q.get("mint") ?? "");
      const w = mintIn(q.get("wallet") ?? "");
      if (w) {
        setInput(w);
        setReport(null);
        setWallet(w);
      } else if (mint) {
        setInput(mint);
        void run(mint);
      }
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Read the field itself too: a value set by a script (a password manager, a test agent) never reaches React's state.
    const mint = mintIn(input) ?? mintIn(String(new FormData(e.currentTarget).get("mint") ?? ""));
    if (!mint) return setError(t("Paste a token address or link."));
    void run(mint);
  };

  return (
    <>
      <Section className="!pb-10" backdrop={{ src: "/backdrops/cycle.webp", tint: "160,190,220", glowAt: "50% 35%", opacity: 0.3 }}>
        <Reveal className="mx-auto max-w-3xl text-center">
          <BackToFeed />
          <p className="tabular-nums text-[12px] text-fg-3">{t("X-Ray · every pump.fun, LaunchLab, Meteora, four.meme, Flap and Clanker trade, read live from Solana, BNB Chain and Base")}</p>
          <h1 className="font-display mt-4 text-5xl leading-[1.02] sm:text-6xl md:text-7xl">
            {t("See who you are")}
            <br />
            <span className="accent">{t("buying from.")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[15px] font-normal leading-relaxed text-fg-4">
            {t("The wallets that got in during the first five seconds, and who they are across every launch of the last two days: the creator's own crew, sniper rings, serial snipers. Who paid for the creator. How much of the volume is churn.")}
          </p>
        </Reveal>
        <Reveal delay={0.15}>
          <form onSubmit={submit} className="bg-night-surface border border-white/[0.08] mx-auto mt-10 flex max-w-2xl flex-col gap-2 rounded-2xl p-2 sm:flex-row sm:rounded-full">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              name="mint"
              placeholder={t("token address: pump.fun, LaunchLab, Meteora, four.meme, Flap, Clanker")}
              spellCheck={false}
              autoComplete="off"
              className="font-mono min-w-0 flex-1 bg-transparent px-5 py-3 text-[14px] text-white outline-none placeholder:text-fg-4"
              aria-label={t("Token address")}
            />
            <button type="submit" disabled={busy} className="rounded-full bg-white px-7 py-3 text-[14px] font-medium text-black transition hover:bg-white/90 disabled:opacity-60">
              {busy ? t("Reading the chain…") : t("X-ray it")}
            </button>
          </form>
          {error && (
            <p className="mt-4 text-center text-[13px] text-[#ff8a7e]">
              {error}
              {retry && (
                <button type="button" onClick={() => void run(retry)} disabled={busy} className="ml-3 font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white disabled:opacity-60">
                  {t("Try again")}
                </button>
              )}
            </p>
          )}
        </Reveal>
      </Section>
      <AnimatePresence mode="wait">{report && <Report key={report.mint} r={report} onPick={(m) => { setInput(m); window.scrollTo({ top: 0, behavior: "smooth" }); void run(m); }} />}
        {wallet && !report && <WalletProfile key={wallet} wallet={wallet} onWallet={showWallet} onToken={(m) => { setInput(m); window.scrollTo({ top: 0, behavior: "smooth" }); void run(m); }} />}</AnimatePresence>
      {!report && !wallet && !busy && <Start onPick={(m) => { setInput(m); void run(m); }} />}
    </>
  );
}

/** Back to the live feed, when the reader came from it. */
function BackToFeed() {
  const [back] = useState(() => {
    try {
      return sessionStorage.getItem("zoo-back");
    } catch {
      return null;
    }
  });
  if (back !== "/feed") return null;
  return (
    <a href="/feed" className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] px-4 py-1.5 text-[13px] text-fg-2 transition hover:text-white">
      <span aria-hidden>‹</span> {t("Back to the live feed")}
    </a>
  );
}
