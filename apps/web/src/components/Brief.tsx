import { useCallback, useEffect, useMemo, useState } from "react";
import { loadDirectory, shortAddress, useGuardian } from "../zoo";
import { GuardianButton } from "./Guardian";
import { Reveal, Section, SectionHead } from "./ui";

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
  n === null || n === undefined ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);

async function nodeUrl(agent: string): Promise<string | undefined> {
  return (await loadDirectory()).find((n) => n.agents.includes(agent))?.url;
}

function Table({ title, items, note }: { title: string; items: Obs[]; note?: (o: Obs) => string }) {
  return (
    <div className="rounded-3xl bg-black/45 p-5 ring-1 ring-white/10 backdrop-blur-md">
      <p className="mb-3 text-[10px] font-light uppercase tracking-[0.25em] text-white/50">
        {title} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="text-[13px] font-light text-white/40">Nothing this night.</p>
      ) : (
        <ul className="grid gap-2 text-[13px] font-light">
          {items.slice(0, 8).map((o) => (
            <li key={o.mint} className="flex items-baseline justify-between gap-3 border-b border-dashed border-white/10 pb-2">
              <a
                href={o.market?.url ?? `https://dexscreener.com/solana/${o.mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate text-white/90 hover:text-white"
                title={o.mint}
              >
                {o.symbol} <span className="text-white/35">{o.mint.slice(0, 4)}…{o.mint.slice(-4)}</span>
              </a>
              <span className="shrink-0 text-right text-white/55">
                {note ? note(o) : `${money(o.market?.volume24hUsd)} · ${pct(o.market?.priceChange24h)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Thinking({ calls, learned }: { calls: Call[]; learned: Sections["learned"] }) {
  const score = learned?.score;
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <div className="rounded-3xl bg-black/45 p-5 ring-1 ring-white/10 backdrop-blur-md">
        <p className="mb-3 text-[10px] font-light uppercase tracking-[0.25em] text-white/50">The pack's calls · {calls.length}</p>
        {calls.length === 0 ? (
          <p className="text-[13px] font-light text-white/40">No calls yet this night.</p>
        ) : (
          <ul className="grid gap-2 text-[12.5px] font-light">
            {calls.slice(0, 8).map((c) => (
              <li key={c.mint} className="border-b border-dashed border-white/10 pb-2">
                <span className={c.verdict === "suspicious" ? "text-amber-200/85" : c.verdict === "promising" ? "text-emerald-200/85" : "text-white/75"}>{c.verdict}</span>{" "}
                <a href={`https://dexscreener.com/solana/${c.mint}`} target="_blank" rel="noopener noreferrer" className="text-white/90 hover:text-white">
                  {c.symbol}
                </a>{" "}
                <span className="text-white/35">
                  {Math.round(c.confidence * 100)}% · {c.by}
                </span>
                <p className="mt-0.5 text-white/55">{c.why}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-3xl bg-black/45 p-5 ring-1 ring-white/10 backdrop-blur-md">
        <p className="mb-3 text-[10px] font-light uppercase tracking-[0.25em] text-white/50">What the pack learned</p>
        <p className="text-[13px] font-light text-white/70">
          {score && score.hits + score.misses > 0
            ? `Yesterday's calls re-checked: ${score.hits} right, ${score.misses} wrong · ${Math.round((score.accuracy ?? 0) * 100)}% accuracy.`
            : "Calls are re-checked the next night; the score lands here."}
        </p>
        {learned && (
          <>
            <p className="mt-3 text-[10px] font-light uppercase tracking-[0.25em] text-white/40">Playbook v{learned.playbook.version} · rewritten by the beaver</p>
            <ol className="mt-2 grid gap-1 text-[12px] font-light leading-relaxed text-white/55">
              {learned.playbook.text.split("\n").map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

function GuestReports({ reports }: { reports: GuestReport[] }) {
  return (
    <div className="mt-3 rounded-3xl bg-black/45 p-5 ring-1 ring-white/10 backdrop-blur-md">
      <p className="mb-3 text-[10px] font-light uppercase tracking-[0.25em] text-white/50">
        From the guest enclosures · {reports.length}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {reports.map((r) => (
          <div key={r.guest} className="min-w-0">
            <p className="text-[13px] text-white/90">
              {r.guest} <span className="text-white/40">· {r.species}</span>
            </p>
            <ul className="mt-1 grid gap-1 text-[12px] font-light text-white/60">
              {r.items.slice(0, 6).map((i) => (
                <li key={i.mint} className="truncate" title={i.note}>
                  <span className={i.verdict === "suspicious" ? "text-amber-200/80" : "text-white/80"}>{i.verdict}</span>{" "}
                  <a href={`https://dexscreener.com/solana/${i.mint}`} target="_blank" rel="noopener noreferrer" className="text-white/40 hover:text-white">
                    {i.mint.slice(0, 4)}…{i.mint.slice(-4)}
                  </a>
                  {i.note && ` — ${i.note}`}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
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
    <div className="liquid-glass rounded-3xl bg-black/40 p-6 backdrop-blur-md">
      <p className="text-[10px] font-light uppercase tracking-[0.25em] text-white/50">Guardian watch · free</p>
      <h3 className="font-garamond mt-2 text-3xl uppercase tracking-tight">Watch my token</h3>
      <p className="mt-3 text-sm font-light leading-relaxed text-white/65">
        Sign in with a Solana wallet and add up to three tokens. The pack checks them every hour — liquidity, volume, sharp moves — and
        they get your own section in the next Morning Brief.
      </p>
      {!session ? (
        <GuardianButton className="mt-5" />
      ) : (
        <>
          <form
            className="mt-5 flex gap-2"
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
          {mine.length > 0 && <div className="mt-5"><Table title={`Your watch in ${brief?.ref.night}`} items={mine} /></div>}
          <GuardianButton className="mt-5" />
        </>
      )}
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
      const wanted = /^#brief\/(\d{4}-\d{2}-\d{2})$/.exec(window.location.hash)?.[1];
      const first = (wanted && list.find((r: BriefRef) => r.night === wanted)) || list[0];
      if (first) await open(first);
      if (wanted) document.getElementById("brief")?.scrollIntoView();
    })().catch(() => setError("Brief node unreachable."));
  }, [open]);

  const share = () => {
    if (!brief) return;
    const link = `${window.location.origin}/#brief/${brief.ref.night}`;
    void navigator.clipboard?.writeText(link).catch(() => undefined);
    window.history.replaceState(null, "", `#brief/${brief.ref.night}`);
  };
  const download = () => {
    if (!brief) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([brief.markdown], { type: "text/markdown" }));
    a.download = `${brief.ref.id}.md`;
    a.click();
  };

  const s = brief?.sections;
  return (
    <Section id="brief" backdrop={{ tint: "235,190,120", glowAt: "50% 20%" }}>
      <SectionHead
        eyebrow="Every morning · 07:00 UTC · free"
        title={["The Morning Brief"]}
        text="What launched overnight on pump.fun, what moved, what went to zero and what looks off — assembled by the pack with no human in the loop."
      />

      <Reveal className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {error && <p className="text-sm text-white/50">{error}</p>}
          {refs && refs.length === 0 && (
            <div className="rounded-3xl bg-black/45 p-8 text-center ring-1 ring-white/10 backdrop-blur-md">
              <p className="font-garamond text-3xl uppercase">The first brief is being assembled</p>
              <p className="mt-3 text-sm font-light text-white/60">
                The tortoise publishes it {nextAt ? `at ${new Date(nextAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}` : "at 07:00 UTC"}.
              </p>
            </div>
          )}
          {s && brief && (
            <>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-light uppercase tracking-[0.25em] text-white/50">Night of</p>
                  <h3 className="font-garamond text-4xl uppercase tracking-tight">{s.night}</h3>
                  <p className="mt-1 text-sm font-light text-white/60">
                    {s.observed} tokens observed · {s.launches} fresh launches · sha256 {brief.ref.sha256.slice(0, 10)}…
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={share} className="liquid-glass rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-white/90">
                    Copy link
                  </button>
                  <button type="button" onClick={download} className="liquid-glass rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-white/90">
                    .md
                  </button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Table title="Top volume" items={s.topVolume} />
                <Table title="Went to zero" items={s.wentToZero} />
                <Table title="Suspicious" items={s.suspicious} note={(o) => (o.reasons ?? []).join(", ")} />
                <Table title="Graduated" items={s.graduated} />
                <Table title="Freshly promoted" items={s.promoted} />
                <Table
                  title="Guardian watch"
                  items={s.watched ?? []}
                  note={(o) => `${pct(o.market?.priceChange24h)} · ${(o.watchedBy ?? []).map(shortAddress).join(", ")}`}
                />
              </div>
              {(s.calls?.length || s.learned) && <Thinking calls={s.calls ?? []} learned={s.learned} />}
              {s.guests && s.guests.length > 0 && <GuestReports reports={s.guests} />}
              <p className="mt-3 text-[11px] font-light text-white/40">Observations from public data, not financial advice.</p>
            </>
          )}
          {refs && refs.length > 1 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {refs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => open(r)}
                  className={`rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.18em] ring-1 transition ${
                    brief?.ref.id === r.id ? "bg-white text-black ring-white" : "text-white/70 ring-white/15 hover:bg-white/10"
                  }`}
                >
                  {r.night}
                </button>
              ))}
            </div>
          )}
        </div>
        <WatchPanel brief={brief} />
      </Reveal>
    </Section>
  );
}
