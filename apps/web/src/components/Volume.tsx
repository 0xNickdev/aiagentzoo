import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Page } from "./site/Panel";
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
const RED = "text-danger";
/** Half the draw or more passed around: the volume is mostly not buying. */
const mostlyPassed = (r: Read | null) => !!r && r.sample.n >= 20 && r.sample.passes * 2 >= r.sample.n;

function Tile({ k, v, tone = "text-white", className = "" }: { k: string; v: string; tone?: string; className?: string }) {
  return (
    <div className={`min-w-0 p-3.5 ${className}`}>
      <p className="truncate text-[12px] text-dim">{k}</p>
      <p className={`mt-2.5 text-[24px] font-medium leading-none tracking-[-0.035em] ${tone}`}>{v}</p>
    </div>
  );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line py-1.5">
      <span className="text-dim">{k}</span>
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
    <Page
      title={t("Real volume")}
      side={<span className="text-[12px] text-dim">{t("PumpSwap top pools by 24-hour volume · each one read from the chain")}</span>}
      lead={t("A pool can show millions in volume with almost nobody buying. For every pool on the list opened in the last three days, the node reads its own transactions: who opened it and with how much SOL, whether that wallet took the liquidity back, and how many of its trades only passed one bag from one wallet to another. This shows wallets and transfers, and says nothing about who owns a wallet.")}
    >

      {tt && (
        <section className="mb-3 grid grid-cols-2 overflow-hidden rounded-[12px] border border-line bg-night-surface sm:grid-cols-4">
          <Tile k={t("pools on the list")} v={`${tt.listed}`} className="border-b border-r border-line sm:border-b-0" />
          <Tile k={t("volume they show, 24 h")} v={usd(tt.volumeUsd)} className="border-b border-line sm:border-b-0 sm:border-r" />
          <Tile k={t("emptied by their opener")} v={tt.read ? `${tt.closed} ${t("of")} ${tt.read}` : "-"} tone={tt.closed ? RED : "text-white"} className="border-r border-line" />
          <Tile k={t("SOL in, SOL out on those")} v={tt.closed ? `${sol(tt.solIn)} · ${sol(tt.solOut)}` : "-"} tone={tt.closed ? RED : "text-white"} />
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {(
          [
            ["all", t("all pools")],
            ["emptied", t("emptied by the opener")],
            ["open", t("still open")],
          ] as Array<[Show, string]>
        ).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setShow(id)} className={`flex h-8 items-center rounded-[7px] border px-2.5 text-[12px] transition ${show === id ? "border-line-2 bg-night-raised text-white" : "border-line text-dim hover:border-line-2 hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-[12px] border border-line bg-night-surface">
        <div className={`tabular-nums grid ${COLS} gap-3 border-b border-line px-3.5 py-2.5 text-[11.5px] text-faint`}>
          <span>{t("pool")}</span>
          <span className="text-right">{t("volume, 24 h")}</span>
          <span className="text-right">{t("passed around")}</span>
          <span className="hidden text-right sm:block">{t("opener: SOL in, out")}</span>
          <span className="text-right">{t("state")}</span>
        </div>
        {failed && <p className="px-4 py-10 text-center text-[12.5px] text-faint">{t("The chain reader did not answer. Try again in a minute.")}</p>}
        {!failed && !body && <p className="px-4 py-10 text-center text-[12.5px] text-faint">{t("Reading the pools…")}</p>}
        {body && rows.length === 0 && <p className="px-4 py-10 text-center text-[12.5px] text-faint">{t("No pool here right now.")}</p>}
        {rows.map((p) => {
          const r = p.read;
          const isOpen = open === p.pool;
          const old = !r && now - p.createdAt > 72 * 3_600_000;
          return (
            <div key={p.pool} className="border-b border-line">
              <button type="button" onClick={() => setOpen(isOpen ? null : p.pool)} aria-expanded={isOpen} className={`tabular-nums grid w-full ${COLS} items-center gap-3 px-3.5 py-2.5 text-left text-[12.5px] transition hover:bg-night-raised`}>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-white">${p.symbol || short(p.mint)}</span>
                  <span className="block truncate text-dim">
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
                <div className="px-3.5 pb-3.5 text-[12.5px]">
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
                          <button type="button" onClick={() => navigate(`/xray?wallet=${r.creator}`)} className="font-mono underline decoration-line-2 underline-offset-4 hover:text-white">
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
                  {!r && <p className="mt-2 text-dim">{old ? t("Opened more than three days ago: listed with its volume only, its transactions are not read.") : t("On the list, not read yet. The node reads a few pools every ten minutes.")}</p>}
                  <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-fg-3">
                    <button type="button" onClick={() => navigate(`/xray?mint=${p.mint}`)} className="underline decoration-line-2 underline-offset-4 hover:text-white">
                      {t("open the x-ray")}
                    </button>
                    <a href={`https://solscan.io/account/${p.pool}`} target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-4 hover:text-white">
                      {t("the pool on Solscan")} <span className="font-mono">{short(p.pool)}</span>
                    </a>
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <p className="mt-3 max-w-[90ch] text-[12px] leading-[1.6] text-dim">
        {body?.builtAt ? t("Read {s} ago. ", { s: span(now - body.builtAt) }) : ""}
        {t("The list, the volume and the buyer and seller counts are GeckoTerminal's. Everything else is read from each pool's own transactions. Passed around is a draw of 60 trades at random: a trade counts when one wallet's bag lands in another wallet inside a single transaction and the pool ends where it started, which is a sell and a buy of the same tokens signed together. Emptied means the wallet that opened the pool took at least half of its opening SOL back out in one transaction. SOL out includes whatever that wallet's own wallets put in, so it is not a profit figure. Pools older than three days are listed with their volume only.")}
      </p>
    </Page>
  );
}
