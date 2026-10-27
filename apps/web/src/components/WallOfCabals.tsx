import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Reveal, Section, SectionHead } from "./ui";
import { t } from "../i18n";
import { chainName } from "../chain";

/**
 * The wall of cabals: wallets the long memory ties together as one hand, through a shared funder, crew hits, sniping
 * together or a repeated launch block. Each set with its record, and the launches its creators have live right now.
 */

interface Member {
  wallet: string;
  launches: number;
  dumped: number;
  snipes: number;
  crewHits: number;
  bundleHits: number;
}
interface Cabal {
  id: number;
  wallets: number;
  launches: number;
  dumped: number;
  graduated: number;
  snipes: number;
  firstSeen: number;
  lastSeen: number;
  members: Member[];
  live?: Array<{ mint: string; symbol: string; creator: string; createdAt: number }>;
}

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const go = (href: string) => {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
};
const days = (ms: number) => Math.max(1, Math.round((Date.now() - ms) / 86_400_000));

export default function WallOfCabals() {
  const [list, setList] = useState<Cabal[] | null>(null);
  const [builtAt, setBuiltAt] = useState<number | null>(null);
  const [open, setOpen] = useState<Cabal | null>(null);
  const wanted = Number(new URLSearchParams(location.search).get("id") ?? 0) || null;

  useEffect(() => {
    fetch(`${NORTH}/v1/cabals?limit=60`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { cabals: Cabal[]; builtAt: number | null } | null) => {
        if (!b) return;
        setList(b.cabals);
        setBuiltAt(b.builtAt);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!wanted) return;
    fetch(`${NORTH}/v1/cabal/${wanted}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Cabal | null) => c && setOpen(c))
      .catch(() => {});
  }, [wanted]);

  const show = (c: Cabal) => {
    history.pushState(null, "", `/cabals?id=${c.id}`);
    fetch(`${NORTH}/v1/cabal/${c.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((full: Cabal | null) => setOpen(full ?? c))
      .catch(() => setOpen(c));
  };

  return (
    <Section className="overflow-x-clip !pt-32 sm:!pt-40" backdrop={{ glowAt: "30% 10%" }}>
      <SectionHead
        eyebrow={builtAt ? t("Wall of cabals · 90 days · rebuilt {h} h ago", { h: Math.max(0, Math.round((Date.now() - builtAt) / 3_600_000)) }) : t("Wall of cabals · 90 days")}
        title={[t("The wallets that work"), t("as one hand.")]}
        text={t("A cabal is a set of wallets the chain ties together: paid by the same wallet, sniping each other's launches, bundling the same launch blocks, buying the first seconds together. Each one keeps its number; tap it for every member and the launches it has live right now.")}
      />
      {open && (
        <Reveal className="bg-night-surface border border-white/[0.08] mb-6 rounded-2xl p-5 sm:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl">{t("cabal #{n}", { n: open.id })}</h2>
            <button type="button" onClick={() => (setOpen(null), history.pushState(null, "", "/cabals"))} className="tabular-nums rounded-full px-2.5 py-1 text-[12.5px] text-fg-3 ring-1 ring-white/10 hover:text-white">
              {t("close")}
            </button>
          </div>
          <div className="tabular-nums mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              [t("wallets"), String(open.wallets)],
              [t("launched"), String(open.launches)],
              [t("dumped"), String(open.dumped)],
              [t("graduated"), String(open.graduated)],
              [t("snipes"), String(open.snipes)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-black/30 px-3 py-2 ring-1 ring-white/[0.06]">
                <p className="text-[12px] text-fg-4">{k}</p>
                <p className="mt-0.5 text-[16px] text-fg">{v}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-fg-4">{t("first seen {a} days ago · last seen {b} days ago", { a: days(open.firstSeen), b: days(open.lastSeen) })}</p>
          {!!open.live?.length && (
            <div className="mt-5">
              <p className="text-[12.5px] text-fg-4">{t("live right now")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {open.live.map((l) => (
                  <button key={l.mint} type="button" onClick={() => go(`/xray?mint=${l.mint}`)} className="rounded-full border border-white/[0.12] px-3 py-1 text-[12.5px] text-fg-2 hover:text-white">
                    ${l.symbol.replace(/^\$/, "")} · {chainName(l.mint)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="tabular-nums mt-5 grid grid-cols-[minmax(0,1fr)_4rem_4rem_4rem] gap-3 border-b border-white/[0.08] pb-2 text-[12px] text-fg-4 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_5rem_5rem]">
            <span>{t("wallet")}</span>
            <span className="text-right">{t("launched")}</span>
            <span className="text-right">{t("dumped")}</span>
            <span className="text-right">{t("snipes")}</span>
            <span className="hidden text-right sm:block">{t("crew hits")}</span>
            <span className="hidden text-right sm:block">{t("bundles")}</span>
          </div>
          {open.members.map((m) => (
            <button key={m.wallet} type="button" onClick={() => go(`/xray?wallet=${m.wallet}`)} className="tabular-nums grid w-full grid-cols-[minmax(0,1fr)_4rem_4rem_4rem] gap-3 border-b border-white/[0.06] py-2 text-left text-[12.5px] hover:bg-white/[0.03] sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_5rem_5rem]">
              <span className="truncate text-fg-2">{short(m.wallet)}</span>
              <span className="text-right text-fg-3">{m.launches}</span>
              <span className={`text-right ${m.dumped ? "text-[#ff8a7e]" : "text-fg-3"}`}>{m.dumped}</span>
              <span className="text-right text-fg-3">{m.snipes}</span>
              <span className="hidden text-right text-fg-3 sm:block">{m.crewHits}</span>
              <span className="hidden text-right text-fg-3 sm:block">{m.bundleHits}</span>
            </button>
          ))}
        </Reveal>
      )}
      <Reveal className="bg-night-surface border border-white/[0.08] overflow-hidden rounded-2xl">
        <div className="tabular-nums grid grid-cols-[3.5rem_4rem_minmax(0,1fr)_4rem_4rem] gap-3 border-b border-white/[0.08] px-5 py-3 text-[12px] text-fg-4 sm:grid-cols-[3.5rem_4.5rem_minmax(0,1fr)_5rem_5rem_5rem_6rem]">
          <span>#</span>
          <span className="text-right">{t("wallets")}</span>
          <span>{t("members")}</span>
          <span className="text-right">{t("launched")}</span>
          <span className="text-right">{t("dumped")}</span>
          <span className="hidden text-right sm:block">{t("snipes")}</span>
          <span className="hidden text-right sm:block">{t("last seen")}</span>
        </div>
        {!list && <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t("Reading the memory…")}</p>}
        {list && list.length === 0 && <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t("No cabals built yet: the memory is being read. Open this again in a few minutes.")}</p>}
        {list?.map((c) => (
          <button key={c.id} type="button" onClick={() => show(c)} className="tabular-nums grid w-full grid-cols-[3.5rem_4rem_minmax(0,1fr)_4rem_4rem] items-center gap-3 border-b border-white/[0.06] px-5 py-3 text-left text-[13px] transition hover:bg-white/[0.03] sm:grid-cols-[3.5rem_4.5rem_minmax(0,1fr)_5rem_5rem_5rem_6rem]">
            <span className="text-fg-3">#{c.id}</span>
            <span className="text-right text-fg">{c.wallets}</span>
            <span className="truncate text-fg-3">{c.members.slice(0, 3).map((m) => short(m.wallet)).join(" · ")}{c.wallets > 3 ? ` +${c.wallets - 3}` : ""}</span>
            <span className="text-right text-fg-2">{c.launches}</span>
            <span className={`text-right ${c.dumped >= 3 ? "text-[#ff8a7e]" : "text-fg-2"}`}>{c.dumped}</span>
            <span className="hidden text-right text-fg-3 sm:block">{c.snipes}</span>
            <span className="hidden text-right text-fg-4 sm:block">{t("{d} d ago", { d: days(c.lastSeen) })}</span>
          </button>
        ))}
      </Reveal>
    </Section>
  );
}
