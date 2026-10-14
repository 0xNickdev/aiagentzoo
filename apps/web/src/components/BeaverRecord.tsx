import { useEffect, useState } from "react";
import { nodeOf } from "../zoo";
import { Reveal, Section, SectionHead } from "./ui";

interface Night {
  night: string;
  graded: number;
  skill: number | null;
  dead: number;
  deadRight: number;
  alive: number;
  aliveRight: number;
}
interface Call {
  night: string;
  mint: string;
  symbol: string;
  verdict: string;
  outcome: string;
  hit: boolean;
  why: string;
}

/** The beaver's track record, night by night: the honest argument for everything else. */
export default function BeaverRecord() {
  const [data, setData] = useState<{ nights: Night[]; warnedDead: number; calls: Call[] } | null>(null);
  useEffect(() => {
    void nodeOf("beaver").then((n) =>
      n
        ? fetch(`${n.url}/v1/beaver/record`)
            .then((r) => (r.ok ? r.json() : null))
            .then(setData)
            .catch(() => {})
        : null,
    );
  }, []);

  const nights = data?.nights ?? [];
  const right = data?.calls.filter((c) => c.hit).length ?? 0;
  const wrong = data?.calls.filter((c) => !c.hit).length ?? 0;

  return (
    <Section id="record">
      <SectionHead
        eyebrow="The beaver's record · every call re-checked"
        title={["Where it was right.", "Where it was wrong."]}
        text="Every night the beaver judges fresh tokens; the next day reality grades each call. Nothing is removed, the misses stay next to the hits."
      />
      <Reveal className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="liquid-glass rounded-3xl p-6">
          <p className="font-mono text-[10.5px] text-white/45">warned before they died</p>
          <p className="font-display mt-2 text-6xl">{data ? data.warnedDead.toLocaleString("en-US") : "-"}</p>
          <p className="mt-2 text-[13px] font-light text-white/55">tokens the beaver called suspicious that then went to zero</p>

          <p className="font-mono mt-8 text-[10.5px] text-white/45">balanced accuracy, night by night</p>
          <div className="mt-3 flex h-28 items-end gap-1.5">
            {nights.map((n) => (
              <div key={n.night} className="group relative flex flex-1 flex-col items-center justify-end" title={`${n.night}: ${n.skill === null ? "-" : Math.round(n.skill * 100) + "%"} over ${n.graded}`}>
                <div className="w-full rounded-t bg-amber-100/70" style={{ height: `${Math.max(4, (n.skill ?? 0) * 100)}%`, opacity: n.graded >= 10 ? 1 : 0.45 }} />
                <span className="font-mono mt-1.5 text-[9px] text-white/35">{n.night.slice(5)}</span>
              </div>
            ))}
            {!nights.length && <p className="text-[12px] text-white/40">The first graded night appears after the next re-check.</p>}
          </div>
          <p className="font-mono mt-3 text-[10px] text-white/35">faint bars rest on fewer than 10 graded calls; 50% is a coin flip</p>
        </div>

        <div className="liquid-glass flex max-h-[26rem] flex-col rounded-3xl p-6">
          <div className="font-mono flex justify-between text-[10.5px] text-white/45">
            <span>latest graded calls</span>
            <span>
              <span className="text-[#9df3b0]">{right} right</span> · <span className="text-[#ff8a7e]">{wrong} wrong</span>
            </span>
          </div>
          <ul className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
            {data?.calls.map((c) => (
              <li key={c.night + c.mint} className="border-b border-dashed border-white/10 py-2.5 text-[12.5px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display truncate text-[15px]">${c.symbol}</span>
                  <span className={`font-mono shrink-0 text-[11px] ${c.hit ? "text-[#9df3b0]" : "text-[#ff8a7e]"}`}>
                    {c.hit ? "right" : "wrong"} · said {c.verdict}, it {c.outcome === "dead" ? "died" : "lived"}
                  </span>
                </div>
                {c.why && <p className="mt-0.5 truncate text-[11.5px] font-light text-white/45">{c.why}</p>}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </Section>
  );
}
