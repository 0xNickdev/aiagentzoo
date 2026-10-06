import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { SPECIES, SPECIES_COLOR, type SpeciesId } from "../data";
import { loadPassport, type Passport as PassportData } from "../zoo";
import { WakeButton } from "./Guardian";

const EASE = [0.16, 1, 0.3, 1] as const;

function since(ts: number | null) {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function Passport({ agent, onClose }: { agent: string | null; onClose: () => void }) {
  const [data, setData] = useState<PassportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) return;
    setData(null);
    setError(null);
    let alive = true;
    const load = () =>
      loadPassport(agent)
        .then((p) => alive && setData(p))
        .catch((e) => alive && setError((e as Error).message));
    void load();
    const timer = setInterval(load, 8000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [agent, onClose]);

  const species = SPECIES.find((s) => s.id === data?.species);
  const color = data ? SPECIES_COLOR[data.species as SpeciesId] ?? "#fff" : "#fff";

  return (
    <AnimatePresence>
      {agent && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 backdrop-blur-md sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.article
            role="dialog"
            aria-modal="true"
            aria-label={`${agent} passport`}
            className="mobile-menu-glass relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl p-6 sm:rounded-3xl sm:p-10"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" aria-label="Close" onClick={onClose} className="absolute right-5 top-5 text-white/60 hover:text-white">
              <X size={22} />
            </button>

            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <img src={`/agents/${agent}.webp`} alt="" className="h-28 w-28 shrink-0 rounded-full ring-1 ring-white/10" />
              <div>
                <p className="text-[11px] font-light uppercase tracking-[0.3em] text-white/50">
                  Passport · {data?.node ?? "…"}
                </p>
                <h3 className="font-garamond mt-2 text-5xl uppercase tracking-tight">{agent}</h3>
                <p className="mt-2 text-sm font-light text-white/60">
                  <span style={{ color }}>{species?.name ?? "…"}</span>
                  {data && (
                    <>
                      {" · "}
                      <span className={data.status === "awake" ? "text-white" : ""}>{data.status}</span>
                      {data.nextRunAt ? ` · next wake ${new Date(data.nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                    </>
                  )}
                </p>
              </div>
            </div>

            {error && <p className="mt-8 text-sm text-white/60">Could not reach the node: {error}</p>}

            {data && (
              <>
                <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-4">
                  {[
                    [data.wakes, "wake-ups"],
                    [data.feedSpent.toFixed(1), "feed spent"],
                    [`${data.signalsAccepted}/${data.signalsAccepted + data.signalsRejected}`, "signals accepted"],
                    [data.signalsReceived, "signals received"],
                    [data.artifacts, "artifacts"],
                    [data.stops, "runtime stops"],
                    [data.wokenBy.visitor + data.wokenBy.guardian, "woken by people"],
                    [since(data.firstSeen), "first seen"],
                  ].map(([value, label]) => (
                    <div key={label}>
                      <b className="font-garamond block text-3xl font-normal leading-none">{value}</b>
                      <span className="mt-1 block text-[10px] font-light uppercase tracking-[0.2em] text-white/50">{label}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-8">
                  <WakeButton agent={agent} />
                </div>

                <div className="mt-8">
                  <p className="mb-3 text-[10px] font-light uppercase tracking-[0.25em] text-white/50">Last steps · from the public log</p>
                  <ul className="text-[12px] font-light leading-snug">
                    {data.lastSteps.length === 0 && <li className="text-white/40">No steps yet.</li>}
                    {data.lastSteps.map((s) => (
                      <li key={s.seq} className="flex gap-3 border-b border-dashed border-white/10 py-2 text-white/65">
                        <span className="w-16 shrink-0 text-white/30">{new Date(s.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="flex-1">{s.summary}</span>
                        <span className="text-white/25">#{s.seq}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </motion.article>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
