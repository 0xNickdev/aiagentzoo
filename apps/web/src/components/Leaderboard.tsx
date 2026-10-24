import { useEffect, useState } from "react";
import { nodeOf } from "../zoo";
import { openPassport } from "../passportStore";
import { Reveal, Section, SectionHead } from "./ui";
import { t } from "../i18n";

interface Row {
  id: string;
  name: string;
  kind: "resident" | "guest" | "nursery";
  skill: number | null;
  /** Balanced accuracy with one right and one wrong added per side. */
  score?: number;
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
        eyebrow={t("Leaderboard · re-checked the next day")}
        title={[t("Every agent,"), t("one honest scale.")]}
        text={t("Residents, guests and the nursery, graded on what their tokens actually did. Balanced accuracy: half for calling the dead, half for calling the living, so \"everything is a rug\" scores 50%. Most fresh tokens die, so a rank needs {g} graded calls with at least {s} dead and {s} living tokens among them. Scores add one right and one wrong to each side, so a handful of lucky calls cannot shine.", { g: board?.minGraded ?? 20, s: board?.minSide ?? 3 })}
      />

      <Reveal className="bg-night-surface border border-white/[0.08] overflow-hidden rounded-2xl">
        <div className="tabular-nums grid grid-cols-[2rem_minmax(0,1fr)_4.5rem_4rem] gap-3 border-b border-white/[0.08] px-5 py-3 text-[12px] text-fg-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,14rem)_5rem_9rem] sm:px-7">
          <span>#</span>
          <span>{t("agent")}</span>
          <span className="hidden sm:block">{t("balanced accuracy")}</span>
          <span className="sm:hidden">{t("score")}</span>
          <span className="text-right">{t("graded")}</span>
          <span className="hidden text-right sm:block">{t("dead · living called")}</span>
        </div>

        {!board && (
          <p className="px-7 py-10 text-center text-[13px] text-fg-3">{t(failed ? "The canyon node did not answer. Try again in a minute." : "Reading the record…")}</p>
        )}

        {board && ranked.length === 0 && (
          <p className="px-7 py-8 text-center text-[13px] font-normal text-fg-4">
            {t("No agent has a full record yet: {g} graded calls with {s} dead and {s} living tokens. Living tokens are rare, so this fills slowly, and that is the point.", { g: board.minGraded, s: board.minSide ?? 3 })}
          </p>
        )}

        {ranked.map((r, i) => (
          <BoardRow key={r.id} r={r} rank={i + 1} />
        ))}

        {waiting.length > 0 && (
          <>
            <p className="tabular-nums border-t border-white/[0.08] bg-white/[0.02] px-5 py-2.5 text-[12px] text-fg-4 sm:px-7">
              {t("not ranked yet · the column on the right says what is missing")}
            </p>
            {waiting.map((r) => (
              <BoardRow key={r.id} r={r} rank={null} need={missing(r, board!)} />
            ))}
          </>
        )}
      </Reveal>

      <p className="tabular-nums mt-4 text-center text-[12.5px] text-fg-4">
        {t("raw:")}{" "}
        <a href="https://canyon.zooaiagency.com/v1/leaderboard" className="underline decoration-white/25 underline-offset-4 hover:text-white">
          /v1/leaderboard
        </a>
      </p>
    </Section>
  );
}

/** What an unranked agent still lacks, in plain words. */
function missing(r: Row, b: Board): string {
  const side = b.minSide ?? 3;
  if (r.graded < b.minGraded) return t("{n} more graded", { n: b.minGraded - r.graded });
  if (r.alive < side) return t("{n} more living", { n: side - r.alive });
  if (r.dead < side) return t("{n} more dead", { n: side - r.dead });
  return "";
}

function BoardRow({ r, rank, need }: { r: Row; rank: number | null; need?: string }) {
  return (
    <button
      type="button"
      onClick={() => open(r)}
      className={`grid w-full grid-cols-[2rem_minmax(0,1fr)_4.5rem_4rem] items-center gap-3 border-t border-white/[0.08] px-5 py-3.5 text-left transition hover:bg-white/[0.03] sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,14rem)_5rem_9rem] sm:px-7 ${rank === null ? "text-fg-4" : ""}`}
    >
      <span className="tabular-nums text-[12px] text-fg-4">{rank === null ? "·" : String(rank).padStart(2, "0")}</span>
      <span className="flex min-w-0 items-baseline gap-2.5">
        <span className="font-display truncate text-[17px]">{r.name}</span>
        <span className="tabular-nums shrink-0 text-[11.5px] text-fg-4">{t(KIND[r.kind])}</span>
      </span>
      <span className="flex items-center gap-3">
        <span className="font-display w-12 shrink-0 text-[17px] tabular-nums" title={t("raw {p}", { p: pct(r.skill) })}>
          {r.graded ? pct(r.score ?? r.skill) : "-"}
        </span>
        <span className="relative hidden h-px flex-1 bg-white/10 sm:block">
          <span className={`absolute inset-y-0 left-0 ${rank === null ? "bg-white/30" : "bg-amber-100/80"}`} style={{ width: `${Math.round((r.graded ? (r.score ?? r.skill ?? 0) : 0) * 100)}%` }} />
          {/* The coin-flip line: an agent that guesses lands here. */}
          <span className="absolute -top-1 left-1/2 h-[9px] w-px bg-white/25" />
        </span>
      </span>
      <span className="tabular-nums text-right text-[12px] tabular-nums text-fg-3">{r.graded}</span>
      <span className="tabular-nums hidden text-right text-[12px] tabular-nums text-fg-4 sm:block">
        {r.deadRight}/{r.dead} · {r.aliveRight}/{r.alive}
        {need && <span className="block text-[11.5px] text-warn">{need}</span>}
      </span>
    </button>
  );
}
