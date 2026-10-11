import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { shortAddress } from "../zoo";
import { type CreatureDetail, loadCreature, pct, portrait } from "./data";

const rule = (line: string) => line.replace(/^\s*\d+[.)]\s*/, "").trim().toLowerCase();

const words = (s: string) => new Set(rule(s).split(/[^a-z0-9$]+/).filter((w) => w.length > 2));
const overlap = (a: string, b: string) => {
  const x = words(a);
  const y = words(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.max(1, Math.min(x.size, y.size));
};

/**
 * Each rule of the DNA, tagged by where it came from. A rule found word for word in a parent names that parent;
 * the rule closest to the recorded mutation is the mutation; anything else was inherited and reworded.
 */
function genes(c: CreatureDetail): Array<{ text: string; from: string | null; mutated: boolean }> {
  const lines = c.playbook.split("\n").filter((l) => l.trim());
  const from = lines.map((text) => c.parents.find((p) => p.playbook.split("\n").some((l) => rule(l) === rule(text)))?.name ?? null);
  let mutant = -1;
  if (c.mutation) {
    let best = 0.34;
    lines.forEach((text, i) => {
      const score = from[i] ? 0 : overlap(text, c.mutation!);
      if (score > best) [best, mutant] = [score, i];
    });
  }
  return lines.map((text, i) => ({ text, from: from[i]!, mutated: i === mutant }));
}

const VERDICT_TONE = {
  suspicious: "text-rose-200/90 ring-rose-200/25",
  promising: "text-emerald-100/90 ring-emerald-200/25",
  watch: "text-white/60 ring-white/15",
} as const;

export default function Sheet({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const [c, setC] = useState<CreatureDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setC(null);
    setFailed(false);
    loadCreature(id).then(setC, () => setFailed(true));
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const dead = c?.diedNight != null;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label={c?.name ?? "Creature"}
        className="flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-white/10 bg-[#070908] outline-none"
        initial={{ x: 48, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 48, opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-6 py-4">
          <span className="font-mono text-[11px] tracking-[0.12em] text-white/40">{c ? `HOUSE ${c.house.toUpperCase()} · GEN ${c.generation}` : "LOADING"}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-white/60 ring-1 ring-white/15 hover:text-white">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {failed && <p className="p-8 text-center text-[13px] text-white/45">This creature could not be loaded.</p>}
          {c && (
            <>
              <header className="relative px-6 pb-8 pt-8">
                <div className="flex items-center gap-5">
                  <img
                    src={portrait(c.house)}
                    alt=""
                    className={`h-28 w-28 shrink-0 rounded-full ${dead ? "opacity-40 grayscale" : ""}`}
                  />
                  <div className="min-w-0">
                    <h3 className="font-display text-4xl leading-none">{c.name}</h3>
                    <p className="mt-2 text-[14px] font-light text-white/60">{c.temperament}</p>
                    <p className="font-mono mt-3 text-[11px] text-white/40">
                      born {c.bornNight}
                      {dead ? ` · fell ${c.diedNight}` : " · alive"}
                    </p>
                  </div>
                </div>

                {dead && c.epitaph && (
                  <blockquote className="mt-6 border-l border-white/20 pl-4 text-[15px] font-light italic leading-relaxed text-white/70">
                    “{c.epitaph}”
                  </blockquote>
                )}

                <dl className="font-mono mt-7 grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-white/[0.06] text-[10.5px] text-white/40">
                  {[
                    ["lifetime", pct(c.lifetimeSkill)],
                    ["since last turn", pct(c.skill)],
                    ["dead · living called", `${c.lifetime.deadRight}/${c.lifetime.dead} · ${c.lifetime.aliveRight}/${c.lifetime.alive}`],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-[#070908] px-4 py-3">
                      <dt className="tracking-[0.1em]">{k!.toUpperCase()}</dt>
                      <dd className="mt-1 whitespace-nowrap text-[15px] text-white/90 sm:text-lg">{v}</dd>
                    </div>
                  ))}
                </dl>

                {(c.parents.length > 0 || c.children.length > 0) && (
                  <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-[13px]">
                    {c.parents.length > 0 && (
                      <span className="text-white/45">
                        child of{" "}
                        {c.parents.map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && " × "}
                            <button type="button" onClick={() => onOpen(p.id)} className="text-white underline decoration-white/25 underline-offset-4 hover:decoration-white">
                              {p.name}
                            </button>
                          </span>
                        ))}
                      </span>
                    )}
                    {c.children.length > 0 && (
                      <span className="text-white/45">
                        parent of{" "}
                        {c.children.map((k, i) => (
                          <span key={k.id}>
                            {i > 0 && ", "}
                            <button type="button" onClick={() => onOpen(k.id)} className="text-white underline decoration-white/25 underline-offset-4 hover:decoration-white">
                              {k.name}
                            </button>
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                )}
              </header>

              <section className="border-t border-white/[0.07] px-6 py-7">
                <h4 className="font-mono text-[11px] tracking-[0.14em] text-white/40">DNA · THE PLAYBOOK IT LIVES OR DIES BY</h4>
                <ol className="mt-4 space-y-2">
                  {genes(c).map((g, i) => (
                    <li
                      key={i}
                      className={`rounded-xl px-4 py-3 text-[13.5px] leading-relaxed ring-1 ${
                        g.mutated ? "bg-amber-200/[0.06] text-white ring-amber-200/30" : "bg-white/[0.02] text-white/75 ring-white/[0.07]"
                      }`}
                    >
                      {g.text}
                      {c.parents.length > 0 && (
                        <span className={`font-mono mt-1.5 block text-[10px] tracking-[0.1em] ${g.mutated ? "text-amber-200/80" : "text-white/35"}`}>
                          {g.mutated ? "MUTATION" : g.from ? `FROM ${g.from.toUpperCase()}` : "INHERITED, REWORDED"}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>

              <section className="border-t border-white/[0.07] px-6 py-7">
                <h4 className="font-mono text-[11px] tracking-[0.14em] text-white/40">EXAMS</h4>
                {c.record.length === 0 ? (
                  <p className="mt-4 text-[13px] text-white/45">No exams yet. The next one is set tonight.</p>
                ) : (
                  c.record.map((n) => (
                    <div key={n.night} className="mt-5">
                      <p className="font-mono text-[11px] text-white/40">
                        night of {n.night} · {n.scored ? `${n.cases.filter((x) => x.hit === true).length} right, ${n.cases.filter((x) => x.hit === false).length} wrong` : "graded tomorrow"}
                      </p>
                      <ul className="mt-2 divide-y divide-white/[0.06]">
                        {n.cases.map((x) => (
                          <li key={x.mint} className="flex items-start gap-3 py-2.5">
                            <span className={`font-mono mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] ring-1 ${VERDICT_TONE[x.verdict]}`}>{x.verdict}</span>
                            <div className="min-w-0 flex-1">
                              <a
                                href={`https://dexscreener.com/solana/${x.mint}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[11.5px] text-white/80 hover:text-white"
                              >
                                {x.symbol && x.symbol !== "?" ? `$${x.symbol}` : shortAddress(x.mint)} ↗
                              </a>
                              {x.why && <p className="mt-0.5 text-[12.5px] text-white/50">{x.why}</p>}
                            </div>
                            <span
                              className={`font-mono shrink-0 text-[11px] ${x.hit === true ? "text-emerald-200" : x.hit === false ? "text-rose-200" : "text-white/35"}`}
                            >
                              {x.hit === true ? "✓" : x.hit === false ? "✗" : x.verdict === "watch" ? "not scored" : n.scored ? "no market" : "pending"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </section>
            </>
          )}
        </div>
      </motion.aside>
    </motion.div>
  );
}
