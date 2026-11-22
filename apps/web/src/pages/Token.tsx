import { type ReactNode, useEffect, useState } from "react";
import { BOT_URL, ZOOAGENCY_CLAWPUMP_URL, ZOOAGENCY_DEXSCREENER_URL, ZOOAGENCY_MINT, ZOOAGENCY_SOLSCAN_URL } from "../links";
import { pick, t } from "../i18n";
import { CaRow, TokenDot } from "../components/site/ZooToken";
import { Corners } from "../components/roadmap/Timeline";
import RollNumber from "../components/site/RollNumber";

/** The market as DexScreener reads the pool right now. Nothing here comes from us, so nothing here is a claim of ours. */
interface Market {
  priceUsd: number;
  marketCap: number;
  liquidityUsd: number;
  volume24h: number;
  change24h: number;
}

function useMarket(): Market | null {
  const [m, setM] = useState<Market | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      fetch(`https://api.dexscreener.com/latest/dex/tokens/${ZOOAGENCY_MINT}`)
        .then((r) => r.json())
        .then((d: { pairs?: Array<{ priceUsd?: string; marketCap?: number; fdv?: number; liquidity?: { usd?: number }; volume?: { h24?: number }; priceChange?: { h24?: number } }> }) => {
          const p = d.pairs?.[0];
          if (!live || !p) return;
          setM({ priceUsd: Number(p.priceUsd ?? 0), marketCap: p.marketCap ?? p.fdv ?? 0, liquidityUsd: p.liquidity?.usd ?? 0, volume24h: p.volume?.h24 ?? 0, change24h: p.priceChange?.h24 ?? 0 });
        })
        .catch(() => {});
    read();
    const id = setInterval(read, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return m;
}

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);

function Head({ n, tag, title, grey, lead, id }: { n: number; tag: string; title: string; grey: string; lead?: string; id: string }) {
  return (
    <div id={id} className="scroll-mt-20">
      <p className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
        <span className="inline-flex h-[22px] items-center rounded-[4px] border border-line-2 px-2 text-fg-3">{t(tag)}</span>
        <span>
          <span className="text-white">{String(n).padStart(2, "0")}</span> / 03
        </span>
      </p>
      <h2 className="mt-6 max-w-[20ch] text-[clamp(30px,5vw,52px)] font-semibold leading-[1] tracking-[-0.045em] text-white">
        {t(title)} <span className="text-faint">{t(grey)}</span>
      </h2>
      {lead && <p className="mt-5 max-w-[62ch] text-[15px] leading-[1.6] text-fg-3 sm:text-[16px]">{t(lead)}</p>}
    </div>
  );
}

function Go({ href, primary, children }: { href: string; primary?: boolean; children: ReactNode }) {
  const ext = href.startsWith("http");
  return (
    <a
      href={href}
      target={ext ? "_blank" : undefined}
      rel={ext ? "noopener noreferrer" : undefined}
      className={`inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-[7px] px-3.5 text-[12.5px] font-medium ${primary ? "bg-white text-night hover:bg-lit-hover" : "border border-line-2 text-white hover:border-[#4a524e]"}`}
    >
      {children}
      <span className={primary ? "" : "text-faint"}>{ext ? "↗" : "→"}</span>
    </a>
  );
}

/** One thing the token does today: what it is, exactly how to get it, and where. */
function Perk({ k, title, text, how, href, cta }: { k: string; title: string; text: string; how: string; href?: string; cta?: string }) {
  return (
    <div className="rm-frame">
      <Corners />
      <div className="rm-box flex h-full flex-col p-5 sm:p-6">
        <p className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.1em]">
          <span className="text-faint">{k}</span>
          <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-white px-1.5 leading-[16px] text-night">
            <span className="h-[5px] w-[5px] rounded-full bg-night" />
            {t("Live")}
          </span>
        </p>
        <h3 className="mt-4 text-[20px] font-semibold leading-[1.15] tracking-[-0.03em] text-white">{t(title)}</h3>
        <p className="mt-2 text-[13.5px] leading-[1.6] text-fg-3">{t(text)}</p>
        <p className="mt-4 border-t border-line pt-3 text-[12.5px] leading-[1.55] text-fg-4">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">{t("How")} · </span>
          {t(how)}
        </p>
        {href && cta && (
          <div className="mt-auto pt-5">
            <Go href={href}>{t(cta)}</Go>
          </div>
        )}
      </div>
    </div>
  );
}

/** A step in the Pro money flow. */
function Step({ n, title, text, last }: { n: number; title: string; text: string; last?: boolean }) {
  return (
    <li className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-4 pb-7 last:pb-0">
      {!last && <span className="absolute bottom-0 left-[15.5px] top-[32px] w-px border-l border-dashed border-[#4a524e]" />}
      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-[#7d8681] font-mono text-[12px] text-fg-3">{n}</span>
      <div className="min-w-0 pt-1">
        <p className="text-[16px] font-medium tracking-[-0.01em] text-white">{t(title)}</p>
        <p className="mt-1 max-w-[60ch] text-[13.5px] leading-[1.6] text-fg-4">{t(text)}</p>
      </div>
    </li>
  );
}

export default function Token() {
  const m = useMarket();
  const stat = (k: string, v: string | null, tone?: string) => (
    <div className="min-w-0 border-l border-line px-4 py-4 first:border-l-0 sm:px-5">
      <p className="text-[12px] text-dim">{t(k)}</p>
      <p className={`mt-2 text-[clamp(20px,2.4vw,28px)] font-semibold leading-none tracking-[-0.04em] ${tone ?? "text-white"}`}>{v ? <RollNumber text={v} /> : "-"}</p>
    </div>
  );
  return (
    <div>
      {/* the hero: what it is in one line, the address, where to buy, the market now */}
      <section className="mx-auto max-w-[1440px] px-4 pb-[clamp(56px,7vw,104px)] pt-8 sm:px-5 sm:pt-12 lg:px-[86px]">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          <TokenDot className="!h-[18px] !w-[18px]" />
          $ZOOAGENCY · Solana
        </p>
        <div className="mt-5 grid gap-x-12 gap-y-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end">
          <h1 className="text-[clamp(38px,5.4vw,72px)] font-semibold leading-[0.97] tracking-[-0.05em] text-white">
            {t("What the token does.")} <span className="text-faint">{t("Today, and once Pro opens.")}</span>
          </h1>
          <div>
            <p className="max-w-[54ch] text-[15px] leading-[1.6] text-fg-3 sm:text-[16px]">
              {t("The x-ray is free for everyone and stays free. The token is how holders get more out of it today, and how Pro's revenue comes back to the token once Pro opens.")}
            </p>
            <CaRow id="token-ca" className="mt-6 max-w-[520px]" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Go href={ZOOAGENCY_CLAWPUMP_URL} primary>
                {t("Buy on ClawPump")}
              </Go>
              <Go href={ZOOAGENCY_DEXSCREENER_URL}>DexScreener</Go>
              <Go href={ZOOAGENCY_SOLSCAN_URL}>Solscan</Go>
            </div>
          </div>
        </div>
        <div className="rm-frame mt-[clamp(32px,4vw,56px)]">
          <Corners />
          <div className="rounded-[2px] border border-line-2 bg-night-surface">
            <div className="flex h-10 items-center justify-between border-b border-line px-4 font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint sm:px-5">
              <span>{t("The market now")}</span>
              <span className="hidden sm:inline">{t("from DexScreener, every minute")}</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 [&>div:nth-child(3)]:border-l-0 lg:[&>div:nth-child(3)]:border-l [&>div:nth-child(n+3)]:border-t lg:[&>div:nth-child(n+3)]:border-t-0 [&>div]:border-line">
              {stat("Market cap", m ? usd(m.marketCap) : null)}
              {stat("Price", m ? `$${m.priceUsd.toPrecision(3)}` : null)}
              {stat("Liquidity", m ? usd(m.liquidityUsd) : null)}
              {stat("Volume, 24 h", m ? usd(m.volume24h) : null)}
            </div>
          </div>
        </div>
      </section>

      {/* today */}
      <section className="rm-hatch border-y border-line px-3 py-6 sm:px-5 sm:py-8">
        <div className="mx-auto max-w-[1268px] border border-line bg-night px-4 py-[clamp(36px,5vw,72px)] sm:px-[clamp(20px,4vw,48px)]">
          <Head id="today" n={1} tag="Today" title="What it does now." grey="All of it live." lead="Hold 500,000 $ZOOAGENCY in a Solana wallet. Nothing is locked or staked: the balance is read when it is needed." />
          <div className="mt-10 grid gap-7 md:grid-cols-2 xl:grid-cols-3">
            <Perk k="01" title="Creator fees buy the token back" text="The creator fees the coin earns on its trading go to buying $ZOOAGENCY back. Every buyback is listed on ClawPump with its transaction." how="Nothing to do: every trade of the coin pays into it." href={ZOOAGENCY_CLAWPUMP_URL} cta="Every buyback on ClawPump" />
            <Perk k="02" title="The weekly contest" text="Holders call each night's coins against our odds model; the market grades every call the next day, in public standings." how="Hold 500k and sign in with that wallet on the contests page. Signing costs nothing." href="/contests" cta="Contests" />
            <Perk k="03" title="Alerts 10 minutes first" text="When a coin you watch turns, the dev dumps or the pool drains, holders hear it 10 minutes before everyone else." how="Hold 500k, then /link your wallet in the Telegram bot." href={BOT_URL} cta="Telegram bot" />
            <Perk k="04" title="Radar pings in the bot" text="Fresh coins that read clean on the full check, and a ping the moment one of them turns." how="Hold 500k, /link your wallet, then /radar on in the bot." href={BOT_URL} cta="Telegram bot" />
            <Perk k="05" title="Ten times the API" text="A holder key lifts the API from 120 checks and 10 x-rays a minute to 1,200 checks and 300 x-rays." how="Sign once with the wallet that holds 500k on the connect page; the key works while it holds." href="/connect" cta="Get a key" />
          </div>
        </div>
      </section>

      {/* when Pro opens */}
      <section className="mx-auto max-w-[1440px] px-4 py-[clamp(64px,9vw,128px)] sm:px-5 lg:px-[86px]">
        <Head id="pro" n={2} tag="Soon" title="When Pro opens," grey="Pro's revenue comes back to the token." lead="Pro is the deep x-ray: who funded the buyers four hops back, where the SOL went, every early wallet's history, all the callers and a Telegram ping the second the dev starts selling. It is not open yet, and there is no price or date here until it is." />
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ol className="min-w-0">
            <Step n={1} title="Pay in USDC, or in $ZOOAGENCY at 25% off" text="Two ways to pay for the same Pro. Paying in the token costs a quarter less." />
            <Step n={2} title="Every $ZOOAGENCY paid is burned" text="Not kept, not sold: tokens paid for Pro leave the supply for good." />
            <Step n={3} title="A cut of the USDC buys back and burns" text="Part of what is paid in USDC buys $ZOOAGENCY on the market and burns it. The cut grows as revenue grows." last />
          </ol>
          <div className="rm-frame">
            <Corners />
            <div className="rm-box flex h-full flex-col justify-center p-6 sm:p-8">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">{t("In one line")}</p>
              <p className="mt-4 text-[clamp(22px,2.4vw,30px)] font-semibold leading-[1.2] tracking-[-0.035em] text-white">{t("The more people pay for Pro, the more $ZOOAGENCY is bought and burned.")}</p>
              <p className="mt-5 text-[13.5px] leading-[1.6] text-fg-4">{t("Every buyback is on chain. The creator-fee buybacks are listed on ClawPump today, each with its transaction; the Pro ones will be linked from here.")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* what it is not */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[1440px] px-4 py-[clamp(64px,9vw,128px)] sm:px-5 lg:px-[86px]">
          <Head id="not" n={3} tag="Plainly" title="What it is not." grey="So nobody has to guess." />
          <ul className="mt-10 grid gap-x-10 border-t border-line md:grid-cols-2">
            {[
              ["Not a paywall on safety.", "The verdict, the odds and the dev's record stay free for everyone, holder or not."],
              ["No staking, no lock.", "Holding is read from your wallet. Sell and the perks stop, buy back and they return."],
              ["No price promise.", "Buybacks and burns are how revenue reaches the token. What the price does is the market's."],
              ["Not financial advice.", "Everything we show is read from public chain data. Ape if you want, just know who you are aping into."],
            ].map(([a, b]) => (
              <li key={a} className="border-b border-line py-5">
                <p className="text-[16px] font-medium tracking-[-0.01em] text-white">{t(a!)}</p>
                <p className="mt-1.5 text-[13.5px] leading-[1.6] text-fg-4">{t(b!)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-[13px] text-dim">
            {pick("Contract", "合约")} <code className="font-mono text-fg-3">{ZOOAGENCY_MINT}</code> · {pick("launched on ClawPump", "在 ClawPump 发行")} · <a href="/roadmap" className="text-fg-2 underline decoration-[#4a524e] underline-offset-4 hover:text-white">{pick("roadmap", "路线图")}</a>
          </p>
        </div>
      </section>
    </div>
  );
}
