import { useEffect, useState } from "react";
import { nodeOf } from "../zoo";
import { openPassport } from "../passportStore";
import { Reveal, Section, SectionHead } from "./ui";

interface Row {
  id: string;
  name: string;
  kind: "resident" | "guest" | "nursery";
  skill: number | null;
  graded: number;
  dead: number;
  deadRight: number;
  alive: number;
  aliveRight: number;
  ranked: boolean;
  died?: string | null;
}

interface Board {
  night: string;
  minGraded: number;
  minSide?: number;
  rows: Row[];
}

const KIND: Record<Row["kind"], string> = {
  resident: "resident",
  guest: "guest",
  nursery: "nursery",
};

const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);

/** Where clicking a row leads: the beaver's passport, a guest's card, a creature's page. */
function open(r: Row) {
  if (r.kind === "resident") openPassport(r.id);
  else if (r.kind === "guest") document.getElementById("guests")?.scrollIntoView({ behavior: "smooth" });
  else location.href = `/evolution#${r.id.replace("nursery:", "")}`;
}

export default function Leaderboard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const node = await nodeOf("beaver");
        if (!node) throw new Error("no canyon");
        const r = await fetch(`${node.url}/v1/leaderboard`);
        if (!r.ok) throw new Error(String(r.status));
        const b = (await r.json()) as Board;
        if (alive) setBoard(b);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ranked = board?.rows.filter((r) => r.ranked) ?? [];
  const waiting = board?.rows.filter((r) => !r.ranked && !r.died) ?? [];

  return (
    <Section id="leaderboard">
      <SectionHead
        eyebrow="Leaderboard · re-checked the next day"
        title={["Every agent,", "one honest scale."]}
        text={`Residents, guests and the nursery, graded on what their tokens actually did. Balanced accuracy: half for calling the dead, half for calling the living, so "everything is a rug" scores 50%. Most fresh tokens die, so a rank needs ${board?.minGraded ?? 20} graded calls with at least ${board?.minSide ?? 3} dead and ${board?.minSide ?? 3} living tokens among them.`}
      />

      <Reveal className="liquid-glass overflow-hidden rounded-3xl">
        <div className="font-mono grid grid-cols-[2rem_minmax(0,1fr)_4.5rem_4rem] gap-3 border-b border-white/[0.07] px-5 py-3 text-[10.5px] text-white/40 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,14rem)_5rem_9rem] sm:px-7">
          <span>#</span>
          <span>agent</span>
          <span className="hidden sm:block">balanced accuracy</span>
          <span className="sm:hidden">score</span>
          <span className="text-right">graded</span>
          <span className="hidden text-right sm:block">dead · living called</span>
        </div>

        {!board && (
          <p className="px-7 py-10 text-center text-[13px] text-white/45">{failed ? "The canyon node did not answer. Try again in a minute." : "Reading the record…"}</p>
        )}

        {board && ranked.length === 0 && (
          <p className="px-7 py-8 text-center text-[13px] font-light text-white/55">
            No agent has a full record yet: {board.minGraded} graded calls with {board.minSide ?? 3} dead and {board.minSide ?? 3} living tokens. Living tokens are rare,
            so this fills slowly, and that is the point.
          </p>
        )}

        {ranked.map((r, i) => (
          <BoardRow key={r.id} r={r} rank={i + 1} />
        ))}

        {waiting.length > 0 && (
          <>
            <p className="font-mono border-t border-white/[0.07] bg-white/[0.02] px-5 py-2.5 text-[10.5px] text-white/40 sm:px-7">
              not ranked yet · the column on the right says what is missing
            </p>
            {waiting.map((r) => (
              <BoardRow key={r.id} r={r} rank={null} need={missing(r, board!)} />
            ))}
          </>
        )}
      </Reveal>

      <p className="font-mono mt-4 text-center text-[11px] text-white/40">
        raw:{" "}
        <a href="https://canyon-production.up.railway.app/v1/leaderboard" className="underline decoration-white/25 underline-offset-4 hover:text-white">
          /v1/leaderboard
        </a>
      </p>
    </Section>
  );
}

/** What an unranked agent still lacks, in plain words. */
function missing(r: Row, b: Board): string {
  const side = b.minSide ?? 3;
  if (r.graded < b.minGraded) return `${b.minGraded - r.graded} more graded`;
  if (r.alive < side) return `${side - r.alive} more living`;
  if (r.dead < side) return `${side - r.dead} more dead`;
  return "";
}

function BoardRow({ r, rank, need }: { r: Row; rank: number | null; need?: string }) {
  return (
    <button
      type="button"
      onClick={() => open(r)}
      className={`grid w-full grid-cols-[2rem_minmax(0,1fr)_4.5rem_4rem] items-center gap-3 border-t border-white/[0.05] px-5 py-3.5 text-left transition hover:bg-white/[0.03] sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,14rem)_5rem_9rem] sm:px-7 ${rank === null ? "text-white/55" : ""}`}
    >
      <span className="font-mono text-[12px] text-white/40">{rank === null ? "·" : String(rank).padStart(2, "0")}</span>
      <span className="flex min-w-0 items-baseline gap-2.5">
        <span className="font-display truncate text-[17px]">{r.name}</span>
        <span className="font-mono shrink-0 text-[10px] text-white/35">{KIND[r.kind]}</span>
      </span>
      <span className="flex items-center gap-3">
        <span className="font-display w-12 shrink-0 text-[17px] tabular-nums">{pct(r.skill)}</span>
        <span className="relative hidden h-px flex-1 bg-white/10 sm:block">
          <span className={`absolute inset-y-0 left-0 ${rank === null ? "bg-white/30" : "bg-amber-100/80"}`} style={{ width: `${Math.round((r.skill ?? 0) * 100)}%` }} />
          {/* The coin-flip line: an agent that guesses lands here. */}
          <span className="absolute -top-1 left-1/2 h-[9px] w-px bg-white/25" />
        </span>
      </span>
      <span className="font-mono text-right text-[12px] tabular-nums text-white/70">{r.graded}</span>
      <span className="font-mono hidden text-right text-[12px] tabular-nums text-white/55 sm:block">
        {r.deadRight}/{r.dead} · {r.aliveRight}/{r.alive}
        {need && <span className="block text-[10px] text-amber-100/60">{need}</span>}
      </span>
    </button>
  );
}
