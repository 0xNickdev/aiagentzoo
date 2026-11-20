import { useEffect, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { Page, Panel, Tile } from "./site/Panel";
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

const VERDICT: Record<string, string> = { avoid: "text-danger", caution: "text-warn", pass: "text-lit" };

function Card({ title, note, className = "", children }: { title: string; note?: string; className?: string; children: React.ReactNode }) {
  return (
    <Panel title={title} meta={note} className={className}>
      {children}
    </Panel>
  );
}

const LINK = "underline decoration-line-2 underline-offset-4 hover:text-white";
const PRE = "rounded-[9px] border border-line bg-night p-3 font-mono text-[11.5px] leading-[1.6] text-fg-2";

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
  new x402Client().register(DEVNET, new ExactSvmScheme(toClientSvmSigner(signer))));
// DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"; mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"

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
    <Card title={t("See the 402 yourself")} note={t("a real request, unpaid")} className="lg:col-span-6">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input value={mint} onChange={(e) => setMint(e.target.value)} placeholder={t("token address")} aria-label={t("token address")} className="h-9 min-w-0 shrink-0 rounded-[7px] border border-line-2 bg-night px-3 font-mono sm:flex-1 text-[12.5px] text-white outline-none placeholder:font-sans placeholder:text-faint focus:border-lit-edge" />
        <button disabled={busy} className="btn-primary h-9 rounded-[7px] px-4 text-[12.5px] font-medium disabled:opacity-50">
          {busy ? t("Asking…") : t("Ask without paying")}
        </button>
      </form>
      {!out && <p className="mt-3 text-[12px] leading-[1.55] text-dim">{t("Paste any Solana token: the node answers 402 with its price, and the PAYMENT-REQUIRED header is decoded here. No wallet, nothing is paid.")}</p>}
      {out && <pre className={`mt-3 max-h-80 overflow-auto ${PRE}`}>{out}</pre>}
    </Card>
  );
}

/** The prompt a builder pastes into a coding agent, which wires the paid check into their bot. Served as a file too. */
function AgentPrompt() {
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch("/x402-agent-prompt.txt")
      .then((r) => (r.ok ? r.text() : null))
      .then(setText)
      .catch(() => {});
  }, []);
  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the text stays on screen to select by hand */
    }
  };
  return (
    <Card title={t("Paste this into your coding agent")} note={t("Claude Code, Cursor, Codex")} className="lg:col-span-12">
      <p className="text-[12.5px] leading-[1.6] text-fg-2">{t("It wires the paid check into your trading bot: one call before every swap, no trade on avoid, the wallet key kept in an environment variable.")}</p>
      <pre className={`mt-3 max-h-56 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] ${PRE}`}>{text ?? t("Loading…")}</pre>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={() => void copy()} disabled={!text} className="btn-primary h-8 rounded-[7px] px-3 text-[12.5px] font-medium disabled:opacity-50">
          {copied ? t("Copied") : t("Copy the prompt")}
        </button>
        <a href="/x402-agent-prompt.txt" target="_blank" rel="noopener noreferrer" className={`text-[12px] text-dim ${LINK}`}>
          {t("or give your agent this link")}
        </a>
      </div>
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
    <Page
      title={t("Pay per check with x402")}
      lead={t("A trading agent asks who is behind a coin before it buys and pays for the answer in USDC over plain HTTP. The node verifies the payment, builds the report, and settles only when there is a report to deliver.")}
      side={
        <span className="flex items-center gap-2 text-[12px] text-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-lit" />
          {clusters ? t("x402 · Solana {c} · live", { c: clusters }) : t("x402 · Solana · live")}
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <section className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-line bg-night-surface lg:col-span-12 lg:grid-cols-4">
          <Tile k={t("paid on mainnet")} v={tot ? String(real?.paid ?? 0) : "-"} sub={tot ? t("{u} real USDC", { u: (real?.usdc ?? 0).toFixed(3) }) : ""} tone={real?.paid ? "lit" : "fg"} className="border-b border-r border-line lg:border-b-0" />
          <Tile k={t("paid on devnet")} v={tot ? String(test?.paid ?? 0) : "-"} sub={tot ? t("{u} test USDC", { u: (test?.usdc ?? 0).toFixed(3) }) : ""} className="border-b border-line lg:border-b-0 lg:border-r" />
          <Tile k={t("not charged")} v={tot ? String(tot.refusedBeforeSettle) : "-"} sub={t("verified, but nothing to sell")} className="border-r border-line" />
          <Tile k={t("settlements failed")} v={tot ? String(tot.settleFailed) : "-"} sub={t("report withheld")} tone={tot?.settleFailed ? "danger" : "fg"} />
        </section>

        <Card title={t("The menu")} note={menu ? t("USDC on {c}", { c: clusters }) : ""} className="lg:col-span-6">
          <ul className="divide-y divide-line">
            {(menu?.resources ?? []).map((r) => (
              <li key={r.url} className="py-2.5 first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <code className="min-w-0 truncate font-mono text-[12px] text-white">GET {r.url.replace("https://north.zooaiagency.com", "")}</code>
                  <span className="shrink-0 text-[13px] font-medium text-lit">{r.price.usdc} USDC</span>
                </div>
                <p className="mt-1 text-[12px] leading-[1.55] text-dim">{t(r.description)}</p>
              </li>
            ))}
            {!menu && <li className="text-[12.5px] text-faint">{t("Reading the node…")}</li>}
          </ul>
          {menu?.networks.map((n) => (
            <p key={n.network} className="mt-2 text-[12px] text-dim first-of-type:mt-3">
              {n.network === MAINNET ? t("mainnet") : t("devnet")}: {t("paid to")}{" "}
              <a href={acct(n.payTo, n.network)} target="_blank" rel="noopener noreferrer" className={`font-mono ${LINK}`}>
                {shortFit(n.payTo)}
              </a>{" "}
              · {t("network fee paid by the node")}{" "}
              <a href={acct(n.feePayer, n.network)} target="_blank" rel="noopener noreferrer" className={`font-mono ${LINK}`}>
                {shortFit(n.feePayer)}
              </a>
            </p>
          ))}
        </Card>
        <Probe />

        <Card title={t("How one paid request goes")} note={t("x402 v2, exact scheme, SPL USDC")} className="lg:col-span-12">
          <ol className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map(([k, v], i) => (
              <li key={k} className="flex gap-3">
                <span className="mt-px w-5 shrink-0 text-[12px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-white">{t(k)}</p>
                  <p className="mt-0.5 text-[12px] leading-[1.55] text-dim">{t(v)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Panel title={t("Every sale, live")} meta={t("each report's sha256 is also in the node's signed public log")} className="lg:col-span-12" bodyClass="px-3.5 pb-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead className="text-[11.5px] text-faint">
                <tr className="border-b border-line">
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
                  <tr key={r.transaction} className="border-t border-line text-fg-2">
                    <td className="py-2 pr-4 text-dim">{when(r.at)}</td>
                    <td className="py-2 pr-4">{r.route === "xray" ? "X-Ray" : t("check")}</td>
                    <td className="py-2 pr-4">
                      <a href={`/xray?mint=${r.mint}`} className={`font-mono ${LINK}`}>
                        {shortFit(r.mint)}
                      </a>
                    </td>
                    <td className={`py-2 pr-4 ${VERDICT[r.verdict ?? ""] ?? "text-dim"}`}>{r.verdict ?? "-"}</td>
                    <td className="py-2 pr-4">
                      <a href={acct(r.payer, r.network)} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-white">
                        {shortFit(r.payer)}
                      </a>
                    </td>
                    <td className="py-2 pr-4">
                      <a href={tx(r.transaction, r.network)} target="_blank" rel="noopener noreferrer" className={LINK}>
                        {r.network === MAINNET ? "" : "devnet · "}
                        <span className="font-mono">{shortFit(r.transaction, 6)}</span> ↗
                      </a>
                    </td>
                    <td className="py-2 font-mono text-dim">{r.reportSha256.slice(0, 12)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sales && sales.receipts.length === 0 && <p className="py-6 text-center text-[12.5px] text-faint">{t("No sales yet.")}</p>}
            {!sales && <p className="py-6 text-center text-[12.5px] text-faint">{t("Reading the node…")}</p>}
          </div>
        </Panel>

        <AgentPrompt />

        <Card title={t("From your agent")} note="@x402/fetch + @x402/svm" className="lg:col-span-7">
          <pre className={`overflow-x-auto ${PRE}`}>{SNIPPET}</pre>
          <p className="mt-3 text-[12px] text-dim">
            {t("A ready agent that refuses the swap on avoid:")}{" "}
            <a href="https://github.com/0xNickdev/aiagentzoo/tree/main/examples/x402-agent" target="_blank" rel="noopener noreferrer" className={`font-mono ${LINK}`}>
              examples/x402-agent
            </a>
          </p>
        </Card>
        <Card title={t("When you are not charged")} className="lg:col-span-5">
          <ul className="space-y-2 text-[12.5px] leading-[1.55] text-fg-2">
            <li>{t("The payment does not verify: 402 with the reason, nothing is built.")}</li>
            <li>{t("The zoo knows nothing about the coin: the answer goes out free.")}</li>
            <li>{t("The node cannot build the report: you get the error, the signed transfer is never sent and expires.")}</li>
            <li>{t("The transfer fails on chain: 402 with the reason, the report is withheld.")}</li>
            <li>{t("You cannot name your own price: the node always checks the payment against its own.")}</li>
          </ul>
          <p className="mt-3 text-[12px] text-dim">{t("The agent needs USDC only: the node pays the Solana network fee.")}</p>
        </Card>
      </div>
    </Page>
  );
}
