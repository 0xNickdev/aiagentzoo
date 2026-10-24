import { AnimatePresence, motion } from "framer-motion";
import { Download } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { X_URL, XIcon } from "../links";
import { nodeOf, useGuardian } from "../zoo";
import { Reveal, Section } from "./ui";
import { lang, pick, t, t as tr } from "../i18n";
import { type LaunchOutcome, launchOutcome } from "../outcome";

type Verdict = "promising" | "watch" | "suspicious";
type Outcome = "dead" | "alive" | "unknown";

interface Chain {
  ageMin: number;
  buys: number;
  sells: number;
  buyers: number;
  buyersMore?: boolean;
  creatorSold: number | null;
  creatorLaunches24h: number;
  top5Share: number | null;
  repeatBuyers: number;
}

interface CreatorRecord {
  wallet: string;
  launches24h: number;
  launches48h: number;
  dumped: number;
  medianDumpMin: number | null;
  graduated: number;
  recent: Array<{ mint: string; symbol: string; createdAt: number } & LaunchOutcome>;
}

interface CleanLaunch {
  mint: string;
  symbol: string;
  name: string;
  ageMin: number;
  buyers: number;
  buyersMore?: boolean;
  repeatBuyers: number;
  top5Share: number | null;
  creatorSold: number | null;
}

interface Ask {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  at: number;
  verdict: Verdict;
  confidence: number;
  why: string;
  whyZh?: string;
  by: "model" | "rules";
  playbookVersion: number;
  already: boolean;
  facts: {
    graduated: boolean;
    hasSocials: boolean | null;
    market: { liquidityUsd: number | null; volume24hUsd: number | null; priceChange24h: number | null; buys24h: number; sells24h: number; dex: string | null } | null;
    chain: Chain | null;
    creator?: CreatorRecord | null;
    bundle?: { wallets: number; share: number; linked: number; funder: string | null } | null;
    holders?: { top10Share: number; topShare: number; programShare: number; creator: string | null; creatorShare: number | null } | null;
    flags: string[];
    url: string | null;
  };
  graded?: { at: number; outcome: Outcome; hit: boolean | null };
}

interface Recent {
  asked: number;
  record: { graded: number; skill: number | null; dead: number; deadRight: number; alive: number; aliveRight: number };
  asks: Ask[];
}

const TONE: Record<Verdict, { label: string; color: string; text: string }> = {
  suspicious: { label: "SUSPICIOUS", color: "#ff7a6e", text: "text-[#ff8a7e]" },
  watch: { label: "WATCH", color: "#e9e4d8", text: "text-fg-2" },
  promising: { label: "PROMISING", color: "#8ff0a4", text: "text-[#9df3b0]" },
};

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`;
const pctOf = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${Math.round(n * 100)}%`);

/** Any Solana address inside whatever was pasted: a bare mint, a pump.fun or DexScreener link. */
const mintIn = (text: string) => text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null;

/** The evidence the beaver saw, as short lines. */
function evidence(a: Ask): Array<[string, string, boolean]> {
  const out: Array<[string, string, boolean]> = [];
  const c = a.facts.chain;
  const m = a.facts.market;
  if (c?.creatorSold !== null && c?.creatorSold !== undefined) out.push(["creator sold", pctOf(c.creatorSold), c.creatorSold >= 0.5]);
  const r = a.facts.creator;
  if (r) out.push(["creator dumped (48h)", t("{a} of {b}", { a: r.dumped, b: r.launches48h }), r.launches48h >= 3 && r.dumped >= Math.ceil(r.launches48h / 2)]);
  if (c) out.push(["creator's launches today", String(c.creatorLaunches24h), c.creatorLaunches24h >= 5]);
  const h = a.facts.holders;
  if (h) {
    out.push(["top 10 wallets hold", pctOf(h.top10Share), h.top10Share >= 0.5]);
    if (h.creatorShare !== null) out.push(["dev still holds", pctOf(h.creatorShare), h.creatorShare >= 0.1]);
  }
  const b = a.facts.bundle;
  if (b) out.push(["bundle at launch", `${t("{n} wallets", { n: b.wallets })} · ${pctOf(b.share)}${b.linked >= 2 ? ` · ${t("{n} same funder", { n: b.linked })}` : ""}`, b.wallets >= 3 || b.linked >= 2]);
  else if (c?.top5Share !== null && c?.top5Share !== undefined) out.push(["top 5 buyers' share", pctOf(c.top5Share), c.top5Share >= 0.6]);
  if (c && !r) out.push(["buyers · repeat", `${c.buyers}${c.buyersMore ? "+" : ""} · ${c.repeatBuyers}`, false]);
  if (m) {
    out.push(["liquidity", usd(m.liquidityUsd), (m.liquidityUsd ?? 0) < 1000]);
    out.push(["volume 24h", usd(m.volume24hUsd), false]);
    out.push(["buys · sells 24h", `${m.buys24h} · ${m.sells24h}`, m.sells24h > m.buys24h * 3]);
    out.push(["change 24h", m.priceChange24h === null ? "-" : `${m.priceChange24h > 0 ? "+" : ""}${Math.round(m.priceChange24h)}%`, (m.priceChange24h ?? 0) <= -80]);
  }
  out.push(["socials", t(a.facts.hasSocials === null ? "unknown" : a.facts.hasSocials ? "yes" : "none"), a.facts.hasSocials === false]);
  // Nine cells fill the grid when the chain is there; without it, graduation fills the gap.
  if (!c) out.push(["graduated", t(a.facts.graduated ? "yes" : "no"), false]);
  return out;
}

/** The beaver's reason in the reader's language, when a Chinese one was written. */
const whyOf = (a: Ask) => (lang() === "zh" && a.whyZh ? a.whyZh : a.why);
const gradeDue = (a: Ask) => new Date(a.at + 24 * 3_600_000);
const when = (d: Date) => d.toLocaleString(lang() === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

function graded(a: Ask): string {
  if (!a.graded) return a.already ? t("already dead when asked · not scored") : t("re-checked against reality {when}", { when: when(gradeDue(a)) });
  const o = t(a.graded.outcome === "unknown" ? "outcome unclear" : a.graded.outcome === "dead" ? "it died" : "it lived");
  return a.graded.hit === null ? `${o} · ${t("not scored")}` : `${o} · ${t(a.graded.hit ? "the beaver was right" : "the beaver was wrong")}`;
}

/* ---------- the shareable card ---------- */

const W = 1200;
const H = 675;

async function drawCard(canvas: HTMLCanvasElement, a: Ask): Promise<void> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  await Promise.all([document.fonts.load('500 64px "Geist"'), document.fonts.load('300 24px "Geist"'), document.fonts.load('400 16px "Geist Mono"')]);
  ctx.fillStyle = "#030504";
  ctx.fillRect(0, 0, W, H);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = "/agents/beaver.webp";
    });
    const size = 520;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(img, W - size + 40, (H - size) / 2 + 30, size, size);
    ctx.globalAlpha = 1;
  } catch {
    // No portrait: plain night.
  }
  const shade = ctx.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, "rgba(3,5,4,0.98)");
  shade.addColorStop(0.6, "rgba(3,5,4,0.85)");
  shade.addColorStop(1, "rgba(3,5,4,0.2)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  const L = 72;
  const tone = TONE[a.verdict];
  const mono = (s: number) => `400 ${s}px "Geist Mono", ui-monospace, monospace`;
  ctx.font = mono(15);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillText(t("ZOOAI AGENCY · ASK THE BEAVER"), L, 86);

  ctx.font = '500 64px "Geist", sans-serif';
  ctx.fillStyle = "#fff";
  ctx.fillText(`$${a.symbol}`.slice(0, 18), L - 3, 166);
  ctx.font = mono(14);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillText(`${a.mint.slice(0, 6)}…${a.mint.slice(-6)}`, L, 196);

  ctx.font = '500 92px "Geist", sans-serif';
  ctx.fillStyle = tone.color;
  ctx.fillText(t(tone.label), L - 4, 310);
  ctx.font = mono(15);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillText(t("confidence {c}% · playbook v{v}", { c: Math.round(a.confidence * 100), v: a.playbookVersion }), L, 344);

  // The reason, wrapped to two lines.
  ctx.font = '300 27px "Geist", sans-serif';
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  const words = lang() === "zh" && a.whyZh ? Array.from(a.whyZh) : a.why.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    // Chinese wraps by character, with no spaces between.
    const next = line ? `${line}${lang() === "zh" && a.whyZh ? "" : " "}${w}` : w;
    if (ctx.measureText(next).width > 640 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => ctx.fillText(i === 2 && lines.length > 3 ? `${l}…` : l, L, 402 + i * 38));

  // Three facts across the bottom, between hairlines.
  const ev = evidence(a).filter(([, , bad]) => bad).concat(evidence(a).filter(([, , bad]) => !bad)).slice(0, 3);
  const top = 528;
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.beginPath();
  ctx.moveTo(L, top + 0.5);
  ctx.lineTo(L + 660, top + 0.5);
  ctx.stroke();
  ev.forEach(([k, v, bad], i) => {
    const x = L + i * 220;
    ctx.font = mono(24);
    ctx.fillStyle = bad ? "#ff8a7e" : "#fff";
    ctx.fillText(v, x, top + 40);
    ctx.font = mono(11);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(t(k).toUpperCase(), x, top + 62);
  });

  ctx.font = mono(14);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillText(t("graded against reality on {when} · zooaiagency.com/ask", { when: when(gradeDue(a)) }), L, H - 40);
}

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mint = mintIn(input);
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
          <p className="font-mono text-[12px] text-fg-3">{t("Ask the beaver · graded by reality tomorrow")}</p>
          <h1 className="font-display mt-4 text-5xl leading-[1.02] sm:text-6xl md:text-7xl">
            {t("Is it a rug?")}
            <br />
            <span className="accent">{t("Ask the beaver.")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[15px] font-light leading-relaxed text-fg-4">
            {t("Paste any Solana token, or a creator's wallet to see how often it rugs. The beaver judges a token with the same playbook it uses every night, from the market and, for fresh pump.fun tokens, straight from the chain.")}{" "}
            {t("Tomorrow its answer is checked against what the token actually did. Signed on the public log either way.")}
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <form onSubmit={submit} className="bg-night-surface border border-white/[0.08] mx-auto mt-10 flex max-w-2xl flex-col gap-2 rounded-2xl p-2 sm:flex-row sm:rounded-full">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
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
          <p className="font-mono mt-4 text-center text-[12.5px] text-fg-3">
            {!session ? (
              <>
                {t("holding $ZOOAGENCY?")}{" "}
                <button type="button" onClick={() => void signIn()} disabled={signing} className="text-warn underline decoration-amber-100/30 underline-offset-4 hover:text-amber-100">
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
          <p className="font-mono text-[12.5px] text-fg-3">{t("fresh pump.fun launches · live from the chain")}</p>
        </div>
        <p className="mb-5 max-w-3xl text-[13px] font-light leading-relaxed text-fg-3">
          {t("10 to 180 minutes old, the creator has not sold, the wallet is not a serial launcher, 25+ buyers with no five of them holding most of it, buys ahead of sells.")}{" "}
          {t("That only means the usual rug signs are absent so far. It is not a call and not advice; most of these still die. Ask the beaver before anything else.")}
        </p>
        {!clean ? (
          <p className="text-[13px] text-fg-3">{t("Reading the chain…")}</p>
        ) : clean.length === 0 ? (
          <p className="text-[13px] text-fg-3">{t("Nothing passes right now. On pump.fun that is a normal hour.")}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {clean.map((c) => (
              <li key={c.mint} className="rounded-2xl bg-black/40 px-4 py-3 ring-1 ring-white/10">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display truncate text-[17px]">${c.symbol}</span>
                  <span className="font-mono shrink-0 text-[12px] text-fg-4">{t("{n} min old", { n: c.ageMin })}</span>
                </div>
                <p className="font-mono mt-1 text-[12px] text-fg-3">
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
                  className="font-mono mt-2 text-[12.5px] text-warn underline decoration-amber-100/30 underline-offset-4 hover:text-amber-100 disabled:opacity-50"
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
            <p className="font-mono text-[12.5px] text-fg-3">
              {t("{n} asked · beaver on asks:", { n: recent.asked.toLocaleString("en-US") })}{" "}
              {recent.record.graded ? t("{p} balanced · {n} graded", { p: pctOf(recent.record.skill), n: recent.record.graded }) : t("first grades after a day")}
            </p>
          )}
        </div>
        {!recent?.asks.length ? (
          <p className="text-[13px] text-fg-3">{t("No questions yet. Be the first.")}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                    <span className={`font-mono shrink-0 text-[12.5px] ${TONE[a.verdict].text}`}>{t(TONE[a.verdict].label)}</span>
                  </div>
                  <p className="font-mono mt-1 truncate text-[12px] text-fg-4">{graded(a)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Answer({ a }: { a: Ask }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [png, setPng] = useState<string | null>(null);
  const tone = TONE[a.verdict];

  useEffect(() => {
    if (!canvas.current) return;
    setPng(null);
    void drawCard(canvas.current, a).then(() => setPng(canvas.current!.toDataURL("image/png")));
  }, [a]);

  const link = `zooaiagency.com/ask#${a.id}`;
  const tweet = encodeURIComponent(
    pick(
      [`asked the beaver about $${a.symbol}: ${tone.label.toLowerCase()}.`, a.why, "", `graded against reality tomorrow: ${link}`],
      [`问了海狸 $${a.symbol}：${t(tone.label)}。`, whyOf(a), "", `明天由市场打分：${link}`],
    ).join("\n"),
  );

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-5 pb-6 sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono truncate text-[12.5px] text-fg-4">
                {a.name ? `${a.name} · ` : ""}
                {a.mint}
              </p>
              <h2 className="font-display mt-1 text-4xl">${a.symbol}</h2>
            </div>
            {a.facts.url && (
              <a href={a.facts.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[12.5px] text-fg-3 underline decoration-white/20 underline-offset-4 hover:text-white">
                {t("chart ↗")}
              </a>
            )}
          </div>

          <p className="font-display mt-6 text-6xl leading-none sm:text-7xl" style={{ color: tone.color }}>
            {t(tone.label)}
          </p>
          <p className="font-mono mt-3 text-[12.5px] text-fg-3">
            {t("confidence {c}% · playbook v{v}", { c: Math.round(a.confidence * 100), v: a.playbookVersion })}
            {a.by === "rules" ? t(" · rules only, the model was busy") : ""}
          </p>
          <p className="mt-5 max-w-2xl text-[17px] font-light leading-relaxed text-fg-2">{whyOf(a)}</p>

          <dl className="font-mono mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06] text-[12px] sm:grid-cols-3">
            {evidence(a).map(([k, v, bad]) => (
              <div key={k} className="bg-[#070908] px-4 py-3">
                <dt className="text-fg-4">{t(k)}</dt>
                <dd className={`mt-1 text-[15px] ${bad ? "text-[#ff8a7e]" : "text-fg-2"}`}>{v}</dd>
              </div>
            ))}
          </dl>
          {a.facts.creator && (
            <div className="mt-6 rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/[0.06]">
              <CreatorBlock r={a.facts.creator} />
            </div>
          )}
          {!a.facts.chain && (
            <p className="mt-3 text-[12px] font-light text-fg-4">{t("No chain facts: this token launched before our pump.fun stream picked it up, so the beaver judged from the market alone.")}</p>
          )}

          <p className={`font-mono mt-6 text-[12px] ${a.graded?.hit === true ? "text-[#9df3b0]" : a.graded?.hit === false ? "text-[#ff8a7e]" : "text-warn"}`}>
            {a.graded ? "● " : "○ "}
            {graded(a)}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <canvas ref={canvas} className="hidden" />
          <div className="aspect-[16/9] overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
            {png ? <img src={png} alt={t("Card: the beaver on ${s}", { s: a.symbol })} className="h-full w-full" /> : <div className="h-full w-full animate-pulse bg-white/[0.03]" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={png ?? undefined}
              download={`beaver-${a.symbol}-${a.id}.png`}
              className={`inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-medium text-black ${png ? "hover:bg-white/90" : "pointer-events-none opacity-50"}`}
            >
              <Download size={14} /> {t("Download card")}
            </a>
            <a
              href={`https://x.com/intent/post?text=${tweet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-night-surface border border-white/[0.08] inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] text-fg hover:text-white"
              title={`Follow ${X_URL.replace("https://x.com/", "@")}`}
            >
              <XIcon size={13} /> {t("Post on X")}
            </a>
          </div>
          <p className="font-mono text-[12.5px] text-fg-4">
            {t("share:")} <span className="text-fg-3">{link}</span>
          </p>
          <p className="text-[13px] font-light text-fg-4">{t("Not financial advice. A verdict from public data, checked in public a day later.")}</p>
        </div>
      </div>
    </motion.section>
  );
}

/** A creator wallet's last two days, the way a trader asks: does this dev rug, and how fast. */
function CreatorBlock({ r, big = false }: { r: CreatorRecord; big?: boolean }) {
  const serial = r.launches48h >= 3 && r.dumped >= Math.ceil(r.launches48h / 2);
  return (
    <div>
      <p className="font-mono text-[12.5px] text-fg-4">
        {t("creator wallet · {w} · last 48h on pump.fun", { w: `${r.wallet.slice(0, 6)}…${r.wallet.slice(-6)}` })}
      </p>
      <p className={`font-display mt-2 ${big ? "text-4xl sm:text-5xl" : "text-2xl"} ${serial ? "text-[#ff8a7e]" : "text-white"}`}>
        {t(r.launches48h === 1 ? "{n} launch, dumped {d}" : "{n} launches, dumped {d}", { n: r.launches48h, d: r.dumped })}
        {r.medianDumpMin !== null ? t(", median {m} min", { m: r.medianDumpMin }) : ""}
      </p>
      <p className="font-mono mt-2 text-[12.5px] text-fg-3">
        {t("{a} in the last 24h · {g} graduated", { a: r.launches24h, g: r.graduated })}{serial ? t(" · a serial dumper") : ""}
      </p>
      {big && r.recent.length > 0 && (
        <ul className="font-mono mt-5 grid gap-1.5 text-[12px] sm:grid-cols-2">
          {r.recent.map((x) => (
            <li key={x.mint} className="flex justify-between gap-3 border-b border-dashed border-white/10 py-1.5">
              <span className="truncate text-fg-2">${x.symbol}</span>
              <span className={x.dumpedAfterMin !== null ? "text-[#ff8a7e]" : x.graduated ? "text-[#9df3b0]" : "text-fg-3"}>
                {[launchOutcome(x).head, launchOutcome(x).tail].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
