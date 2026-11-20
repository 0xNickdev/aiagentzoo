import { type ReactNode, useEffect, useState } from "react";
import { t } from "../../i18n";
import { shortOr } from "../../format";
import { full, NORTH, SITE_XRAY, ticker } from "./live";
import { Panel } from "../site/Panel";

type Verdict = "pass" | "caution" | "avoid";
interface Check {
  mint: string;
  symbol?: string;
  verdict?: Verdict;
  reasons?: string[];
  facts?: { earlyWallets?: number; creatorLaunches24h?: number; creatorDumped48h?: number; buyers?: number; bundlers?: number };
  odds?: { run: number; at?: string };
}

const VERDICT: Record<Verdict, { label: string; text: string; dot: string }> = {
  pass: { label: "no red flags", text: "text-moss", dot: "bg-moss" },
  caution: { label: "caution", text: "text-warn", dot: "bg-warn" },
  avoid: { label: "avoid", text: "text-danger", dot: "bg-danger" },
};

const pctOf = (p: number) => {
  const v = p * 100;
  return v >= 10 ? String(Math.round(v)) : v >= 0.1 ? v.toFixed(1) : v > 0 ? v.toFixed(2) : "0";
};

function Step({ n, title, text, children }: { n: number; title: string; text: string; children?: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col border-line p-3.5 sm:p-4 [&:not(:last-child)]:border-b md:[&:not(:last-child)]:border-b-0 md:[&:not(:last-child)]:border-r">
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[12px] text-faint">0{n}</span>
        <h3 className="text-[15px] font-medium text-white">{title}</h3>
      </div>
      <p className="mt-1.5 text-[13px] leading-[1.5] text-fg-2">{text}</p>
      {children && <div className="mt-3.5 md:mt-auto md:pt-3.5">{children}</div>}
    </li>
  );
}

/** Three steps, each with a live example: one real coin from the feed, read the way the X-Ray reads it. */
export default function HowItWorks({ sample }: { sample?: { mint: string; symbol: string } }) {
  const [check, setCheck] = useState<Check | null>(null);
  const mint = sample?.mint;
  useEffect(() => {
    if (!NORTH || !mint) return;
    let live = true;
    fetch(`${NORTH}/v1/check/${mint}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Check | null) => live && b?.verdict && setCheck(b))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mint]);

  const f = check?.facts;
  const facts = f
    ? ([
        f.creatorLaunches24h != null && [t("dev's launches, last 24h"), full(f.creatorLaunches24h), f.creatorLaunches24h > 3],
        f.creatorDumped48h != null && [t("of them dumped, 48h"), full(f.creatorDumped48h), f.creatorDumped48h > 0],
        f.earlyWallets != null && [t("wallets in the first seconds"), full(f.earlyWallets), false],
      ].filter(Boolean) as Array<[string, string, boolean]>)
    : [];
  const v = check?.verdict ? VERDICT[check.verdict] : null;

  return (
    <Panel title={t("How it works")} meta={check ? t("a coin from the feed, read just now") : t("free, no sign-up")} className="lg:col-span-12" bodyClass="p-0">
      <ol className="grid grid-cols-1 md:grid-cols-3">
        <Step n={1} title={t("Paste a token")} text={t("Any Solana token address or link: pump.fun, LaunchLab, Meteora.")}>
          {check && (
            <a href={SITE_XRAY(check.mint)} className="flex h-10 items-center gap-2.5 rounded-[8px] border border-line-2 bg-night px-3 hover:border-[#3a4640]">
              <span className="text-[13px] font-medium text-white">{ticker(check.symbol, check.mint)}</span>
              <span className="truncate font-mono text-[12px] text-dim">{shortOr(check.mint)}</span>
            </a>
          )}
        </Step>
        <Step n={2} title={t("We read the chain")} text={t("The dev's other launches, who bought in the first seconds, who paid for those wallets. Straight from Solana, in a few seconds.")}>
          {facts.length > 0 && (
            <ul className="border-t border-line">
              {facts.map(([k, val, bad]) => (
                <li key={k} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-[12.5px]">
                  <span className="text-dim">{k}</span>
                  <span className={`font-medium tabular-nums ${bad ? "text-danger" : "text-white"}`}>{val}</span>
                </li>
              ))}
            </ul>
          )}
        </Step>
        <Step n={3} title={t("You get a verdict and the odds")} text={t("Avoid, caution or no red flags, with the reason, and how likely the coin is still trading tomorrow.")}>
          {check && v && (
            <div className="rounded-[8px] border border-line-2 bg-night p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className={`inline-flex items-center gap-2 text-[13px] font-medium ${v.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />
                  {t(v.label)}
                </span>
                {check.odds && Number.isFinite(check.odds.run) && (
                  <span className="text-[13px] text-fg-2">
                    <b className="text-[18px] font-medium tracking-[-0.03em] text-white">{pctOf(check.odds.run)}%</b> {t("alive tomorrow")}
                  </span>
                )}
              </div>
              {check.reasons?.[0] && <p className="mt-2 line-clamp-2 text-[12px] leading-[1.45] text-dim">{check.reasons[0]}</p>}
            </div>
          )}
        </Step>
      </ol>
    </Panel>
  );
}
