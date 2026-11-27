import { useState } from "react";
import { chainName, chainOf, unitOf, venueOfChain } from "../../chain";
import { t, tChain } from "../../i18n";
import { pctFine, short } from "../../format";
import MoneyMap from "../MoneyMap";
import NetworkMap from "../NetworkMap";
import XRayRadar, { KIND, kindOf, secs } from "../XRayRadar";
import { Tags } from "../WalletTags";
import { money } from "../../outcome";
import type { DevPattern } from "../DevHabits";
import type { XRayReport } from "./types";
import { KIND_TAGS, openWallet } from "./shared";
import { usdShort } from "./Market";
import { insideOf, timingOf } from "./Calls";
import { Dossier } from "./Dossier";
import { ClaimsPanel } from "./Claims";
import { DevPanel, FirstPanel, ProPanel, SetupPanel, TraceGraph, TracePanel } from "./Panels";
import { Kv, LockRow, Pn, type Ctx } from "./ui";
import { useFreeDeepCheck } from "./access";

const where = (r: XRayReport) => chainName(r.mint);
const evm = (r: XRayReport) => chainOf(r.mint) !== "solana";

/* ------------------------------------------------------------------ the dev */

const secsH = (s: number) => (s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
const pct = (x: number) => `${Math.round(x * 100)}%`;

function habitRows(r: XRayReport): Array<[string, string, ("d" | "")?]> {
  const h = r.creatorRecord;
  if (!h) return [];
  const p: DevPattern | null | undefined = h.pattern;
  const rows: Array<[string, string, ("d" | "")?]> = [];
  if (h.repeats?.length) rows.push([t("Repeats tickers"), h.repeats.map((x) => `${x.symbol} ×${x.n}`).join(", "), "d"]);
  if (p) {
    if (p.peakCapUsd !== null) rows.push([t("Usually peaks at"), `${money(p.peakCapUsd)}${p.peakAfterSec !== null ? t(", {s} in", { s: secsH(p.peakAfterSec) }) : ""}`]);
    if (p.firstCapUsd !== null && p.upsideX !== null) rows.push([t("First second → peak"), `${money(p.firstCapUsd)} → ${p.upsideX}x`]);
    if (p.reached20k !== null) rows.push([t("Reached $20K"), pct(p.reached20k)]);
    if (p.firstSellSec !== null) rows.push([t("Dev's first sale"), t("{s} after launch", { s: secsH(p.firstSellSec) }), p.firstSellSec < 60 ? "d" : ""]);
    if (p.dumps && p.dumpCapUsd !== null) rows.push([t("Dumps at"), money(p.dumpCapUsd)]);
    if (p.dumps && p.afterDumpLowPct !== null) rows.push([t("After the dump, in 30 min"), `${pct(p.afterDumpLowPct)}${p.afterDumpDoubled ? t(" · doubled in {p}", { p: pct(p.afterDumpDoubled) }) : ""}`, p.afterDumpLowPct <= -0.3 ? "d" : ""]);
  }
  if (h.tempo) rows.push([t("Pace"), h.tempo.idleDays < 1 ? t("{n} a day · last today", { n: h.tempo.perDay }) : t("{n} a day · last {d}d ago", { n: h.tempo.perDay, d: h.tempo.idleDays })]);
  return rows;
}

export function DevSection(x: Ctx) {
  const { r } = x;
  const f = r.check.facts;
  const rec = r.creatorRecord;
  const habits = habitRows(r);
  return (
    <>
      <DevPanel {...x} full />
      <Pn span="x-s4" title={t("The creator")} meta={r.pool ? t("not on record") : r.outsideStream ? t("before our stream") : t("last 48 hours")}>
        <Kv
          flush
          rows={[
            [t("Wallet"), <button key="w" type="button" className="x-link" onClick={() => openWallet(r.creator)}><code>{short(r.creator)}</code></button>],
            !r.outsideStream && [t("Launches, 48 h"), (rec?.launches48h ?? 1).toLocaleString("en-US"), (rec?.launches48h ?? 1) >= 3 ? "d" : ""],
            !r.outsideStream && [t("Dumped"), (rec?.dumped ?? 0).toLocaleString("en-US"), (rec?.dumped ?? 0) >= 2 ? "d" : ""],
            r.outsideStream && r.devHistory ? [t("Launches we kept · dumped"), `${r.devHistory.launches} · ${r.devHistory.dumped}`, r.devHistory.dumped >= 2 ? "d" : ""] : null,
            f && !r.outsideStream && [t("Sold of their own bag"), f.creatorSoldPct == null ? t("never bought") : `${f.creatorSoldPct}%`, (f.creatorSoldPct ?? 0) >= 50 ? "d" : ""],
            r.check.holders?.creatorHoldsPct != null && [t("Holds now"), `${r.check.holders.creatorHoldsPct}%`],
            f?.bundleWallets ? [t("Launch block"), t("{n} wallets · {p}%", { n: f.bundleWallets, p: f.bundleSharePct ?? 0 }), (f.bundleSharePct ?? 0) >= 15 ? "d" : ""] : null,
            r.ticker && [t("Ticker used before"), r.ticker.launches ? t("{n}× in {d} days, {x} dumped", { n: r.ticker.launches, d: r.ticker.days, x: r.ticker.dumped }) : t("first time in {d} days", { d: r.ticker.days }), r.ticker.launches >= 3 && r.ticker.dumped >= 2 ? "d" : ""],
          ]}
        />
        {!r.socials?.length && !r.mentions?.length && <p className="x-fine">{t("No X account, X community or Telegram group linked from the token, and no posts on X naming it seen yet.")}</p>}
        {habits.length > 0 && (
          <>
            <p className="x-h3">{rec?.pattern ? t("Usually, from {n} launches", { n: rec.pattern.launches }) : t("Habits")}</p>
            <Kv flush rows={habits} />
          </>
        )}
      </Pn>
      {!r.socials?.length && !r.mentions?.length ? <ProPanel access={x.access} span="x-s6" /> : (
      <Pn span="x-s6" title={t("Socials and posts")} meta={t("what the token links to, who posted it")}>
        {(
          <>
            {!!r.socials?.length && (
              <Kv
                flush
                rows={r.socials.map((s) => [
                  s.social.label,
                  <a key={s.social.url} className="x-link" href={s.social.url} target="_blank" rel="noopener noreferrer nofollow">{(s.creators ?? 1) > 1 ? t("{n} other launches by {c} devs · {d} fast dumps", { n: s.launches, c: s.creators!, d: s.fastDumps }) : t("{n} other launches · {d} fast dumps", { n: s.launches, d: s.fastDumps })} ↗</a>,
                  s.fastDumps >= 2 ? "d" : "",
                ])}
              />
            )}
            {!!r.mentions?.length && (
              <>
                <p className="x-h3">{t("Seen on X")}</p>
                <Kv flush rows={r.mentions.slice(0, 8).map((m) => [`@${m.handle}`, <a key={m.url} className="x-link" href={m.url} target="_blank" rel="noopener noreferrer nofollow">{m.postAt >= r.createdAt ? t("{m} min after launch", { m: Math.round((m.postAt - r.createdAt) / 60_000) }) : t("before launch")} ↗</a>])} />
              </>
            )}
          </>
        )}
      </Pn>
      )}
      <TracePanel {...x} span="x-s6" />
      <ClaimsPanel r={r} span="x-s6" />
    </>
  );
}

/* ------------------------------------------------------------------ first seconds */

export function FirstSection(x: Ctx) {
  const { r, access, onPick, unlock } = x;
  const f = r.check.facts;
  const early = r.early;
  const [sel, setSel] = useState<string | null>(null);
  const took = early.reduce((n, e) => n + e.bought, 0);
  const holds = early.reduce((n, e) => n + e.held, 0);
  const e = early.find((w) => w.wallet === sel) ?? null;
  return (
    <>
      <FirstPanel {...x} full selected={sel} onSelect={(w) => setSel(sel === w ? null : w)} />
      <Pn span="x-s5" title={e ? t("This wallet") : t("Insiders")} meta={e ? undefined : t("tap a wallet to see who it is")} more={e ? { label: t("back"), on: () => setSel(null) } : undefined}>
        {e ? (
          <Dossier e={e} creator={r.creator} onPick={onPick} deep={access.deep} onUnlock={unlock} />
        ) : (
          <Kv
            flush
            rows={[
              [t("Wallets in the first 5 seconds"), String(early.length)],
              [t("Supply they took"), pctFine(took), took >= 0.25 ? "d" : ""],
              [t("Supply they still hold"), pctFine(holds), holds >= 0.25 ? "d" : ""],
              [t("The creator's own crew"), String(f?.creatorCrew ?? 0), (f?.creatorCrew ?? 0) >= 2 ? "d" : ""],
              [t("In a sniper ring"), String(f?.ringWallets ?? 0), (f?.ringWallets ?? 0) >= 3 ? "d" : ""],
              [t("Serial snipers"), String(f?.serialSnipers ?? 0), (f?.serialSnipers ?? 0) >= 2 ? "w" : ""],
              f?.crewHeldPct ? [t("Crew still holds"), `${f.crewHeldPct}%`, f.crewHeldPct >= 5 ? "d" : ""] : null,
            ]}
          />
        )}
      </Pn>
      {early.length > 0 && (
        <Pn span="x-s12" title={t("Map of the first seconds")} meta={t("one dot per wallet, by who it is")}>
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <XRayRadar early={early} selected={sel} onSelect={setSel} />
          </div>
        </Pn>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ setup */

export function SetupSection(x: Ctx) {
  const { r } = x;
  const op = r.check.operator;
  const shape = r.check.tool?.shape;
  return (
    <>
      <SetupPanel {...x} full />
      <Pn span="x-s4" title={t("Same shape")} meta={shape ? <code>{shape.key}</code> : t("the build without fee amounts")}>
        {shape ? (
          <Kv
            flush
            rows={[
              [t("Kind"), shape.common ? t("public launcher") : t("{n} wallets", { n: shape.wallets.toLocaleString("en-US") })],
              [t("Launches"), shape.launches.toLocaleString("en-US")],
              [t("Settled"), shape.settled.toLocaleString("en-US")],
              [t("Dumped"), shape.dumped.toLocaleString("en-US"), !shape.common && shape.settled >= 10 && shape.dumped / shape.settled >= 0.9 ? "d" : ""],
            ]}
          />
        ) : (
          <p className="x-note">{t("No shape read for this launch.")}</p>
        )}
        <p className="x-fine">{t("The exact setup is the launch transaction as built, fees included. The shape drops the amounts, so launch kits that vary their fees still match.")}</p>
      </Pn>
      <Pn span="x-s4" title={t("Co-signers")} meta={t("wallets that signed with the dev")}>
        {op ? (
          op.wallets <= 100 ? (
            <Kv
              flush
              rows={[
                [t("Wallets"), String(op.wallets - 1)],
                [t("Their launches, 2 days"), String(op.launches)],
                [t("Dumped of settled"), `${op.dumped} / ${op.settled}`, op.settled >= 3 && op.dumped / op.settled >= 0.8 ? "d" : ""],
              ]}
            />
          ) : (
            <p className="x-note">{t("The dev signed with {n} wallets: a shared service, not a crew, so it ties no one together.", { n: op.wallets.toLocaleString("en-US") })}</p>
          )
        ) : (
          <p className="x-note">{t("Nobody signed a transaction together with the dev.")}</p>
        )}
        <p className="x-fine">{t("Wallets that sign one transaction together share the keys' owner.")}</p>
      </Pn>
    </>
  );
}

/* ------------------------------------------------------------------ bundles */

const sol3 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 10 ? 1 : 3 });

export function BundlesSection({ r }: Ctx) {
  const f = r.check.facts;
  const may = !!f?.mayhem;
  if (!f || r.outsideStream)
    return (
      <Pn span="x-s12" title={t("Bundles and volume")} meta={t("before our stream")}>
        <p className="x-note">{t("This coin launched before our stream: its buys and sells are not on record, so bundles and churn cannot be counted.")}</p>
      </Pn>
    );
  return (
    <>
      <Pn span="x-s7" title={t("Bundles and volume")} meta={t("4+ wallets buying in one block, any time")}>
        <Kv
          flush
          rows={[
            [t("Buyers"), f.buyers.toLocaleString("en-US")],
            [t("Buys · sells"), `${f.buys.toLocaleString("en-US")} · ${f.sells.toLocaleString("en-US")}`],
            [t("Churned volume, at least"), f.churnPct == null ? "-" : `${f.churnPct}%`, (f.churnPct ?? 0) >= 30 && !may ? "d" : ""],
            [t("Bump bot trades"), String(f.bumps ?? 0), (f.bumps ?? 0) >= 3 && !may ? "d" : ""],
            [t("Bought in bundles"), `${f.bundlers ? t("{n} wallets", { n: f.bundlers }) : "0"}${f.bundlesSince ? ` · ${t("since {d}", { d: new Date(f.bundlesSince).toISOString().slice(5, 16).replace("T", " ") + " UTC" })}` : ""}`, (f.bundlers ?? 0) >= 10 && (f.bundlersPeakPct ?? 0) >= 30 && !may ? "d" : ""],
            f.bundlers ? [t("Bundlers hold now · at most"), `${f.bundlersHeldPct ?? 0}% · ${f.bundlersPeakPct ?? 0}%`, (f.bundlersPeakPct ?? 0) >= 30 && !may ? "d" : ""] : null,
            f.bundledSol ? [t("{u} through bundles", { u: unitOf(r.mint) }), f.bundledSol.toLocaleString("en-US", { maximumFractionDigits: 1 })] : null,
            // Made only to carry the unclaimed read (a coin older than the tape): no total of its own to show.
            f.creatorFees && (f.creatorFees.total || !f.creatorFees.unclaimed)
              ? [
                  t("Creator fees on this coin"),
                  <span title={t("curve {c} SOL · pool {p} SOL", { c: sol3(f.creatorFees.curve), p: sol3(f.creatorFees.pool) })}>
                    {sol3(f.creatorFees.total)} SOL
                    {f.creatorFees.estimated || f.creatorFees.partial ? <small> · {[f.creatorFees.estimated && t("partly estimated"), f.creatorFees.partial && t("since we started reading it")].filter(Boolean).join(" · ")}</small> : null}
                  </span>,
                ]
              : null,
            f.creatorFees && f.creatorFees.curve && f.creatorFees.pool ? ["", t("curve {c} SOL · pool {p} SOL", { c: sol3(f.creatorFees.curve), p: sol3(f.creatorFees.pool) })] : null,
            // The vaults are the creator's, not the coin's: what waits there is from all of their coins.
            f.creatorFees?.unclaimed
              ? [
                  f.creatorFees.total ? "" : t("Creator fees"),
                  <span title={t("curve {c} SOL · pool {p} SOL", { c: sol3(f.creatorFees.unclaimed.curve), p: sol3(f.creatorFees.unclaimed.pool) })}>
                    {t("unclaimed: {s} SOL", { s: sol3(f.creatorFees.unclaimed.sol) })}
                    <small> · {t("across this creator's coins")}</small>
                  </span>,
                ]
              : null,
            f.bundleWallets ? [t("Launch block"), t("{n} wallets · {p}%", { n: f.bundleWallets, p: f.bundleSharePct ?? 0 }), (f.bundleSharePct ?? 0) >= 15 ? "d" : ""] : null,
            f.top5BuyingPct != null && [t("Bought by the top 5"), `${f.top5BuyingPct}%`, f.top5BuyingPct >= 70 ? "d" : ""],
          ]}
        />
        <p className="x-fine">{t("A crowd of buyers that is really a few hands buying in packs looks like demand and is not. Churn is wallets selling back what they just bought: volume, not holders.")}</p>
        {may && <p className="x-aside">{t("Mayhem mode: pump.fun's own bot trades it for 24 hours, so churn and bundles read high on every Mayhem coin.")}</p>}
      </Pn>
      <Pn span="x-s5" title={t("Bundle wallets")} meta={r.bundle?.wallets?.length ? t("share of supply at launch") : undefined}>
        {r.bundle?.wallets?.length ? (
          <Kv flush rows={r.bundle.wallets.slice(0, 12).map((w) => [short(w.wallet), pctFine(w.share), w.share >= 0.05 ? "d" : ""])} />
        ) : (
          <p className="x-note">{t("No wallets bought in the launch block.")}</p>
        )}
        {r.bundle?.funding && <p className="x-fine">{t("Funding of the bundle: {l} of {c} wallets share a funder.", { l: r.bundle.funding.linked, c: r.bundle.funding.checked })}</p>}
      </Pn>
    </>
  );
}

/* ------------------------------------------------------------------ holders */

export function HoldersSection({ r }: Ctx) {
  const c = r.check;
  const h = c.holders;
  const f = c.facts;
  const cells: Array<[string, number, boolean]> = [];
  if (h && h.top10Pct > 0) {
    cells.push([t("top 10"), h.top10Pct, h.top10Pct >= 50]);
    cells.push([t("largest wallet"), h.topWalletPct, h.topWalletPct >= 20]);
  }
  if (h?.creatorHoldsPct != null) cells.push([t("the dev"), h.creatorHoldsPct, h.creatorHoldsPct >= 5]);
  if (f?.bundlers) cells.push([t("bundlers"), f.bundlersHeldPct ?? 0, (f.bundlersHeldPct ?? 0) >= 20]);
  if (f?.earlyWallets) cells.push([t("first 5 s"), f.earlyHeldPct ?? 0, (f.earlyHeldPct ?? 0) >= 30]);
  if (f?.crewHeldPct) cells.push([t("dev's crew"), f.crewHeldPct, f.crewHeldPct >= 5]);
  if (h?.programPct) cells.push([t("curve or pool"), h.programPct, false]);
  const rights = c.rights;
  const held = (w: string | null) => (w ? t("held by {w}", { w: short(w) }) : t("revoked"));
  return (
    <>
      <Pn span="x-s7" title={t("Holders now")} meta={evm(r) ? where(r) : t("read from Solana")}>
        {!h && <p className="x-note">{evm(r) ? t("Holders are not read on {chain}: what the first wallets and the bundlers still hold comes from {venue}'s own trades.", { chain: where(r), venue: venueOfChain(r.mint) }) : t("Holders could not be read right now. Open it again in a minute: the first wallets and the bundlers below still come from the trades.")}</p>}
        {h && h.top10Pct === 0 && <p className="x-note">{t("Nobody holds it outside the curve: everyone sold back.")}{h.programPct ? ` ${t("{p}% sits in the curve or pool.", { p: h.programPct })}` : ""}</p>}
        {cells.length > 0 && (
          <div className="x-cells">
            {cells.map(([k, v, bad]) => (
              <div key={k}>
                <div className={`x-v ${bad ? "x-d" : ""}`}>{v}%</div>
                <div className="x-k">{k}</div>
              </div>
            ))}
          </div>
        )}
        {h && (
          <Kv
            rows={[
              h.lockedPct !== undefined && [t("Locked supply"), h.lockedPct ? `${h.lockedPct}%` : t("none"), h.lockedPct && h.lockedPct >= 10 ? "up" : ""],
              h.devLockedPct !== undefined && [t("Dev locked"), h.devLockedPct ? `${h.devLockedPct}%` : t("nothing")],
              h.burnedPct !== undefined && [t("Burned"), h.burnedPct ? `${h.burnedPct}%` : t("none")],
            ]}
          />
        )}
      </Pn>
      <Pn span="x-s5" title={t("Token rights")} meta={rights ? (rights.program === "token-2022" ? t("Token-2022 · read from the mint") : t("read from the mint")) : undefined}>
        {rights ? (
          <Kv
            flush
            rows={[
              [t("Can mint more"), held(rights.mintAuthority), rights.mintAuthority ? "d" : "up"],
              [t("Can freeze holders"), held(rights.freezeAuthority), rights.freezeAuthority ? "d" : "up"],
              rights.permanentDelegate ? [t("Can move anyone's tokens"), held(rights.permanentDelegate), "d"] : null,
              rights.pauseAuthority ? [t("Can pause transfers"), held(rights.pauseAuthority), "d"] : null,
              rights.transferHook ? [t("Runs a program on every transfer"), short(rights.transferHook), "d"] : null,
              rights.transferFeeBps !== undefined ? [t("Fee on every transfer"), `${rights.transferFeeBps / 100}%`, "d"] : null,
              rights.defaultFrozen ? [t("New accounts start frozen"), t("yes"), "d"] : null,
              rights.nonTransferable ? [t("Tokens cannot be transferred"), t("yes"), "d"] : null,
            ]}
          />
        ) : (
          <p className="x-note">{evm(r) ? t("Rights are read from Solana mints; this token is on {chain}.", { chain: where(r) }) : t("The mint's rights were not read with this answer.")}</p>
        )}
        <p className="x-fine">{t("A held right is a power, not proof it will be used.")}</p>
      </Pn>
    </>
  );
}

/* ------------------------------------------------------------------ calls */

const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  return m < 60 ? t("{m} min ago", { m }) : m < 48 * 60 ? t("{h} h ago", { h: Math.round(m / 60) }) : t("{d} d ago", { d: Math.round(m / 1440) });
};
/** Free readers see this many calls; the rest are the deep check. */
const FREE_CALLS = 3;

export function CallsSection({ r, calls, market, access, unlock }: Ctx) {
  const [hypeOpen, setHypeOpen] = useState(false);
  if (!calls)
    return (
      <Pn span="x-s12" title={t("Who's calling it")}>
        <div className="x-sk" style={{ height: 120 }} />
      </Pn>
    );
  const dev = calls.theses.filter((x) => x.isDev);
  const said = calls.theses.filter((x) => !x.isDev && !x.hype).sort((a, b) => (b.tradeUsd ?? 0) - (a.tradeUsd ?? 0));
  const hype = calls.theses.filter((x) => !x.isDev && x.hype);
  const theses = [...dev, ...said, ...(hypeOpen ? hype : [])];
  const total = calls.callouts.length + calls.theses.length;
  const callouts = access.deep ? calls.callouts : calls.callouts.slice(0, FREE_CALLS);
  const thesesShown = access.deep ? theses : theses.slice(0, Math.max(0, FREE_CALLS - callouts.length));
  const hidden = access.deep ? 0 : calls.callouts.length - callouts.length + theses.length - thesesShown.length;
  return (
    <>
      <Pn span="x-s7" title={t("pump.fun callouts")} meta={t("each caller set against the chain")}>
        {!total && <p className="x-note">{t("No pump.fun callouts or FOMO theses on this coin yet.")}</p>}
        {total > 0 && !calls.callouts.length && <p className="x-note">{t("No pump.fun callouts on this coin yet.")}</p>}
        {calls.early?.line && <p className="x-note" style={{ margin: "8px 0 12px", color: "var(--fg-2)" }}>{tChain(calls.early.line).replace(/^\w/, (c) => c.toUpperCase())}</p>}
        <ul className="x-list">
          {callouts.map((c) => {
            const inside = insideOf(r, c.wallet);
            const when = timingOf(c);
            const xx = c.calledMcUsd && market?.mcapUsd ? market.mcapUsd / c.calledMcUsd : null;
            return (
              <li key={c.post}>
                <div className="x-li-h">
                  <span>
                    {c.caller || t("a caller")} <small>{c.followers !== null ? t("{n} followers", { n: c.followers.toLocaleString("en-US") }) : ""}{c.twitter ? ` · ${c.twitter}` : ""}</small>
                  </span>
                  <a className="x-link" href={c.url} target="_blank" rel="noopener noreferrer nofollow">{ago(c.at)} ↗</a>
                </div>
                {c.text && <p className="x-li-q">“{c.text}”</p>}
                <div className="x-li-f">
                  {c.calledMcUsd !== null && (
                    <span>
                      {t("called at {m}", { m: usdShort(c.calledMcUsd) })}
                      {xx !== null && <span className={xx >= 1 ? "x-up" : "x-d"}>{` · ${t("now {x}×", { x: xx >= 10 ? Math.round(xx) : xx.toFixed(2) })}`}</span>}
                    </span>
                  )}
                  {c.wallet && <button type="button" className="x-link" onClick={() => openWallet(c.wallet!)}><code>{short(c.wallet)}</code></button>}
                  {when && <span className={when.bad ? "x-d" : ""}>{when.label}</span>}
                  <span className={inside?.bad ? "x-d" : "x-dim"}>{inside ? inside.label : t("not in the first seconds or the bundles")}</span>
                </div>
                {c.record && c.wallet && (
                  <a className="x-link" style={{ display: "inline-block", marginTop: 6, fontSize: 11.5 }} href={`/callers?wallet=${c.wallet}`}>
                    {t("their earlier calls: {d} of {n} dead a day later", { d: c.record.dead, n: c.record.settled })}
                    {c.record.medianX !== null ? ` · ${t("median {x}× of the called cap", { x: c.record.medianX.toFixed(2) })}` : ""}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
        {hidden > 0 && (
          <div style={{ marginTop: 10 }}>
            <LockRow text={t("{n} more callers, each set against what their wallet did.", { n: hidden })} onUnlock={unlock} />
          </div>
        )}
        <p className="x-fine">{t("Callouts are pump.fun's own, relayed by t.me/pumpfun_lp with the caller's wallet as pump.fun shows it. A call is someone's opinion; the chain shows only what their wallet did.")}</p>
      </Pn>
      <Pn span="x-s5" title={t("FOMO theses")} meta={t("what buyers wrote on fomo.family")}>
        {!theses.length && !hype.length && <p className="x-note">{calls.thesesStatus === "budget" ? t("FOMO theses are resting for today: the daily read budget is used up.") : t("No FOMO theses on this coin yet.")}</p>}
        <ul className="x-list">
          {thesesShown.map((x) => (
            <li key={x.id}>
              <div className="x-li-h">
                <a className="x-link" href={x.url} target="_blank" rel="noopener noreferrer nofollow">{x.name || x.handle}{x.handle && <small> @{x.handle}</small>}</a>
                <small>{x.at ? ago(x.at) : ""}{x.likes ? ` · ${t("{n} likes", { n: x.likes })}` : ""}</small>
              </div>
              <p className="x-li-q">{x.text}</p>
              <div className="x-li-f">
                {x.isDev && <span className="x-d">{t("the dev of this coin")}</span>}
                {x.tradeUsd !== null && x.tradeUsd >= 1 && <span>{t("in for {u}", { u: usdShort(x.tradeUsd) })}</span>}
                {x.pnlUsd !== null && Math.abs(x.pnlUsd) >= 1 && <span className={x.pnlUsd > 0 ? "x-up" : "x-d"}>{`${x.pnlUsd > 0 ? "+" : "−"}${usdShort(Math.abs(x.pnlUsd))} ${t("on it")}`}</span>}
              </div>
            </li>
          ))}
        </ul>
        {access.deep && hype.length > 0 && (
          <button type="button" className="x-link" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setHypeOpen(!hypeOpen)}>
            {hypeOpen ? t("hide the hype") : t("+ {n} hype posts (lfg, send it, cap targets)", { n: hype.length })}
          </button>
        )}
        <p className="x-fine">{t("Theses are what traders wrote on fomo.family when they bought, via fomoapi.io.")}</p>
      </Pn>
    </>
  );
}

/* ------------------------------------------------------------------ deep: trace, SOL, wallets */

/** Under a locked deep panel: what the free check will be, or the "opens in a few days" note once it is asked for. */
function DeepNote() {
  const free = useFreeDeepCheck(null);
  return <p className="x-fine">{free.message ? t(free.message) : t("One free deep check a week opens soon. Pro will open it on every coin.")}</p>;
}

function Locked({ x, title, what, graph }: { x: Ctx; title: string; what: string; graph?: boolean }) {
  return (
    <>
      <Pn span="x-s8" title={title} tag={t("Pro")} meta={t("deep check")}>
        <div className="x-lock">
          {graph && <TraceGraph r={x.r} deep={false} />}
          <LockRow text={what} onUnlock={x.unlock} label={t("Free deep check")} />
          <DeepNote />
        </div>
      </Pn>
      <ProPanel access={x.access} span="x-s4" />
    </>
  );
}

export function TraceSection(x: Ctx) {
  const { r, access, onPick } = x;
  const fund = r.funding;
  if (!access.deep) return <Locked x={x} graph title={t("Funding trace")} what={t("Who paid for the dev, what else that wallet paid for, and how the dev's launches tie together on one map.")} />;
  const groups = r.bundle?.funding?.groups ?? [];
  return (
    <>
      <Pn span="x-s5" title={t("Who paid for the creator")} meta={evm(r) ? where(r) : t("traced on Solana")}>
        {!fund && <p className="x-note">{evm(r) ? t("Not traced on {chain}: the zoo reads {venue}'s launches and trades there, not wallet transfers yet.", { chain: where(r), venue: venueOfChain(r.mint) }) : t("Not traced yet. It is queued: open this again in a minute.")}</p>}
        {fund && !fund.funder && <p className="x-note">{t("No funding transfer in the creator's recent history.")}</p>}
        {fund?.funder && (
          <>
            <Kv flush rows={[[t("Funded by"), <button key="f" type="button" className="x-link" onClick={() => openWallet(fund.funder!)}><code>{short(fund.funder)}</code></button>]]} />
            {fund.funderIsHot ? (
              <p className="x-note" style={{ marginTop: 8 }}>
                {fund.funderService
                  ? t("{x}'s launcher: it pays for the creator wallet of every token launched through {x}, so the other creators it funded are other {x} launches, not a ring.", { x: fund.funderService })
                  : fund.funderLabel
                    ? t("A withdrawal from {x}: the dev's SOL came out of an exchange account. It names the exchange, not the person, and ties no one together.", { x: fund.funderLabel })
                    : t("An exchange or a router: it funds everyone, so it ties no one together.")}
              </p>
            ) : (
              <>
                <Kv rows={[[t("Other creators it funded"), String(fund.siblings.length), fund.siblings.length >= 2 ? "d" : ""], [t("Their launches · dumps, 48 h"), `${fund.siblingLaunches48h} · ${fund.siblingDumped48h}`, fund.siblingDumped48h >= 3 ? "d" : ""]]} />
                {fund.siblings.length > 0 && (
                  <Kv rows={fund.siblings.slice(0, 8).map((s) => [short(s.wallet), t("{l} launched · {d} dumped", { l: s.launches48h, d: s.dumped }), s.dumped >= 1 ? "d" : ""])} />
                )}
              </>
            )}
          </>
        )}
        {groups.length > 0 && (
          <>
            <p className="x-h3">{t("Bundle wallets by funder")}</p>
            <Kv flush rows={groups.slice(0, 6).map((g) => [short(g.funder), t("paid {n} bundle wallets", { n: g.wallets.length }), g.wallets.length >= 3 ? "d" : ""])} />
          </>
        )}
      </Pn>
      <Pn span="x-s7" title={t("Network")} meta={t("the dev, his wallets, who paid, his launches")}>
        <NetworkMap r={r} onPick={onPick} onWallet={openWallet} />
      </Pn>
    </>
  );
}

export function SolSection(x: Ctx) {
  if (!x.access.deep) return <Locked x={x} title={t("Where the SOL went")} what={t("Where the dev and the first wallets sent the SOL they took out, hop by hop, until it reaches an exchange or stops.")} />;
  return (
    <Pn span="x-s12" title={t("Where the SOL went")} meta={t("who paid, who sold, where it went")}>
      <MoneyMap r={x.r} />
    </Pn>
  );
}

export function WalletsSection(x: Ctx) {
  const { r, access, onPick, unlock } = x;
  const [sel, setSel] = useState<string | null>(null);
  if (!r.early.length)
    return (
      <Pn span="x-s12" title={t("All wallets")}>
        <p className="x-note">{r.outsideStream ? t("This coin launched before our stream, so its first wallets are not on record.") : t("Nobody bought in the first seconds, so there are no early wallets to list.")}</p>
      </Pn>
    );
  return (
    <Pn span="x-s12" title={t("All wallets")} tag={access.deep ? undefined : t("history: Pro")} meta={t("{n} in the first seconds · tap one for who it is", { n: r.early.length })}>
      <div className="x-tbl">
        <div className="x-tr x-th">
          <span>{t("wallet")}</span>
          <span>{t("who")}</span>
          <span>{t("took")}</span>
          <span>{t("holds")}</span>
          <span>{t("in at")}</span>
          <span>{t("sold out")}</span>
          <span>{t("snipes 48h")}</span>
        </div>
        {r.early.map((e) => {
          const k = KIND[kindOf(e)];
          const on = sel === e.wallet;
          return (
            <div key={e.wallet}>
              <button type="button" className={`x-tr ${on ? "on" : ""}`} onClick={() => setSel(on ? null : e.wallet)} aria-expanded={on}>
                <span className="x-w0">
                  <i style={{ background: k.color }} />
                  <span>{e.smart?.name ? `${e.smart.name} · ${short(e.wallet)}` : short(e.wallet)}</span>
                  <Tags tags={e.tags?.filter((g) => !KIND_TAGS.has(g))} className="hidden sm:inline-flex" />
                </span>
                <span style={{ color: k.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(k.label)}</span>
                <span>{pctFine(e.bought)}</span>
                <span className={e.held >= 0.05 ? "x-d" : ""}>{pctFine(e.held)}</span>
                <span>{e.afterSec}s</span>
                <span>{secs(e.exitSec)}</span>
                <span className={e.snipes48h >= 10 ? "x-w" : ""}>{e.snipes48h}</span>
              </button>
              {on && (
                <div className="x-detail">
                  <Dossier e={e} creator={r.creator} onPick={onPick} deep={access.deep} onUnlock={unlock} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Pn>
  );
}

