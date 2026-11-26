import "./xray.css";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { chainOf, rememberChains } from "../../chain";
import { t } from "../../i18n";
import { short } from "../../format";
import { ZOOAGENCY_CLAWPUMP_URL } from "../../links";
import WalletProfile from "../WalletProfile";
import type { XRayReport } from "./types";
import { mintIn, NORTH, venueLabel } from "./shared";
import { Start } from "./Start";
import { useMarket } from "./Market";
import { callsLine, useCalls } from "./Calls";
import { useAccess, useFreeDeepCheck } from "./access";
import { ClaimsPanel } from "./Claims";
import { playIntro } from "./motion";
import { CopyCa, DevPanel, FactorsPanel, FirstPanel, OddsPanel, ProPanel, RightNowPanel, SetupPanel, SharePanel, TokenPanel, TracePanel, TradeStrip, VerdictPanel } from "./Panels";
import { BundlesSection, CallsSection, DevSection, FirstSection, HoldersSection, SetupSection, SolSection, TraceSection, WalletsSection } from "./Sections";
import { type Ctx, DEEP_SECS, ICONS, Logo, oddsPct, type Sec, SEC_NAME, secOf } from "./ui";
export { KIND, kindOf } from "../XRayRadar";
export type { Early, Odds, Verdict, XRayReport } from "./types";
export { TONE } from "./shared";

const REPORT_SECS: Sec[] = ["overview", "dev", "first", "setup", "bundles", "holders", "calls"];

/** One token, seen through, laid out as a dashboard: who got in first, who they are, who paid for the creator. */
export default function XRay() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  const [report, setReport] = useState<XRayReport | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [wallet, setWallet] = useState<string | null>(null);
  const [sec, setSec] = useState<Sec>(() => secOf(new URLSearchParams(location.search).get("tab")));
  const [scrolled, setScrolled] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const access = useAccess(report);
  const free = useFreeDeepCheck(report?.mint ?? null);
  const market = useMarket(report?.mint ?? null);
  const calls = useCalls(report?.mint ?? null, access.deep && sec === "calls");

  // The dashboard is its own screen: the page behind it does not scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    if (!report) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [report]);
  // Live: buys, sells, buyers and the dev's selling move with every trade the node reads. The plain check (no RPC, its
  // own generous limit) is read every 5 s while the tab is visible and its chain facts replace the report's; the
  // verdict and the deep reads stay as the x-ray gave them.
  const liveMint = report && !report.outsideStream && !report.fromHistory && !report.pool ? report.mint : null;
  useEffect(() => {
    if (!liveMint) return;
    let gone = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch(`${NORTH}/v1/check/${liveMint}`).catch(() => null);
      if (gone || !r || r.status !== 200) return;
      const b = (await r.json().catch(() => null)) as { facts?: XRayReport["check"]["facts"]; stream?: XRayReport["check"]["stream"]; birth?: XRayReport["birth"] } | null;
      if (gone || !b?.facts) return;
      setReport((cur) => (cur && cur.mint === liveMint ? { ...cur, check: { ...cur.check, facts: b.facts!, stream: b.stream ?? cur.check.stream }, ...(b.birth ? { birth: b.birth } : {}) } : cur));
      setReadAt(Date.now());
    };
    const id = setInterval(() => void tick(), 5_000);
    return () => {
      gone = true;
      clearInterval(id);
    };
  }, [liveMint]);
  // ⌘K / Ctrl+K puts the cursor in the search.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        field.current?.focus();
        field.current?.select();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const toTop = () => root.current?.scrollTo({ top: 0, behavior: "smooth" });

  const showWallet = (w: string) => {
    setReport(null);
    setError(null);
    setInput(w);
    setWallet(w);
    history.pushState(null, "", `/xray?wallet=${w}`);
    toTop();
  };
  useEffect(() => {
    const on = (e: Event) => showWallet((e as CustomEvent<string>).detail);
    window.addEventListener("zoo-wallet", on);
    return () => window.removeEventListener("zoo-wallet", on);
  }, []);

  // Each run gets a number; an answer that comes back after a newer run started is dropped, not shown.
  const runSeq = useRef(0);
  const run = async (mint: string, keepSec = false) => {
    const seq = ++runSeq.current;
    const stale = () => seq !== runSeq.current;
    setBusy(true);
    setError(null);
    setRetry(null);
    setWallet(null);
    if (!keepSec) setSec("overview");
    try {
      const r = await fetch(`${NORTH}/v1/xray/${mint}`).catch(() => null);
      if (stale()) return;
      if (!r) {
        setRetry(mint);
        setError(t("The chain reader did not answer. Try again in a minute."));
        return;
      }
      const body = (await r.json().catch(() => ({}))) as XRayReport & { error?: string; chain?: string };
      if (stale()) return;
      rememberChains(body);
      // Launched before the stream watched: the node is reading it from the chain now, and opens it when done.
      if (r.status === 202) {
        const eta = Math.max(2, Math.min(30, Number((body as { etaSec?: number }).etaSec) || 10));
        setReport(null);
        setRetry(mint);
        setError(t("Reading this coin from the chain, about {n} s. It opens here when done, and is followed live from then on.", { n: eta }));
        window.setTimeout(() => {
          if (!stale()) void run(mint, true);
        }, eta * 1000);
        return;
      }
      if (r.ok && !body.check) {
        setRetry(mint);
        setError(t("The chain reader did not answer. Try again in a minute."));
        return;
      }
      if (r.status === 429 || r.status >= 500) {
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
      if (!r.ok) throw new Error(body.error ? t("Not a launch or a wallet the stream saw in the last two days (pump.fun, LaunchLab, Meteora, Raydium).") : t("Something went wrong."));
      setReport(body);
      setReadAt(Date.now());
      const tab = new URLSearchParams(location.search).get("tab");
      history.pushState(null, "", `/xray?mint=${mint}${keepSec && tab ? `&tab=${encodeURIComponent(tab)}` : ""}`);
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
      setSec(secOf(q.get("tab")));
      if (w) {
        setInput(w);
        setReport(null);
        setWallet(w);
      } else if (mint) {
        setInput(mint);
        void run(mint, true);
      }
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const pick = (m: string) => {
    setInput(m);
    toTop();
    void run(m);
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const mint = mintIn(input) ?? mintIn(String(new FormData(e.currentTarget).get("mint") ?? ""));
    if (!mint) return setError(t("Paste a token address or link."));
    void run(mint);
  };

  const go = useCallback(
    (s: Sec, anchor?: string) => {
      setSec(s);
      if (report) history.replaceState(null, "", `/xray?mint=${report.mint}${s === "overview" ? "" : `&tab=${s}`}`);
      requestAnimationFrame(() => {
        const el = anchor ? document.getElementById(anchor) : null;
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        else root.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
    },
    [report],
  );
  const toPro = () => go(DEEP_SECS.includes(sec) ? sec : "overview", "pro");
  const unlock = () => {
    if (free.left) void free.run();
    else toPro();
  };

  // The one entrance sequence, the first time a report's overview is on screen.
  useEffect(() => {
    if (!report || busy || sec !== "overview" || !grid.current) return;
    const el = grid.current;
    const o = report.check.odds;
    const id = requestAnimationFrame(() => playIntro(el, report.mint, o ? { to: o.run, fmt: (v) => oddsPct(v) } : null));
    return () => cancelAnimationFrame(id);
  }, [report, busy, sec]);

  const r = busy ? null : report;
  const ctx: Ctx | null = r ? { r, access, market, calls, go, onPick: pick, unlock } : null;
  const rec = r?.creatorRecord;
  const f = r?.check.facts;
  const devBad = !!r && ((rec?.dumped ?? 0) >= 2 || (f?.creatorSoldPct ?? 0) >= 50);
  const callCount = calls ? calls.callouts.length + calls.theses.length : null;
  const line = r ? callsLine(r, calls) : null;
  const stream = r?.check.stream;
  const ago = stream ? stream.lastEventSecAgo + Math.max(0, Math.round((now - readAt) / 1000)) : 0;
  const fit = r?.check.odds?.fit ? new Date(r.check.odds.fit).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;

  const count: Partial<Record<Sec, { n: string; bad?: boolean }>> = r
    ? {
        dev: rec ? { n: rec.dumped.toLocaleString("en-US"), bad: devBad } : undefined,
        first: r.early.length ? { n: String(r.early.length) } : undefined,
        calls: callCount !== null ? { n: String(callCount), bad: line?.bad } : undefined,
      }
    : {};
  const href = (s: Sec) => (report ? `/xray?mint=${report.mint}${s === "overview" ? "" : `&tab=${s}`}` : "/xray");
  const navLink = (s: Sec) => (
    <a
      key={s}
      href={href(s)}
      className={r && sec === s ? "on" : ""}
      aria-current={r && sec === s ? "page" : undefined}
      data-empty={!report || undefined}
      title={!report ? t("Paste a token first") : undefined}
      onClick={(e) => {
        e.preventDefault();
        if (!report) {
          // No token yet: point at the search instead of doing nothing.
          const f = field.current;
          f?.focus();
          const form = f?.closest("form");
          form?.classList.remove("x-nudge");
          void form?.getBoundingClientRect();
          form?.classList.add("x-nudge");
          return;
        }
        go(s);
      }}
    >
      {ICONS[s]}
      {t(SEC_NAME[s])}
      {DEEP_SECS.includes(s) && !access.deep ? <span className="x-lk">{t("Pro")}</span> : count[s] ? <span className={`x-ct ${count[s]!.bad ? "x-d" : ""}`}>{count[s]!.n}</span> : null}
    </a>
  );

  return (
    <div className="xr2" ref={root} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
      <aside className="x-side">
        <a className="x-logo" href="/" aria-label={t("ZOOAI home")}>
          <Logo />
        </a>
        <div className="x-grp">{t("Report")}</div>
        <nav className="x-navl" aria-label={t("Report sections")}>
          {REPORT_SECS.map(navLink)}
        </nav>
        <div className="x-grp">{t("Deep check")}</div>
        <nav className="x-navl" aria-label={t("Deep check sections")}>
          {DEEP_SECS.map(navLink)}
        </nav>
        <div className="x-grp">ZOO</div>
        <nav className="x-navl" aria-label={t("Site")}>
          <a href="/feed">{ICONS.feed}{t("Live feed")}</a>
          <a href="/contests">{ICONS.contests}{t("Contests")}</a>
          <a href="/x402">{ICONS.api}{t("API & x402")}</a>
        </nav>
        <div className="x-sp" />
        <div className="x-tokc">
          <div className="x-h">
            <span className="x-tk" />
            $ZOOAGENCY
          </div>
          <p><a href="/token" style={{ color: "inherit" }}>{t("Buybacks, holder perks and Pro: what it does")} →</a></p>
          <CopyCa id="x-ca" />
          <a className="x-buy" href={ZOOAGENCY_CLAWPUMP_URL} target="_blank" rel="noopener noreferrer">
            {t("Buy on ClawPump")}
          </a>
        </div>
        <div className="x-status">
          <div>
            <span>{t("Chain stream")}</span>
            <b>
              <span className={`x-dot ${stream && !stream.live ? "off" : ""}`} />
              {stream ? (stream.live ? t("live") : t("paused")) : t("waiting")}
            </b>
          </div>
          <div>
            <span>{t("Odds model")}</span>
            <b>{fit ? t("fit {d}", { d: fit }) : "-"}</b>
          </div>
          <div>
            <span>{t("Your limit")}</span>
            <b>{access.perMinute ? t("{n} x-rays / min", { n: access.perMinute }) : "-"}</b>
          </div>
        </div>
      </aside>

      <div className="x-main">
        <header className={`x-bar ${scrolled ? "on" : ""}`}>
          <div className="x-crumb">
            X-Ray {r && <><span>/</span> <b>${r.symbol.replace(/^\$/, "")}</b></>}
            {r && sec !== "overview" && <><span>/</span> <span>{t(SEC_NAME[sec])}</span></>}
          </div>
          <form className="x-search" onSubmit={submit} role="search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input ref={field} name="mint" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("token address or wallet")} aria-label={t("Token address")} spellCheck={false} autoComplete="off" />
            {busy ? <span className="x-kbd">{t("reading")}</span> : input && mintIn(input) && mintIn(input) !== report?.mint ? <button type="submit" className="x-go">{t("X-ray")}</button> : <span className="x-kbd">⌘K</span>}
          </form>
          <span className="x-barsp" />
          {r && stream && (
            <span className="x-upd">
              <span className={`x-pulse ${stream.live ? "" : "off"}`} />
              <span>{stream.live ? t("read {s}s ago", { s: ago }) : t("stream paused")}</span>
            </span>
          )}
          {access.pro ? (
            <span className="x-protag">{t("Pro")}</span>
          ) : (
            <a className="x-gopro" href="#pro" onClick={(e) => { e.preventDefault(); if (r) toPro(); }}>
              {t("Go Pro")}
            </a>
          )}
        </header>

        <div className="x-grid" ref={grid}>
          {error && (
            <section className="x-pn x-s12" role="alert">
              <div className="x-err">
                <p>{error}</p>
                {retry && (
                  <button type="button" className="x-btn" onClick={() => void run(retry, true)} disabled={busy}>
                    {t("Try again")}
                  </button>
                )}
              </div>
            </section>
          )}
          {busy && <Skeleton />}
          {!busy && wallet && !report && (
            <div className="x-s12" style={{ minWidth: 0 }}>
              <WalletProfile key={wallet} wallet={wallet} onWallet={showWallet} onToken={pick} />
            </div>
          )}
          {!busy && !report && !wallet && <Start onPick={pick} />}
          {ctx && sec === "overview" && (
            <>
              <VerdictPanel {...ctx} />
              <OddsPanel {...ctx} />
              <RightNowPanel {...ctx} />
              <DevPanel {...ctx} />
              <SetupPanel {...ctx} />
              <FirstPanel {...ctx} />
              <TracePanel {...ctx} />
              <ProPanel access={access} />
              <TradeStrip {...ctx} />
              <ClaimsPanel r={ctx.r} span="x-s12" />
              <FactorsPanel r={ctx.r} />
              <SharePanel r={ctx.r} />
            </>
          )}
          {ctx && sec === "dev" && <DevSection {...ctx} />}
          {ctx && sec === "first" && <FirstSection {...ctx} />}
          {ctx && sec === "setup" && <SetupSection {...ctx} />}
          {ctx && sec === "bundles" && <BundlesSection {...ctx} />}
          {ctx && sec === "holders" && <HoldersSection {...ctx} />}
          {ctx && sec === "calls" && <CallsSection {...ctx} />}
          {ctx && sec === "trace" && <TraceSection {...ctx} />}
          {ctx && sec === "sol" && <SolSection {...ctx} />}
          {ctx && sec === "wallets" && <WalletsSection {...ctx} />}
          {ctx && sec !== "overview" && <TradeStrip {...ctx} />}
          <TokenPanel />
        </div>
        {r && <HowWeKnow r={r} />}
      </div>
    </div>
  );
}

/** Loading: the overview's own panels, empty, at their real sizes, so nothing jumps when the answer lands. */
function Skeleton() {
  const bars = (n: number, h = 12) => (
    <div style={{ display: "grid", gap: 10 }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="x-sk" style={{ height: h, width: `${90 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
  const P = ({ span, title, h }: { span: string; title: string; h: number }) => (
    <section className={`x-pn ${span}`} aria-busy="true">
      <div className="x-ph">
        <h2>{title}</h2>
        <span className="x-m">{t("reading the chain…")}</span>
      </div>
      <div className="x-pb" style={{ minHeight: h }}>
        {bars(Math.max(3, Math.round(h / 40)))}
      </div>
    </section>
  );
  return (
    <>
      <section className="x-pn x-s5" aria-busy="true">
        <div className="x-ph">
          <h2>{t("Verdict")}</h2>
          <span className="x-m">{t("reading the chain…")}</span>
        </div>
        <div className="x-pb" style={{ minHeight: 360 }}>
          <div className="x-sk" style={{ height: 14, width: "55%" }} />
          <div className="x-sk" style={{ height: 56, width: "48%", margin: "18px 0 14px" }} />
          {bars(6)}
        </div>
      </section>
      <P span="x-s3" title={t("Odds")} h={360} />
      <P span="x-s4" title={t("Right now")} h={360} />
      <P span="x-s8" title={t("The dev")} h={280} />
      <P span="x-s4" title={t("Launch setup")} h={280} />
    </>
  );
}

/** How the report knows what it says, the raw link, and that it is not advice. */
function HowWeKnow({ r }: { r: XRayReport }) {
  const evm = chainOf(r.mint) !== "solana";
  const venue = r.pool ? "PumpSwap" : venueLabel(r.check.facts);
  const text = r.birth?.adopted
    ? t("How we know: this coin launched before our stream watched. When it was first asked about, its pool, who opened it and its latest trades were read from the chain; every trade since is read live as it happens.")
    : r.pool
    ? t("How we know: this token trades in a pool opened straight on PumpSwap, which the launchpad stream does not read. Who opened the pool, the SOL that went in and came out, and a draw of its trades are read from the pool's own transactions.")
    : r.outsideStream
      ? t("How we know: who holds it now is read from the chain at check time; the dev's record is what the stream kept of their earlier launches. What happened when this coin launched was before our two-day window.")
      : r.fromHistory
        ? t("How we know: this coin was read from the chain as it launched and kept in the long memory, where a launch stays 90 days; this is its record as it stood when last written.")
        : evm
          ? t("How we know: every {venue} launch, buy and sell read from the chain as it happens, kept 48 hours on the live tape and 90 days in the long memory.", { venue })
          : t("How we know: every pump.fun, LaunchLab and Meteora transaction read from Solana as it happens, kept 48 hours on the live tape and 90 days in the long memory. Who paid for the dev is traced from the dev wallet's own transfers.");
  return (
    <div className="x-foot">
      <span>{text}</span>
      <a className="x-link x-mono" href={`${NORTH}/v1/xray/${r.mint}`}>
        /v1/xray/{short(r.mint)}
      </a>
      <span>{t("Not financial advice.")}</span>
    </div>
  );
}
