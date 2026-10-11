import { useCallback, useEffect, useMemo, useState } from "react";
import { loadDirectory, shortAddress, useGuardian } from "../zoo";
import { GuardianButton } from "./Guardian";
import { Reveal, Section } from "./ui";

interface Market {
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24h: number | null;
  url: string | null;
}
interface Obs {
  mint: string;
  symbol: string;
  name: string;
  market: Market | null;
  reasons?: string[];
  watchedBy?: string[];
}
interface Sections {
  night: string;
  observed: number;
  launches: number;
  topVolume: Obs[];
  graduated: Obs[];
  wentToZero: Obs[];
  suspicious: Obs[];
  promoted: Obs[];
  watched?: Obs[];
  guests?: GuestReport[];
  calls?: Call[];
  learned?: { score: { hits: number; misses: number; accuracy: number | null } | null; playbook: { version: number; text: string } };
}
interface Call {
  mint: string;
  symbol: string;
  verdict: string;
  confidence: number;
  why: string;
  by: "model" | "rules";
}
interface GuestReport {
  guest: string;
  species: string;
  platform?: string;
  token: string | null;
  items: Array<{ mint: string; verdict: string; note: string }>;
}
interface BriefRef {
  id: string;
  night: string;
  ts: number;
  sha256: string;
}
interface BriefDoc {
  ref: BriefRef;
  markdown: string;
  sections: Sections;
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);

async function nodeUrl(agent: string): Promise<string | undefined> {
  return (await loadDirectory()).find((n) => n.agents.includes(agent))?.url;
}

const clean = (t: string) => t.replace(/[\u2013\u2014]/g, "-");

/** The archivist's paragraph, lifted from the brief's markdown. */
function reviewOf(markdown: string): string | null {
  const m = /## Night in review\n+([\s\S]*?)(?:\n## |$)/.exec(markdown);
  if (!m) return null;
  return clean(m[1]!.trim().replace(/^Night in review:\s*/i, "")) || null;
}

const dex = (o: { mint: string; market?: Market | null }) => o.market?.url ?? `https://dexscreener.com/solana/${o.mint}`;

type TabKey = "topVolume" | "wentToZero" | "graduated" | "suspicious" | "promoted";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "topVolume", label: "Top volume" },
  { key: "wentToZero", label: "Went to zero" },
  { key: "graduated", label: "Graduated" },
  { key: "suspicious", label: "Suspicious" },
  { key: "promoted", label: "Freshly promoted" },
];

function Change({ n }: { n: number | null | undefined }) {
  if (n === null || n === undefined) return <span className="text-white/30">-</span>;
  return <span className={n >= 0 ? "text-emerald-200/90" : "text-rose-200/90"}>{pct(n)}</span>;
}

function Tables({ s }: { s: Sections }) {
  const [tab, setTab] = useState<TabKey>("topVolume");
  const rows = s[tab] ?? [];
  const reasons = tab === "suspicious";
  return (
    <div className="rounded-3xl bg-black/40 ring-1 ring-white/10 backdrop-blur-md">
      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.07] px-3 pt-3" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px shrink-0 border-b px-3 pb-3 pt-1 text-[13px] transition ${
              tab === t.key ? "border-white text-white" : "border-transparent text-white/45 hover:text-white/80"
            }`}
          >
            {t.label}
            <span className="font-mono ml-1.5 text-[10.5px] text-white/35">{(s[t.key] ?? []).length}</span>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-[13px] text-white/40">Nothing in this section tonight.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="font-mono text-left text-[10px] tracking-[0.12em] text-white/35">
                <th className="px-6 py-3 font-normal">TOKEN</th>
                {reasons ? (
                  <th className="px-6 py-3 font-normal">WHY IT IS FLAGGED</th>
                ) : (
                  <>
                    <th className="px-3 py-3 text-right font-normal">VOLUME 24H</th>
                    <th className="px-3 py-3 text-right font-normal">LIQUIDITY</th>
                    <th className="px-6 py-3 text-right font-normal">24H</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((o, i) => (
                <tr key={o.mint} className="border-t border-white/[0.05] transition hover:bg-white/[0.02]">
                  <td className="px-6 py-3">
                    <a href={dex(o)} target="_blank" rel="noopener noreferrer" className="group flex items-baseline gap-3" title={o.mint}>
                      <span className="font-mono w-5 text-[10.5px] text-white/25">{String(i + 1).padStart(2, "0")}</span>
                      <span className="text-white/90 group-hover:text-white">{o.symbol}</span>
                      <span className="font-mono text-[11px] text-white/30">{shortAddress(o.mint)}</span>
                    </a>
                  </td>
                  {reasons ? (
                    <td className="px-6 py-3 text-white/60">{clean((o.reasons ?? []).join(" · "))}</td>
                  ) : (
                    <>
                      <td className="font-mono px-3 py-3 text-right text-white/75">{money(o.market?.volume24hUsd)}</td>
                      <td className="font-mono px-3 py-3 text-right text-white/50">{money(o.market?.liquidityUsd)}</td>
                      <td className="font-mono px-6 py-3 text-right">
                        <Change n={o.market?.priceChange24h} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const VERDICT_TONE: Record<string, string> = {
  suspicious: "text-rose-200/90 ring-rose-200/25",
  promising: "text-emerald-100/90 ring-emerald-200/25",
  watch: "text-white/60 ring-white/15",
};

function Calls({ calls }: { calls: Call[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? calls : calls.slice(0, 6);
  return (
    <div className="rounded-3xl bg-black/40 p-6 ring-1 ring-white/10 backdrop-blur-md">
      <p className="font-mono text-[10.5px] tracking-[0.14em] text-white/40">THE PACK'S CALLS · {calls.length}</p>
      {calls.length === 0 ? (
        <p className="mt-4 text-[13px] text-white/40">No calls yet this night.</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/[0.06]">
          {shown.map((c) => (
            <li key={c.mint} className="flex items-start gap-3 py-3">
              <span className={`font-mono mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] ring-1 ${VERDICT_TONE[c.verdict] ?? VERDICT_TONE.watch}`}>{c.verdict}</span>
              <div className="min-w-0 flex-1">
                <a href={`https://dexscreener.com/solana/${c.mint}`} target="_blank" rel="noopener noreferrer" className="text-[13.5px] text-white/90 hover:text-white">
                  {c.symbol}
                </a>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/50">{clean(c.why)}</p>
              </div>
              <span className="font-mono shrink-0 text-[11px] text-white/40">{Math.round(c.confidence * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
      {calls.length > 6 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="font-mono mt-2 text-[11px] text-white/45 hover:text-white">
          {all ? "show fewer" : `show all ${calls.length}`}
        </button>
      )}
    </div>
  );
}

function Learned({ learned }: { learned: Sections["learned"] }) {
  const [open, setOpen] = useState(false);
  const score = learned?.score;
  const scored = score ? score.hits + score.misses : 0;
  return (
    <div className="rounded-3xl bg-black/40 p-6 ring-1 ring-white/10 backdrop-blur-md">
      <p className="font-mono text-[10.5px] tracking-[0.14em] text-white/40">WHAT THE PACK LEARNED</p>
      {scored > 0 ? (
        <>
          <p className="font-display mt-4 text-5xl">{Math.round((score!.accuracy ?? 0) * 100)}%</p>
          <p className="mt-2 text-[13.5px] font-light text-white/60">
            of yesterday's calls were right when re-checked: {score!.hits} right, {score!.misses} wrong.
          </p>
        </>
      ) : (
        <p className="mt-4 text-[13.5px] font-light text-white/55">Calls are re-checked the next night; the score lands here.</p>
      )}
      {learned && (
        <div className="mt-6 border-t border-white/[0.07] pt-4">
          <button type="button" onClick={() => setOpen((o) => !o)} className="font-mono flex w-full items-center justify-between text-[11px] tracking-[0.1em] text-white/55 hover:text-white">
            <span>PLAYBOOK V{learned.playbook.version} · REWRITTEN BY THE BEAVER</span>
            <span>{open ? "−" : "+"}</span>
          </button>
          {open && (
            <ol className="mt-4 space-y-2 text-[12.5px] font-light leading-relaxed text-white/60">
              {learned.playbook.text.split("\n").map((line) => (
                <li key={line}>{clean(line)}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function GuestReports({ reports }: { reports: GuestReport[] }) {
  return (
    <div className="rounded-3xl bg-black/40 p-6 ring-1 ring-white/10 backdrop-blur-md">
      <p className="font-mono text-[10.5px] tracking-[0.14em] text-white/40">FROM THE GUEST ENCLOSURES · {reports.length}</p>
      <div className={`mt-3 grid gap-6 ${reports.length > 1 ? "md:grid-cols-2" : ""}`}>
        {reports.map((r) => (
          <div key={r.guest} className="min-w-0">
            <p className="text-[14px] text-white/90">
              {r.guest} <span className="text-[12px] text-white/40">· {r.platform === "clawpump" ? "ClawPump wing · " : ""}{r.species}</span>
            </p>
            <ul className="mt-2 divide-y divide-white/[0.06]">
              {r.items.slice(0, 5).map((i) => (
                <li key={i.mint} className="flex items-start gap-3 py-2.5">
                  <span className={`font-mono mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] ring-1 ${VERDICT_TONE[i.verdict] ?? VERDICT_TONE.watch}`}>{i.verdict}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/60" title={i.note}>
                    {clean(i.note) || shortAddress(i.mint)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function Watched({ items }: { items: Obs[] }) {
  return (
    <div className="rounded-3xl bg-black/40 p-6 ring-1 ring-white/10 backdrop-blur-md">
      <p className="font-mono text-[10.5px] tracking-[0.14em] text-white/40">GUARDIAN WATCH · {items.length}</p>
      <ul className="mt-3 divide-y divide-white/[0.06]">
        {items.map((o) => (
          <li key={o.mint} className="flex items-baseline justify-between gap-3 py-2.5 text-[13px]">
            <a href={dex(o)} target="_blank" rel="noopener noreferrer" className="text-white/85 hover:text-white">
              {o.symbol} <span className="font-mono text-[11px] text-white/30">{shortAddress(o.mint)}</span>
            </a>
            <span className="font-mono text-[12px]">
              <Change n={o.market?.priceChange24h} /> <span className="text-white/30">· {(o.watchedBy ?? []).map(shortAddress).join(", ")}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WatchPanel({ brief }: { brief: BriefDoc | null }) {
  const { session } = useGuardian();
  const [mints, setMints] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return setMints([]);
    nodeUrl("raven")
      .then((url) => url && fetch(`${url}/v1/watchlist/${session.publicKey}`).then((r) => r.json()))
      .then((body) => body && setMints(body.mints ?? []))
      .catch(() => undefined);
  }, [session]);

  const change = async (mint: string, action: "add" | "remove") => {
    if (!session) return;
    setMessage(null);
    const url = await nodeUrl("raven");
    if (!url) return setMessage("The watch node is unreachable.");
    const res = await fetch(`${url}/v1/watchlist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guardian: { publicKey: session.publicKey, message: session.message, signature: session.signature }, mint, action }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage(body.error ?? `HTTP ${res.status}`);
    setMints(body.mints);
    setInput("");
    setMessage(action === "add" ? "Added. The raven hands the watch to the hedgehog every hour." : "Removed.");
  };

  const mine = useMemo(
    () => (brief?.sections.watched ?? []).filter((o) => session && o.watchedBy?.includes(session.publicKey)),
    [brief, session],
  );

  return (
    <div className="grid gap-8 rounded-3xl bg-gradient-to-br from-white/[0.04] to-transparent p-7 ring-1 ring-white/10 sm:p-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-white/40">GUARDIAN WATCH · FREE</p>
        <h3 className="font-display mt-3 text-4xl">Watch my token</h3>
        <p className="mt-3 max-w-md text-[14px] font-light leading-relaxed text-white/60">
          Sign in with a Solana wallet and add up to three tokens. The pack checks them every hour (liquidity, volume, sharp moves) and they get
          your own section in the next Morning Brief.
        </p>
      </div>
      <div className="flex flex-col justify-center">
      {!session ? (
        <GuardianButton />
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) void change(input.trim(), "add");
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Token mint address"
              className="min-w-0 flex-1 rounded-full bg-white/5 px-4 py-2.5 font-mono text-[12px] text-white placeholder:text-white/30 ring-1 ring-white/15 focus:outline-none focus:ring-white/40"
            />
            <button type="submit" className="rounded-full bg-white px-5 py-2.5 text-[12px] font-medium uppercase tracking-[0.15em] text-black hover:bg-white/90">
              Add
            </button>
          </form>
          {message && <p className="mt-2 text-[12px] font-light text-white/55">{message}</p>}
          <ul className="mt-4 grid gap-2">
            {mints.map((m) => (
              <li key={m} className="flex items-center justify-between gap-3 rounded-full bg-white/5 px-4 py-2 font-mono text-[12px] text-white/80">
                <span className="truncate">{m}</span>
                <button type="button" onClick={() => change(m, "remove")} className="shrink-0 text-white/40 hover:text-white">
                  remove
                </button>
              </li>
            ))}
          </ul>
          {mine.length > 0 && <div className="mt-5"><Watched items={mine} /></div>}
          <GuardianButton className="mt-5" />
        </>
      )}
      </div>
    </div>
  );
}

export default function Brief() {
  const [refs, setRefs] = useState<BriefRef[] | null>(null);
  const [brief, setBrief] = useState<BriefDoc | null>(null);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async (ref: BriefRef) => {
    const url = await nodeUrl("tortoise");
    if (!url) return;
    const entry = await (await fetch(`${url}/v1/briefs/${ref.id}`)).json();
    setBrief({ ref, markdown: entry.event.payload.content.markdown, sections: entry.event.payload.content.sections });
  }, []);

  useEffect(() => {
    (async () => {
      const url = await nodeUrl("tortoise");
      if (!url) return setError("Brief node unreachable.");
      const [list, agents] = await Promise.all([fetch(`${url}/v1/briefs`).then((r) => r.json()), fetch(`${url}/v1/agents`).then((r) => r.json())]);
      setRefs(list);
      setNextAt(agents.find((a: { name: string }) => a.name === "tortoise")?.nextRunAt ?? null);
      const wanted = /^#(?:brief\/)?(\d{4}-\d{2}-\d{2})$/.exec(window.location.hash)?.[1];
      const first = (wanted && list.find((r: BriefRef) => r.night === wanted)) || list[0];
      if (first) await open(first);
    })().catch(() => setError("Brief node unreachable."));
  }, [open]);

  const share = () => {
    if (!brief) return;
    const link = `${window.location.origin}/brief#${brief.ref.night}`;
    void navigator.clipboard?.writeText(link).catch(() => undefined);
    window.history.replaceState(null, "", `/brief#${brief.ref.night}`);
  };
  const download = () => {
    if (!brief) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([brief.markdown], { type: "text/markdown" }));
    a.download = `${brief.ref.id}.md`;
    a.click();
  };

  const s = brief?.sections;
  const review = brief ? reviewOf(brief.markdown) : null;
  const scored = s?.learned?.score ? s.learned.score.hits + s.learned.score.misses : 0;
  const figures: Array<[string, string]> = s
    ? [
        ["TOKENS WATCHED", s.observed.toLocaleString("en-US")],
        ["FRESH LAUNCHES", s.launches.toLocaleString("en-US")],
        ["GRADUATED", String(s.graduated.length)],
        ["WENT TO ZERO", String(s.wentToZero.length)],
        ["FLAGGED", String(s.suspicious.length)],
        ["RIGHT WHEN CHECKED", scored ? `${Math.round((s.learned!.score!.accuracy ?? 0) * 100)}%` : "-"],
      ]
    : [];

  return (
    <Section id="brief" backdrop={{ tint: "235,190,120", glowAt: "50% 10%" }}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-[11px] tracking-[0.18em] text-white/45">EVERY MORNING · 07:00 UTC · SIGNED</p>
          <h1 className="font-display mt-3 text-5xl sm:text-7xl">The Morning Brief</h1>
          <p className="mt-4 max-w-xl text-[15px] font-light leading-relaxed text-white/60">
            What launched overnight on pump.fun, what moved, what went to zero and what looks off. Assembled by the pack, no human in the loop.
          </p>
        </div>
        {refs && refs.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Choose a night">
            {refs.slice(0, 7).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => open(r)}
                className={`font-mono rounded-full px-3.5 py-1.5 text-[11px] ring-1 transition ${
                  brief?.ref.id === r.id ? "bg-white text-black ring-white" : "text-white/60 ring-white/15 hover:text-white"
                }`}
              >
                {new Date(`${r.night}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="mt-10 text-sm text-white/50">{error}</p>}
      {refs && refs.length === 0 && (
        <div className="mt-10 rounded-3xl bg-black/40 p-10 text-center ring-1 ring-white/10">
          <p className="font-display text-3xl">The first brief is being assembled</p>
          <p className="mt-3 text-sm font-light text-white/60">
            The tortoise publishes it {nextAt ? `at ${new Date(nextAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}` : "at 07:00 UTC"}.
          </p>
        </div>
      )}

      {s && brief && (
        <Reveal className="mt-12">
          <div className="relative grid grid-cols-2 border-y border-white/12 sm:grid-cols-3 lg:grid-cols-6">
            {figures.map(([k, v], i) => (
              <div key={k} className={`px-1 py-5 sm:px-5 ${i > 0 ? "lg:border-l lg:border-white/[0.08]" : ""}`}>
                <p className="font-mono text-[10px] tracking-[0.14em] text-white/40">{k}</p>
                <p className="font-mono mt-2 text-2xl text-white">{v}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div>
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-white/40">NIGHT OF {s.night} · NIGHT IN REVIEW</p>
              <p className="mt-4 text-[16px] font-light leading-[1.7] text-white/80 sm:text-[19px]">
                {review ?? `${s.observed} tokens observed; ${s.graduated.length} graduated, ${s.wentToZero.length} went to zero, ${s.suspicious.length} flagged.`}
              </p>
            </div>
            <div className="flex flex-col justify-end gap-3 lg:items-end">
              <p className="font-mono text-[11px] text-white/35" title={brief.ref.sha256}>
                sha256 {brief.ref.sha256.slice(0, 16)}…
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={share} className="liquid-glass rounded-full px-4 py-2 text-[12px] text-white/85 hover:text-white">
                  Copy link
                </button>
                <button type="button" onClick={download} className="liquid-glass rounded-full px-4 py-2 text-[12px] text-white/85 hover:text-white">
                  Download .md
                </button>
              </div>
            </div>
          </div>

          <div className="mt-10">
            <Tables s={s} />
          </div>

          {(s.calls?.length || s.learned) && (
            <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Calls calls={s.calls ?? []} />
              <Learned learned={s.learned} />
            </div>
          )}
          {((s.guests && s.guests.length > 0) || (s.watched && s.watched.length > 0)) && (
            <div className={`mt-4 grid items-start gap-4 ${s.guests?.length && s.watched?.length ? "lg:grid-cols-2" : ""}`}>
              {s.guests && s.guests.length > 0 && <GuestReports reports={s.guests} />}
              {s.watched && s.watched.length > 0 && <Watched items={s.watched} />}
            </div>
          )}
          <p className="mt-4 text-[11px] font-light text-white/35">Observations from public data, not financial advice.</p>
        </Reveal>
      )}

      <div className="mt-16">
        <WatchPanel brief={brief} />
      </div>
    </Section>
  );
}
