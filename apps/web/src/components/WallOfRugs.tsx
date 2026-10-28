import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Reveal, Section, SectionHead } from "./ui";
import { t, tChain } from "../i18n";
import { rememberChain } from "../chain";

const goWallet = (w: string) => { window.history.pushState(null, "", `/xray?wallet=${w}`); window.dispatchEvent(new PopStateEvent("popstate")); };

interface Rugger {
  wallet: string;
  launches24h: number;
  launches48h: number;
  dumped: number;
  medianDumpMin: number | null;
  recent: Array<{ mint: string; symbol: string; dumpedAfterMin: number | null }>;
  lastDump: { symbol: string; text: string; tx?: string; at: number; mint: string } | null;
  chain?: "solana" | "bsc" | "base";
}
const CHAINS: Array<{ id: "" | "solana" | "bsc" | "base"; label: string }> = [
  { id: "", label: "All" },
  { id: "solana", label: "Solana" },
  { id: "bsc", label: "BNB Chain" },
  { id: "base", label: "Base" },
];
const CHAIN_SHORT = { solana: "SOL", bsc: "BNB", base: "BASE" } as const;

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** The devs who dump the most of their own launches, read from the chain, each with a transaction to check. */
export default function WallOfRugs() {
  const [list, setList] = useState<Rugger[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [chain, setChain] = useState<"" | "solana" | "bsc" | "base">("");

  useEffect(() => {
    const load = () =>
      fetch(`${NORTH}/v1/chain/ruggers?limit=25${chain ? `&chain=${chain}` : ""}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { ruggers: Rugger[] } | null) => b && setList(b.ruggers))
        .catch(() => {});
    void load();
    const t = window.setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [chain]);

  return (
    <Section className="overflow-x-clip !pt-32 sm:!pt-40" backdrop={{ glowAt: "70% 10%" }}>
      <SectionHead
        eyebrow={t("Wall of rugs · last 48 hours · Solana, BNB Chain and Base")}
        title={[t("The devs who dump"), t("their own tokens.")]}
        text={t("Creator wallets ranked by how many of their own launches they sold half or more of, on pump.fun, four.meme, Flap and Clanker. Every row links to a real transaction. Check your dev before you buy.")}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {CHAINS.map((c) => (
          <button key={c.id || "all"} type="button" onClick={() => (setList(null), setChain(c.id))} className={`rounded-full px-4 py-1.5 text-[13px] transition ${chain === c.id ? "bg-white text-black" : "border border-white/[0.12] text-fg-3 hover:text-white"}`}>
            {t(c.label)}
          </button>
        ))}
      </div>
      <Reveal className="bg-night-surface border border-white/[0.08] overflow-hidden rounded-2xl">
        <div className="tabular-nums grid grid-cols-[2rem_minmax(0,1fr)_4rem_4rem] gap-3 border-b border-white/[0.08] px-5 py-3 text-[12px] text-fg-4 sm:grid-cols-[2.5rem_minmax(0,12rem)_6rem_6rem_6rem_minmax(0,1fr)] sm:px-7">
          <span>#</span>
          <span>{t("dev wallet")}</span>
          <span className="text-right">{t("launched")}</span>
          <span className="text-right">{t("dumped")}</span>
          <span className="hidden text-right sm:block">{t("median")}</span>
          <span className="hidden sm:block">{t("latest dump")}</span>
        </div>
        {!list && <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t("Reading the chain…")}</p>}
        {list && list.length === 0 && <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t("No serial dumpers in the last two days yet. The stream fills this as it watches.")}</p>}
        {list?.map((r, i) => (
          <div
            key={r.wallet}
            role="link"
            tabIndex={0}
            onClick={() => (rememberChain(r.wallet, r.chain), goWallet(r.wallet))}
            onKeyDown={(e) => e.key === "Enter" && (rememberChain(r.wallet, r.chain), goWallet(r.wallet))}
            title={t("Open this dev's wallet")}
            className="tabular-nums grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)_4rem_4rem] items-center gap-3 border-t border-white/[0.08] px-5 py-3.5 text-[12.5px] transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.06] focus-visible:outline-none sm:grid-cols-[2.5rem_minmax(0,12rem)_6rem_6rem_6rem_minmax(0,1fr)] sm:px-7"
          >
            <span className="text-fg-4">{String(i + 1).padStart(2, "0")}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-fg underline decoration-white/20 underline-offset-4">{short(r.wallet)}</span>
              {r.chain && <span className="shrink-0 rounded-full border border-white/[0.12] px-1.5 text-[10.5px] text-fg-4">{CHAIN_SHORT[r.chain]}</span>}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void navigator.clipboard?.writeText(r.wallet).catch(() => {});
                  setCopied(r.wallet);
                  window.setTimeout(() => setCopied(null), 1200);
                }}
                className="shrink-0 text-[11.5px] text-fg-4 hover:text-white"
                title={t("Copy the wallet")}
              >
                {copied === r.wallet ? t("copied") : t("copy")}
              </button>
            </span>
            <span className="text-right text-fg-3">{r.launches48h}</span>
            <span className="text-right text-[#ff8a7e]">{r.dumped}</span>
            <span className="hidden text-right text-fg-4 sm:block">{r.medianDumpMin === null ? "-" : t("{m} min", { m: r.medianDumpMin })}</span>
            <span className="hidden truncate sm:block">
              {r.lastDump ? (
                <a href={`/xray?mint=${r.lastDump.mint}`} onClick={(e) => e.stopPropagation()} className="text-fg-3 underline decoration-white/20 underline-offset-4 hover:text-white">
                  ${r.lastDump.symbol.replace(/^\$/, "")} · {tChain(r.lastDump.text)}
                </a>
              ) : (
                <span className="text-fg-4">-</span>
              )}
            </span>
          </div>
        ))}
      </Reveal>
      <Builders />
      <ReusedAccounts />
      <p className="tabular-nums mt-4 text-center text-[12.5px] text-fg-4">
        {t("check any dev:")} <a href="/ask" className="underline decoration-white/25 underline-offset-4 hover:text-white">{t("ask the beaver")}</a> · {t("raw:")}{" "}
        <a href={`${NORTH}/v1/chain/ruggers`} className="underline decoration-white/25 underline-offset-4 hover:text-white">/v1/chain/ruggers</a>
      </p>
    </Section>
  );
}

interface Account {
  social: { kind: string; url: string; label: string };
  launches: number;
  fastDumps: number;
  creators: number;
  recent: Array<{ mint: string; symbol: string; dumpedAfterMin: number | null }>;
}

/**
 * The X accounts, X communities and Telegram groups that keep coming back on launches whose dev sold within minutes.
 * Facts from each token's own metadata and the chain, never a verdict on a person.
 */
interface Builder {
  wallet: string;
  launches48h: number;
  grew: number;
  graduated: number;
  dumped: number;
  recent: Array<{ mint: string; symbol: string; createdAt: number; alive: boolean; graduated: boolean }>;
}

/** The other side of the wall: devs whose launches actually grew and stayed alive, and who did not dump them. */
function Builders() {
  const [list, setList] = useState<Builder[] | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(`${NORTH}/v1/chain/builders?limit=15`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { builders: Builder[] } | null) => b && setList(b.builders))
        .catch(() => {});
    void load();
    const t = window.setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (list && list.length === 0) return null;
  return (
    <div className="mt-16">
      <SectionHead
        eyebrow={t("Builders · last 48 hours · read from Solana")}
        title={[t("The devs whose tokens"), t("actually grew.")]}
        text={t("The other side of the list: dev wallets with launches that graduated and still hold liquidity, where the dev has not dumped. Rare. A track record, not a promise.")}
      />
      <Reveal className="bg-night-surface border border-white/[0.08] overflow-hidden rounded-2xl">
        <div className="tabular-nums grid grid-cols-[2rem_minmax(0,1fr)_4rem_4rem] gap-3 border-b border-white/[0.08] px-5 py-3 text-[12px] text-fg-4 sm:grid-cols-[2.5rem_minmax(0,12rem)_5rem_6rem_5rem_minmax(0,1fr)] sm:px-7">
          <span>#</span>
          <span>{t("dev wallet")}</span>
          <span className="text-right">{t("launched")}</span>
          <span className="text-right">{t("still alive")}</span>
          <span className="hidden text-right sm:block">{t("dumped")}</span>
          <span className="hidden sm:block">{t("latest launches")}</span>
        </div>
        {!list && <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t("Reading the chain…")}</p>}
        {list?.map((r, i) => (
          <div key={r.wallet} className="tabular-nums grid grid-cols-[2rem_minmax(0,1fr)_4rem_4rem] items-center gap-3 border-t border-white/[0.08] px-5 py-3.5 text-[12.5px] sm:grid-cols-[2.5rem_minmax(0,12rem)_5rem_6rem_5rem_minmax(0,1fr)] sm:px-7">
            <span className="text-fg-4">{String(i + 1).padStart(2, "0")}</span>
            <button type="button" onClick={() => goWallet(r.wallet)} className="truncate text-left text-fg-2 underline decoration-white/15 underline-offset-4 hover:text-white">
              {short(r.wallet)}
            </button>
            <span className="text-right text-fg-3">{r.launches48h}</span>
            <span className="text-right text-[#a6e3b4]">{r.grew}</span>
            <span className="hidden text-right text-fg-3 sm:block">{r.dumped}</span>
            <span className="hidden gap-1.5 overflow-hidden sm:flex">
              {r.recent.slice(0, 5).map((x) => (
                <button key={x.mint} type="button" onClick={() => { window.history.pushState(null, "", `/xray?mint=${x.mint}`); window.dispatchEvent(new PopStateEvent("popstate")); }} className={`shrink-0 truncate ${x.alive ? "text-fg-3" : "text-fg-4"} hover:text-white`} title={x.graduated ? t("graduated") : ""}>
                  ${x.symbol.replace(/^\$/, "")}
                </button>
              ))}
            </span>
          </div>
        ))}
      </Reveal>
      <p className="tabular-nums mt-4 text-center text-[12.5px] text-fg-4">
        {t("raw:")}{" "}
        <a href={`${NORTH}/v1/chain/builders`} className="underline decoration-white/25 underline-offset-4 hover:text-white">/v1/chain/builders</a>
      </p>
    </div>
  );
}

function ReusedAccounts() {
  const [list, setList] = useState<Account[] | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(`${NORTH}/v1/chain/socials?limit=25`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { accounts: Account[] } | null) => b && setList(b.accounts.filter((a) => a.fastDumps >= 2)))
        .catch(() => setList([]));
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="mt-16">
      <div className="mb-4 max-w-3xl">
        <p className="tabular-nums mb-2 text-[12.5px] text-fg-3">{t("same account, new token · last 48 hours")}</p>
        <h3 className="font-display text-3xl leading-tight">{t("The accounts behind repeat rugs.")}</h3>
        <p className="mt-3 text-[13.5px] font-normal leading-relaxed text-fg-4">
          {t("A rugger switches wallets for every launch. The X account or Telegram group on the token often stays the same. These are linked, in their own metadata, to several launches whose dev sold within 5 minutes.")}
        </p>
      </div>
      <Reveal className="bg-night-surface border border-white/[0.08] overflow-hidden rounded-2xl">
        <div className="tabular-nums grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-3 border-b border-white/[0.08] px-5 py-3 text-[12px] text-fg-4 sm:grid-cols-[minmax(0,14rem)_6rem_7rem_6rem_minmax(0,1fr)] sm:px-7">
          <span>{t("linked account")}</span>
          <span className="text-right">{t("launches")}</span>
          <span className="text-right">{t("dev sold ≤5 min")}</span>
          <span className="hidden text-right sm:block">{t("wallets")}</span>
          <span className="hidden sm:block">{t("tokens")}</span>
        </div>
        {!list && <p className="px-7 py-8 text-center text-[13px] text-fg-3">{t("Reading the chain…")}</p>}
        {list && list.length === 0 && <p className="px-7 py-8 text-center text-[13px] text-fg-3">{t("None yet: the reader fills this as new launches come in.")}</p>}
        {list?.map((a) => (
          <div key={a.social.url} className="tabular-nums grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-3 border-t border-white/[0.08] px-5 py-3 text-[12.5px] sm:grid-cols-[minmax(0,14rem)_6rem_7rem_6rem_minmax(0,1fr)] sm:px-7">
            <a href={a.social.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-fg-2 hover:text-white">
              {a.social.label} ↗
            </a>
            <span className="text-right text-fg-3">{a.launches}</span>
            <span className="text-right text-[#ff8a7e]">{a.fastDumps}</span>
            <span className="hidden text-right text-fg-4 sm:block">{a.creators}</span>
            <span className="hidden truncate text-fg-4 sm:block">
              {a.recent.slice(0, 4).map((r, i) => (
                <a key={r.mint} href={`/xray?mint=${r.mint}`} className="hover:text-white">
                  {i ? " · " : ""}${r.symbol}
                </a>
              ))}
            </span>
          </div>
        ))}
      </Reveal>
      <p className="mt-3 text-[13px] font-normal text-fg-4">
        {t("Facts from each token's metadata and the chain, not a judgement of any person. Think one is listed by mistake? Write to x.com/zooclawagency.")}
      </p>
    </div>
  );
}
