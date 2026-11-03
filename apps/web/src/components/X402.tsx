import { useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Reveal, Section, SectionHead } from "./ui";
import { t } from "../i18n";
import { shortFit } from "../format";
import { useLive } from "../hooks";

const NORTH = NODE_URLS.find((u) => u.includes("north")) ?? NODE_URLS[0] ?? "";
const when = (at: number) => new Date(at).toISOString().slice(5, 16).replace("T", " ");

interface Network {
  network: string;
  cluster: string;
  asset: { symbol: string; mint: string };
  payTo: string;
  feePayer: string;
}
interface Menu {
  networks: Network[];
  resources: Array<{ url: string; price: { usdc: number }; description: string }>;
}
interface Receipt {
  at: number;
  route: string;
  mint: string;
  payer: string;
  network: string;
  transaction: string;
  reportSha256: string;
  verdict: string | null;
}
interface Receipts {
  totals: { paid: number; usdc: number; refusedBeforeSettle: number; settleFailed: number; byNetwork?: Record<string, { paid: number; usdc: number }> };
  receipts: Receipt[];
}

const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

const VERDICT: Record<string, string> = { avoid: "text-[#ff8a7e]", caution: "text-[#f3c97a]", pass: "text-[#a6e3b4]" };

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="bg-night-surface px-5 py-4">
      <p className="text-[12px] text-fg-4 [&::first-letter]:uppercase">{k}</p>
      <p className="mt-2 text-[26px] leading-none text-fg tabular-nums">{v}</p>
      {sub && <p className="mt-2 text-[13px] text-fg-4">{sub}</p>}
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-night-surface p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-xl text-fg">{title}</h3>
        {note && <span className="text-[12px] text-fg-4">{note}</span>}
      </div>
      {children}
    </div>
  );
}

const STEPS: Array<[string, string]> = [
  ["Ask", "The agent calls GET /v1/x402/check/<mint> like any API. No key, no sign-up."],
  ["402", "The node answers 402 with PAYMENT-REQUIRED: the price in USDC, the USDC mint, who gets paid and the fee payer."],
  ["Sign", "The agent's x402 client signs a USDC transfer for exactly that amount and retries with PAYMENT-SIGNATURE."],
  ["Verify, then build", "The node checks the transfer (amount, mint, payee, a simulation) and only then builds the report."],
  ["Settle", "The node co-signs as fee payer and lands the transfer on Solana. No report, no settlement: the agent is not charged."],
  ["Deliver", "200 with the report, the transaction in PAYMENT-RESPONSE, and the sha256 of the exact bytes sold, also kept in the public log."],
];

const SNIPPET = `import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { toClientSvmSigner } from "@x402/svm";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const pay = wrapFetchWithPayment(fetch,
  new x402Client().register("solana:*", new ExactSvmScheme(toClientSvmSigner(signer))));

const check = await (await pay(\`https://north.zooaiagency.com/v1/x402/check/\${mint}\`)).json();
if (check.verdict === "avoid") return; // the agent does not buy`;

/** Shows the real 402 a caller gets for a coin, decoded, with no wallet needed. */
function Probe() {
  const [mint, setMint] = useState("");
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const m = mint.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) return setOut(t("Paste a Solana token address."));
    setBusy(true);
    try {
      const r = await fetch(`${NORTH}/v1/x402/check/${m}`);
      const header = r.headers.get("payment-required");
      const decoded = header ? (JSON.parse(atob(header)) as unknown) : await r.json();
      setOut(`HTTP ${r.status}\nPAYMENT-REQUIRED (decoded):\n${JSON.stringify(decoded, null, 2)}`);
    } catch {
      setOut(t("The node did not answer. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t("See the 402 yourself")} note={t("a real request, unpaid")}>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input value={mint} onChange={(e) => setMint(e.target.value)} placeholder={t("token address")} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-[14px] text-fg outline-none placeholder:text-fg-4 focus:border-white/30" />
        <button disabled={busy} className="rounded-xl bg-white px-5 py-3 text-[14px] font-medium text-black transition hover:bg-white/85 disabled:opacity-50">
          {busy ? t("Asking…") : t("Ask without paying")}
        </button>
      </form>
      {out && <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-black/40 p-4 text-[12px] leading-relaxed text-fg-3">{out}</pre>}
    </Card>
  );
}

/** x402 on Solana: what an agent pays for, how the payment flows, and every sale so far, live. */
export default function X402() {
  const menu = useLive<Menu>(`${NORTH}/v1/x402`, 300_000);
  const sales = useLive<Receipts>(`${NORTH}/v1/x402/receipts?limit=30`);
  // Explorer links point at the cluster each payment was made on: mainnet has no cluster parameter.
  const clusterOf = (caip2: string) => (caip2 === MAINNET ? "" : "?cluster=devnet");
  const tx = (s: string, caip2: string) => `https://explorer.solana.com/tx/${s}${clusterOf(caip2)}`;
  const acct = (a: string, caip2: string) => `https://explorer.solana.com/address/${a}${clusterOf(caip2)}`;
  const tot = sales?.totals;
  const real = tot?.byNetwork?.[MAINNET];
  const test = tot?.byNetwork?.[DEVNET];
  const clusters = menu ? menu.networks.map((n) => (n.cluster === "mainnet-beta" ? "mainnet" : n.cluster)).join(" + ") : "";

  return (
    <Section className="!pt-10">
      <SectionHead
        eyebrow={clusters ? t("x402 · Solana {c} · live", { c: clusters }) : t("x402 · Solana · live")}
        title={[t("Pay per check."), t("No key, no account.")]}
        text={t("A trading agent asks who is behind a coin before it buys and pays for the answer in USDC over plain HTTP. The node verifies the payment, builds the report, and settles only when there is a report to deliver.")}
      />

      <div className="mx-auto max-w-7xl space-y-4">
        <Reveal className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.06] lg:grid-cols-4">
          <Tile k={t("paid on mainnet")} v={tot ? String(real?.paid ?? 0) : "…"} sub={tot ? t("{u} real USDC", { u: (real?.usdc ?? 0).toFixed(3) }) : ""} />
          <Tile k={t("paid on devnet")} v={tot ? String(test?.paid ?? 0) : "…"} sub={tot ? t("{u} test USDC", { u: (test?.usdc ?? 0).toFixed(3) }) : ""} />
          <Tile k={t("not charged")} v={tot ? String(tot.refusedBeforeSettle) : "…"} sub={t("verified, but nothing to sell")} />
          <Tile k={t("settlements failed")} v={tot ? String(tot.settleFailed) : "…"} sub={t("report withheld")} />
        </Reveal>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <Reveal>
            <Card title={t("The menu")} note={menu ? t("USDC on {c}", { c: clusters }) : ""}>
              <ul className="space-y-4">
                {(menu?.resources ?? []).map((r) => (
                  <li key={r.url} className="border-t border-white/[0.08] pt-4 first:border-t-0 first:pt-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <code className="truncate text-[13px] text-fg-2">GET {r.url.replace("https://north.zooaiagency.com", "")}</code>
                      <span className="shrink-0 text-[15px] text-fg tabular-nums">{r.price.usdc} USDC</span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-fg-4">{t(r.description)}</p>
                  </li>
                ))}
                {!menu && <li className="text-[13px] text-fg-4">{t("Reading the node…")}</li>}
              </ul>
              {menu?.networks.map((n) => (
                <p key={n.network} className="mt-3 text-[12px] text-fg-4 first-of-type:mt-5">
                  {n.network === MAINNET ? t("mainnet") : t("devnet")}: {t("paid to")}{" "}
                  <a href={acct(n.payTo, n.network)} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-white">
                    {shortFit(n.payTo)}
                  </a>{" "}
                  · {t("network fee paid by the node")}{" "}
                  <a href={acct(n.feePayer, n.network)} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-white">
                    {shortFit(n.feePayer)}
                  </a>
                </p>
              ))}
            </Card>
          </Reveal>
          <Reveal delay={0.05}>
            <Probe />
          </Reveal>
        </div>

        <Reveal>
          <Card title={t("How one paid request goes")} note={t("x402 v2, exact scheme, SPL USDC")}>
            <ol className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {STEPS.map(([k, v], i) => (
                <li key={k} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 text-[12px] text-fg-3 tabular-nums">{i + 1}</span>
                  <div>
                    <p className="text-[15px] text-fg">{t(k)}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-fg-4">{t(v)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </Reveal>

        <Reveal>
          <Card title={t("Every sale, live")} note={t("each report's sha256 is also in the node's signed public log")}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px] tabular-nums">
                <thead className="text-[12px] text-fg-4">
                  <tr className="border-b border-white/[0.08]">
                    <th className="py-2 pr-4 font-normal">{t("time UTC")}</th>
                    <th className="py-2 pr-4 font-normal">{t("bought")}</th>
                    <th className="py-2 pr-4 font-normal">{t("coin")}</th>
                    <th className="py-2 pr-4 font-normal">{t("verdict sold")}</th>
                    <th className="py-2 pr-4 font-normal">{t("agent")}</th>
                    <th className="py-2 pr-4 font-normal">{t("payment")}</th>
                    <th className="py-2 font-normal">{t("report sha256")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(sales?.receipts ?? []).map((r) => (
                    <tr key={r.transaction} className="border-t border-white/[0.06] text-fg-3">
                      <td className="py-2 pr-4 text-fg-4">{when(r.at)}</td>
                      <td className="py-2 pr-4">{r.route === "xray" ? "X-Ray" : t("check")}</td>
                      <td className="py-2 pr-4">
                        <a href={`/xray?mint=${r.mint}`} className="underline decoration-white/20 underline-offset-4 hover:text-white">
                          {shortFit(r.mint)}
                        </a>
                      </td>
                      <td className={`py-2 pr-4 ${VERDICT[r.verdict ?? ""] ?? "text-fg-4"}`}>{r.verdict ?? "-"}</td>
                      <td className="py-2 pr-4">
                        <a href={acct(r.payer, r.network)} target="_blank" rel="noopener noreferrer" className="hover:text-white">
                          {shortFit(r.payer)}
                        </a>
                      </td>
                      <td className="py-2 pr-4">
                        <a href={tx(r.transaction, r.network)} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-white">
                          {r.network === MAINNET ? "" : "devnet · "}
                          {shortFit(r.transaction, 6)} ↗
                        </a>
                      </td>
                      <td className="py-2 text-fg-4">{r.reportSha256.slice(0, 12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sales && sales.receipts.length === 0 && <p className="py-6 text-center text-[13px] text-fg-4">{t("No sales yet.")}</p>}
              {!sales && <p className="py-6 text-center text-[13px] text-fg-4">{t("Reading the node…")}</p>}
            </div>
          </Card>
        </Reveal>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <Reveal>
            <Card title={t("From your agent")} note="@x402/fetch + @x402/svm">
              <pre className="overflow-x-auto rounded-xl bg-black/40 p-4 text-[12px] leading-relaxed text-fg-3">{SNIPPET}</pre>
              <p className="mt-4 text-[13px] text-fg-4">
                {t("A ready agent that refuses the swap on avoid:")}{" "}
                <a href="https://github.com/0xNickdev/aiagentzoo/tree/main/examples/x402-agent" target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-4 hover:text-white">
                  examples/x402-agent
                </a>
              </p>
            </Card>
          </Reveal>
          <Reveal delay={0.05}>
            <Card title={t("When you are not charged")}>
              <ul className="space-y-3 text-[14px] leading-relaxed text-fg-3">
                <li>{t("The payment does not verify: 402 with the reason, nothing is built.")}</li>
                <li>{t("The zoo knows nothing about the coin: the answer goes out free.")}</li>
                <li>{t("The node cannot build the report: you get the error, the signed transfer is never sent and expires.")}</li>
                <li>{t("The transfer fails on chain: 402 with the reason, the report is withheld.")}</li>
                <li>{t("You cannot name your own price: the node always checks the payment against its own.")}</li>
              </ul>
              <p className="mt-5 text-[12px] text-fg-4">{t("The agent needs USDC only: the node pays the Solana network fee.")}</p>
            </Card>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
