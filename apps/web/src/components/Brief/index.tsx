import { accuracyLabel, nightSkill } from "../../accuracy";
import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import NightCard, { type NightCardData } from "../NightCard";
import { Reveal, Section } from "../ui";
import { lang, t as tr } from "../../i18n";
import type { BriefDoc, BriefRef } from "./types";
import { clean, nodeUrl, reviewOf } from "./shared";
import { Calls, GuestReports, Learned, Tables, Watched, WeekBoard } from "./sections";
import { WatchPanel } from "./WatchPanel";


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
      if (!url) return setError(tr("Brief node unreachable."));
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

  const [card, setCard] = useState<NightCardData | null>(null);
  const closeCard = useCallback(() => setCard(null), []);
  const openCard = async () => {
    if (!brief) return;
    const sec = brief.sections;
    const tell = sec.suspicious.find((o) => (o.reasons ?? []).some((r) => r.startsWith("creator"))) ?? sec.suspicious[0];
    let nursery: string | null = null;
    try {
      const url = await nodeUrl("heron");
      const evo = url ? await (await fetch(`${url}/v1/evolution`)).json() : null;
      const next = new Date(Date.parse(`${sec.night}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const events = ((evo?.chronicle ?? []) as Array<{ kind: string; night: string; text: string }>).filter(
        (e) => (e.night === sec.night || e.night === next) && (e.kind === "death" || e.kind === "birth"),
      );
      const death = events.find((e) => e.kind === "death");
      const birth = events.find((e) => e.kind === "birth");
      if (death || birth) nursery = clean([death?.text.split(" at ")[0], birth?.text.split(". Mutation")[0]].filter(Boolean).join(". ") + ".");
    } catch {
      // The nursery line is optional.
    }
    setCard({
      night: sec.night,
      observed: sec.observed,
      launches: sec.launches,
      graduated: sec.counts?.graduated ?? sec.graduated.length,
      wentToZero: sec.counts?.wentToZero ?? sec.wentToZero.length,
      highlight: tell ? clean(`$${tell.symbol}: ${(tell.reasons ?? []).join(", ")}.`) : null,
      nursery,
      skill: nightSkill(sec.learned?.score),
      scored: sec.learned?.score ? sec.learned.score.hits + sec.learned.score.misses : 0,
    });
  };
  const s = brief?.sections;
  const review = brief ? reviewOf(brief.markdown) : null;
  const scored = s?.learned?.score ? s.learned.score.hits + s.learned.score.misses : 0;
  const figures: Array<[string, string]> = s
    ? [
        [tr("Tokens watched"), s.observed.toLocaleString("en-US")],
        [tr("Fresh launches"), s.launches.toLocaleString("en-US")],
        [tr("Graduated"), String(s.counts?.graduated ?? s.graduated.length)],
        [tr("Went to zero"), String(s.counts?.wentToZero ?? s.wentToZero.length)],
        [tr("Flagged"), (s.counts?.suspicious ?? s.suspicious.length).toLocaleString("en-US")],
        nightSkill(s.learned?.score) !== null || !scored
          ? [tr("Balanced accuracy"), accuracyLabel(nightSkill(s.learned?.score), scored)]
          : [tr("Yesterday's calls"), tr("{h} right · {m} wrong", { h: s.learned!.score!.hits, m: s.learned!.score!.misses })],
      ]
    : [];

  return (
    <Section id="brief" backdrop={{ tint: "235,190,120", glowAt: "50% 10%" }}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="tabular-nums text-[13px] text-fg-3">{tr("Every morning · 07:00 UTC · signed")}</p>
          <h1 className="font-display mt-3 text-5xl sm:text-7xl">{tr("The Morning Brief")}</h1>
          <p className="mt-4 max-w-xl text-[15px] font-normal leading-relaxed text-fg-4">
            {tr("What launched overnight on pump.fun, what moved, what went to zero and what looks off. Assembled by the pack, no human in the loop.")}
          </p>
        </div>
        {refs && refs.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={tr("Choose a night")}>
            {refs.slice(0, 7).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => open(r)}
                className={`tabular-nums rounded-full px-3.5 py-1.5 text-[13px] ring-1 transition ${
                  brief?.ref.id === r.id ? "bg-white text-black ring-white" : "text-fg-4 ring-white/15 hover:text-white"
                }`}
              >
                {new Date(`${r.night}T00:00:00Z`).toLocaleDateString(lang() === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="mt-10 text-sm text-fg-3">{error}</p>}
      {refs && refs.length === 0 && (
        <div className="mt-10 rounded-2xl bg-black/40 p-10 text-center ring-1 ring-white/10">
          <p className="font-display text-3xl">{tr("The first brief is being assembled")}</p>
          <p className="mt-3 text-sm font-normal text-fg-4">
            {tr("The tortoise publishes it {when}.", { when: nextAt ? new Date(nextAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : tr("at 07:00 UTC") })}
          </p>
        </div>
      )}

      {s && brief && (
        <Reveal className="mt-12">
          <div className="relative grid grid-cols-2 border-y border-white/12 sm:grid-cols-3 lg:grid-cols-6">
            {figures.map(([k, v], i) => (
              <div key={k} className={`px-1 py-5 sm:px-5 ${i > 0 ? "lg:border-l lg:border-white/[0.08]" : ""}`}>
                <p className="tabular-nums text-[12.5px] text-fg-4">{k}</p>
                {/* "71% · 4 calls": the number big, the sample beside it small, so it never wraps. */}
                <p className="tabular-nums mt-2 text-2xl text-white">
                  {v.split(" · ")[0]}
                  {v.includes(" · ") && <span className="ml-2 text-[13px] text-fg-3">{v.split(" · ").slice(1).join(" · ")}</span>}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div>
              <p className="tabular-nums text-[13px] text-fg-4">{tr("Night of {n} · night in review", { n: s.night })}</p>
              <p className="mt-4 text-[16px] font-normal leading-[1.7] text-fg-2 sm:text-[19px]">
                {(lang() === "zh" ? (s.reviewZh ?? null) : review) ?? tr("{o} tokens observed; {g} graduated, {z} went to zero, {f} flagged.", { o: s.observed, g: s.counts?.graduated ?? s.graduated.length, z: s.counts?.wentToZero ?? s.wentToZero.length, f: s.counts?.suspicious ?? s.suspicious.length })}
              </p>
            </div>
            <div className="flex flex-col justify-end gap-3 lg:items-end">
              <p className="tabular-nums text-[13px] text-fg-4" title={brief.ref.sha256}>
                sha256 {brief.ref.sha256.slice(0, 16)}…
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => void openCard()} className="rounded-full bg-white px-4 py-2 text-[13px] font-medium text-black hover:bg-white/90">
                  {tr("Night card")}
                </button>
                <button type="button" onClick={share} className="bg-night-surface border border-white/[0.08] rounded-full px-4 py-2 text-[13px] text-fg-2 hover:text-white">
                  {tr("Copy link")}
                </button>
                <button type="button" onClick={download} className="bg-night-surface border border-white/[0.08] rounded-full px-4 py-2 text-[13px] text-fg-2 hover:text-white">
                  {tr("Download .md")}
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
          {s.week && (
            <div className="mt-4">
              <WeekBoard week={s.week} />
            </div>
          )}
          <p className="mt-4 text-[13px] font-normal text-fg-4">{tr("Observations from public data, not financial advice.")}</p>
        </Reveal>
      )}

      <div className="mt-16">
        <WatchPanel brief={brief} />
      </div>
      <AnimatePresence>{card && <NightCard key={card.night} data={card} onClose={closeCard} />}</AnimatePresence>
    </Section>
  );
}
