import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Reveal, Section, SectionHead } from "./ui";
import { t } from "../i18n";
import { num, short } from "../format";
import { navigate } from "../router";

/**
 * Real volume: PumpSwap's top pools by the volume they show, each one read from its own transactions. Who opened it
 * and with how much SOL, whether that wallet took the liquidity back, and how many trades only passed a bag around.
 */

interface Read {
  creator: string;
  solIn: number;
  openedAt: number;
  lastAt: number;
  trades: number;
  perSecond: number;
  sample: { n: number; passes: number };
  taken: { sol: number; at: number } | null;
  creatorPools: number;
  creatorTaken: number;
}
interface Pool {
  pool: string;
  mint: string;
  symbol: string;
  createdAt: number;
  volumeUsd: number;
  fdvUsd: number | null;
  buyers: number;
  sellers: number;
  trades: number;
  launchpad: string | null;
  read: Read | null;
}
interface Body {
  builtAt: number | null;
  totals: { listed: number; volumeUsd: number; newPools: number; read: number; closed: number; solIn: number; solOut: number };
  pools: Pool[];
}
type Show = "all" | "emptied" | "open";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const usd = (n: number | null) => (n === null ? "-" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${Math.round(n)}`);
const sol = (n: number) => (n >= 100 ? num(Math.round(n)) : String(Math.round(n * 10) / 10));
const span = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 90 ? t("{m} min", { m }) : m < 48 * 60 ? t("{h} h", { h: Math.round(m / 60) }) : t("{d} d", { d: Math.round(m / 1440) });
};
const RED = "text-[#ff8a7e]";
/** Half the draw or more passed around: the volume is mostly not buying. */
const mostlyPassed = (r: Read | null) => !!r && r.sample.n >= 20 && r.sample.passes * 2 >= r.sample.n;

function Tile({ k, v, tone = "text-fg" }: { k: string; v: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-black/30 px-4 py-3 ring-1 ring-white/[0.06]">
      <p className="text-[13px] text-fg-4">{k}</p>
      <p className={`tabular-nums mt-1 text-[20px] ${tone}`}>{v}</p>
    </div>
  );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-white/[0.05] py-1.5">
      <span className="text-fg-4">{k}</span>
      <span className="text-right text-fg-2">{children}</span>
    </p>
  );
}

export default function Volume() {
  const [body, setBody] = useState<Body | null>(null);
  const [failed, setFailed] = useState(false);
  const [show, setShow] = useState<Show>("all");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${NORTH}/v1/pools`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: Body) => (setBody(b), setFailed(false)))
      .catch(() => setFailed(true));
  }, []);

  const now = Date.now();
  const rows = (body?.pools ?? []).filter((p) => (show === "emptied" ? !!p.read?.taken : show === "open" ? !!p.read && !p.read.taken : true));
  const COLS = "grid-cols-[minmax(0,1fr)_4.5rem_3.5rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_6rem_7rem_10rem_9rem]";
  const tt = body?.totals;

  return (
    <Section className="overflow-x-clip !pt-32 sm:!pt-40" backdrop={{ glowAt: "30% 10%" }}>
      <SectionHead
        eyebrow={t("Real volume · PumpSwap top pools by 24-hour volume · each one read from the chain")}
        title={[t("Top volume,"), t("read from the chain.")]}
        text={t("A pool can show millions in volume with almost nobody buying. For every pool on the list opened in the last three days, the node reads its own transactions: who opened it and with how much SOL, whether that wallet took the liquidity back, and how many of its trades only passed one bag from one wallet to another. This shows wallets and transfers, and says nothing about who owns a wallet.")}
      />

      {tt && (
        <Reveal className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile k={t("pools on the list")} v={`${tt.listed}`} />
          <Tile k={t("volume they show, 24 h")} v={usd(tt.volumeUsd)} />
          <Tile k={t("emptied by their opener")} v={tt.read ? `${tt.closed} ${t("of")} ${tt.read}` : "-"} tone={tt.closed ? RED : "text-fg"} />
          <Tile k={t("SOL in, SOL out on those")} v={tt.closed ? `${sol(tt.solIn)} · ${sol(tt.solOut)}` : "-"} tone={tt.closed ? RED : "text-fg"} />
        </Reveal>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["all", t("all pools")],
            ["emptied", t("emptied by the opener")],
            ["open", t("still open")],
          ] as Array<[Show, string]>
        ).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setShow(id)} className={`rounded-full px-3.5 py-1.5 text-[13px] ring-1 transition ${show === id ? "bg-white text-black ring-white" : "text-fg-3 ring-white/10 hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>

      <Reveal className="bg-night-surface border border-white/[0.08] overflow-hidden rounded-2xl">
        <div className={`tabular-nums grid ${COLS} gap-3 border-b border-white/[0.08] px-5 py-3 text-[13px] text-fg-4`}>
          <span>{t("pool")}</span>
          <span className="text-right">{t("volume, 24 h")}</span>
          <span className="text-right">{t("passed around")}</span>
          <span className="hidden text-right sm:block">{t("opener: SOL in, out")}</span>
          <span className="text-right">{t("state")}</span>
        </div>
        {failed && <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t("The chain reader did not answer. Try again in a minute.")}</p>}
        {!failed && !body && <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t("Reading the pools…")}</p>}
        {body && rows.length === 0 && <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t("No pool here right now.")}</p>}
        {rows.map((p) => {
          const r = p.read;
          const isOpen = open === p.pool;
          const old = !r && now - p.createdAt > 72 * 3_600_000;
          return (
            <div key={p.pool} className="border-b border-white/[0.06]">
              <button type="button" onClick={() => setOpen(isOpen ? null : p.pool)} aria-expanded={isOpen} className={`tabular-nums grid w-full ${COLS} items-center gap-3 px-5 py-3 text-left text-[13px] transition hover:bg-white/[0.03]`}>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-fg">${p.symbol || short(p.mint)}</span>
                  <span className="block truncate text-fg-4">
                    <span className="hidden font-mono sm:inline">{short(p.mint)} · </span>
                    {t("opened {s} ago", { s: span(now - (r?.openedAt ?? p.createdAt)) })}
                  </span>
                </span>
                <span className="text-right text-fg-2">{usd(p.volumeUsd)}</span>
                <span className={`text-right ${mostlyPassed(r) ? RED : "text-fg-3"}`}>{r && r.sample.n ? `${r.sample.passes}/${r.sample.n}` : "-"}</span>
                <span className={`hidden text-right sm:block ${r?.taken ? RED : "text-fg-3"}`}>{r ? `${sol(r.solIn)} · ${r.taken ? sol(r.taken.sol) : t("still in")}` : "-"}</span>
                <span className={`text-right ${r?.taken ? RED : "text-fg-3"}`}>{r ? (r.taken ? t("emptied after {s}", { s: span(r.taken.at - r.openedAt) }) : t("open")) : old ? t("older pool") : t("in the queue")}</span>
              </button>
              {isOpen && (
                <div className="px-5 pb-4 text-[13px]">
                  <div className="grid gap-x-8 sm:grid-cols-2">
                    <div>
                      {!r?.taken && <Fact k={t("market cap now")}>{usd(p.fdvUsd)}</Fact>}
                      <Fact k={t("buyers and sellers, 24 h")}>
                        {num(p.buyers)} · {num(p.sellers)}
                      </Fact>
                      {r && (
                        <Fact k={t("transactions on the pool")}>
                          {num(r.trades)} · {t("{n} a second", { n: r.perSecond })}
                        </Fact>
                      )}
                      {r && (
                        <Fact k={t("passed between two wallets")}>
                          <span className={mostlyPassed(r) ? RED : ""}>{t("{p} of {n} drawn at random", { p: r.sample.passes, n: r.sample.n })}</span>
                        </Fact>
                      )}
                    </div>
                    <div>
                      {r && (
                        <Fact k={t("opened by")}>
                          <button type="button" onClick={() => navigate(`/xray?wallet=${r.creator}`)} className="font-mono underline decoration-white/20 underline-offset-4 hover:text-white">
                            {short(r.creator)}
                          </button>
                        </Fact>
                      )}
                      {r && (
                        <Fact k={t("SOL the opener put in")}>{sol(r.solIn)}</Fact>
                      )}
                      {r && (
                        <Fact k={t("SOL the opener took out")}>
                          <span className={r.taken ? RED : ""}>{r.taken ? sol(r.taken.sol) : t("nothing yet")}</span>
                        </Fact>
                      )}
                      {r && r.creatorPools > 1 && (
                        <Fact k={t("this opener's pools on the list")}>
                          <span className={r.creatorTaken ? RED : ""}>{t("{n} pools, {k} emptied", { n: r.creatorPools, k: r.creatorTaken })}</span>
                        </Fact>
                      )}
                    </div>
                  </div>
                  {!r && <p className="mt-2 text-fg-4">{old ? t("Opened more than three days ago: listed with its volume only, its transactions are not read.") : t("On the list, not read yet. The node reads a few pools every ten minutes.")}</p>}
                  <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-fg-3">
                    <button type="button" onClick={() => navigate(`/xray?mint=${p.mint}`)} className="underline decoration-white/20 underline-offset-4 hover:text-white">
                      {t("open the x-ray")}
                    </button>
                    <a href={`https://solscan.io/account/${p.pool}`} target="_blank" rel="noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-white">
                      {t("the pool on Solscan")} <span className="font-mono">{short(p.pool)}</span>
                    </a>
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </Reveal>

      <p className="mt-5 max-w-3xl text-[13px] leading-relaxed text-fg-4">
        {body?.builtAt ? t("Read {s} ago. ", { s: span(now - body.builtAt) }) : ""}
        {t("The list, the volume and the buyer and seller counts are GeckoTerminal's. Everything else is read from each pool's own transactions. Passed around is a draw of 60 trades at random: a trade counts when one wallet's bag lands in another wallet inside a single transaction and the pool ends where it started, which is a sell and a buy of the same tokens signed together. Emptied means the wallet that opened the pool took at least half of its opening SOL back out in one transaction. SOL out includes whatever that wallet's own wallets put in, so it is not a profit figure. Pools older than three days are listed with their volume only.")}
      </p>
    </Section>
  );
}
