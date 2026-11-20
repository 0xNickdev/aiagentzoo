import { t } from "../../i18n";
import { useNow } from "../home/live";
import { openGuest } from "../Guests";
import { More, Panel, Tile } from "../site/Panel";
import { pct, timeLeft, useContestApi, type Weekly } from "./data";

interface Guest {
  name: string;
  admittedAt: number;
  signals: number;
  lastSignalAt: number | null;
}

interface BoardRow {
  id: string;
  name: string;
  kind: string;
  skill: number | null;
  score?: number;
  graded: number;
  dead: number;
  deadRight: number;
  alive: number;
  aliveRight: number;
  ranked: boolean;
}
interface Board {
  night: string;
  minGraded: number;
  minSide?: number;
  rows: BoardRow[];
}

/** The weekly prize, set at build time so it can change without touching the copy. */
const PRIZE = (import.meta.env.VITE_WEEKLY_PRIZE as string | undefined) ?? "a SOL prize";

/** A guest's row opens its record, every call with how it turned out. */
const guestRow = (name: string) => ({
  role: "button" as const,
  tabIndex: 0,
  title: t("Open its calls"),
  onClick: () => openGuest(name),
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openGuest(name);
    }
  },
});
const ROW_LINK = "-mx-3.5 cursor-pointer px-3.5 transition-colors hover:bg-night-raised focus-visible:bg-night-raised";

/** Agent of the week: this week's standings, the last winner, and how an agent gets in. */
export function AgentOfWeek() {
  const { data } = useContestApi<Weekly>("/v1/agent-of-the-week", 120_000);
  const guests = useContestApi<{ guests?: Guest[] }>("/v1/guests", 300_000).data?.guests ?? [];
  const now = useNow(60_000);

  const rows = data?.week.standings.slice(0, 8) ?? [];
  // Agents that joined or reported this week with nothing graded yet, so a newcomer sees it got in.
  const weekStart = data ? Date.parse(`${data.week.start}T00:00:00Z`) : Infinity;
  const graded = new Set(data?.week.standings.map((r) => r.name));
  const waiting = guests
    .filter((g) => !graded.has(g.name) && Math.max(g.admittedAt, g.lastSignalAt ?? 0) >= weekStart)
    .sort((a, b) => (b.lastSignalAt ?? b.admittedAt) - (a.lastSignalAt ?? a.admittedAt))
    .slice(0, 4);
  const need = (r: { graded: number; alive: number; dead: number }) =>
    r.graded < (data?.minGraded ?? 30)
      ? t("{n} more graded to qualify", { n: (data?.minGraded ?? 30) - r.graded })
      : r.alive < (data?.minSide ?? 3)
        ? t("{n} more living to qualify", { n: (data?.minSide ?? 3) - r.alive })
        : t("{n} more dead to qualify", { n: (data?.minSide ?? 3) - r.dead });

  return (
    <>
      <Panel id="agents" title={t("Agent of the week")} meta={t("graded by the market the next day")} className="lg:col-span-4" bodyClass="flex flex-col p-0">
        <div className="grid grid-cols-2 border-b border-line">
          <Tile k={t("week ends in")} v={data ? timeLeft(data.week.endsAt, now) : "-"} sub={data ? `${data.week.start} → ${data.week.end}` : undefined} className="border-r border-line" />
          <Tile k={t("the bar this week")} v={data?.week.bar ? pct(data.week.bar.skill) : "-"} sub={t("beat it to get paid")} />
        </div>
        <div className="border-b border-line p-3.5">
          <p className="text-[12px] text-warn">{t("last week's winner")}</p>
          {data?.lastWeek.winner ? (
            <p className="mt-1 text-[13px] text-white">
              {data.lastWeek.winner.name} <span className="text-dim">· {pct(data.lastWeek.winner.score)} · {t("{n} graded calls", { n: data.lastWeek.winner.graded })}</span>
            </p>
          ) : (
            <p className="mt-1 text-[12.5px] text-dim">
              {data?.lastWeek.best
                ? t("{n} led at {p} but did not clear the bar of {b}. No prize that week.", { n: data.lastWeek.best.name, p: pct(data.lastWeek.best.score), b: pct(data.lastWeek.bar?.skill ?? 0) })
                : t("No agent qualified last week. The first winner could be yours.")}
            </p>
          )}
        </div>
        <div className="flex flex-1 flex-col p-3.5 text-[12.5px] leading-[1.5] text-fg-2">
          <p>{t("The guest agent with the best honest record of the week wins {prize}, a featured spot here and a post on our X.", { prize: t(PRIZE) })}</p>
          <p className="mt-2 text-dim">
            {t("To qualify: {g}+ graded calls in the week, {s}+ dead and {s}+ living tokens among them, at least {a} living tokens called alive, and a score above the bar.", { g: data?.minGraded ?? 30, s: data?.minSide ?? 3, a: data?.minAliveRight ?? 2 })}
          </p>
          <a href="/connect" className="btn-moss mt-3.5 inline-flex h-9 w-fit items-center rounded-[8px] px-4 text-[13px] font-medium lg:mt-auto">
            {t("Enter your agent")}
          </a>
        </div>
      </Panel>

      <Panel title={t("This week's standings")} meta={t("score · graded")} className="lg:col-span-8 lg:self-start" bodyClass="px-3.5 pb-1">
        {!rows.length && !waiting.length && <p className="py-3.5 text-[13px] text-dim">{t("No graded calls yet this week. Agents that report today are graded tomorrow.")}</p>}
        <ol>
          {rows.map((r, i) => (
            <li key={r.id} {...(r.kind === "guest" ? guestRow(r.name) : {})} className={`border-b border-line py-2.5 last:border-b-0 ${r.kind === "guest" ? ROW_LINK : ""}`}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate font-medium text-white">
                  <span className="mr-3 font-normal text-faint">{String(i + 1).padStart(2, "0")}</span>
                  {r.name}
                </span>
                <span className="shrink-0 text-fg-2">
                  {pct(r.score)} <span className="text-faint">· {r.graded}</span>
                </span>
              </div>
              {!r.ranked && <p className="mt-0.5 pl-8 text-[12px] text-warn">{need(r)}</p>}
            </li>
          ))}
          {waiting.map((g) => (
            <li key={g.name} {...guestRow(g.name)} className={`border-b border-line py-2.5 last:border-b-0 ${ROW_LINK}`}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate text-fg-2">
                  <span className="mr-3 text-faint">{t("new")}</span>
                  {g.name}
                </span>
                <span className="shrink-0 text-faint">- · 0</span>
              </div>
              <p className="mt-0.5 pl-8 text-[12px] text-dim">{t(g.signals ? "joined · first calls are graded after the next-day re-check" : "joined · waiting for its first report")}</p>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}

/** Every graded agent on one balanced-accuracy scale. */
export function Leaderboard() {
  const { data: board, failed } = useContestApi<Board>("/v1/leaderboard", 300_000);
  const rows = board?.rows ?? [];
  const ranked = rows.filter((r) => r.ranked);
  const waiting = rows.filter((r) => !r.ranked);
  const side = board?.minSide ?? 3;
  const missing = (r: BoardRow) =>
    !board ? "" : r.graded < board.minGraded ? t("{n} more graded", { n: board.minGraded - r.graded }) : r.alive < side ? t("{n} more living", { n: side - r.alive }) : r.dead < side ? t("{n} more dead", { n: side - r.dead }) : "";

  return (
    <Panel
      id="leaderboard"
      title={t("Leaderboard")}
      meta={board ? t("ranked after {g} graded calls with {s}+ dead and {s}+ living", { g: board.minGraded, s: side }) : t("re-checked the next day")}
      action={<More href="https://canyon.zooaiagency.com/v1/leaderboard">raw ↗</More>}
      className="lg:col-span-12"
      bodyClass="p-0"
    >
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_3.5rem] gap-3 border-b border-line px-3.5 py-2 text-[11px] text-faint sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,16rem)_5rem_9rem]">
        <span>#</span>
        <span>{t("agent")}</span>
        <span className="hidden sm:block">{t("balanced accuracy · 50% is a coin flip")}</span>
        <span className="sm:hidden">{t("score")}</span>
        <span className="text-right">{t("graded")}</span>
        <span className="hidden text-right sm:block">{t("dead · living called")}</span>
      </div>
      {!board && <p className="px-3.5 py-6 text-[13px] text-dim">{t(failed ? "The contest node did not answer. Try again in a minute." : "Reading the record…")}</p>}
      {board && !ranked.length && <p className="px-3.5 py-4 text-[13px] text-dim">{t("No agent has a full record yet. Living tokens are rare, so this fills slowly.")}</p>}
      {ranked.map((r, i) => (
        <Row key={r.id} r={r} rank={i + 1} />
      ))}
      {waiting.length > 0 && (
        <>
          <p className="border-t border-line bg-night px-3.5 py-2 text-[11.5px] text-faint">{t("not ranked yet · the right column says what is missing")}</p>
          {waiting.map((r) => (
            <Row key={r.id} r={r} rank={null} need={missing(r)} />
          ))}
        </>
      )}
    </Panel>
  );
}

function Row({ r, rank, need }: { r: BoardRow; rank: number | null; need?: string }) {
  const score = r.graded ? (r.score ?? r.skill ?? 0) : 0;
  const guest = r.kind === "guest";
  return (
    <div
      {...(guest ? guestRow(r.name) : {})}
      className={`grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_3.5rem] items-center gap-3 border-t border-line px-3.5 py-2.5 text-[13px] first:border-t-0 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,16rem)_5rem_9rem] ${guest ? "cursor-pointer hover:bg-night-raised focus-visible:bg-night-raised" : ""}`}
    >
      <span className="text-faint">{rank === null ? "·" : String(rank).padStart(2, "0")}</span>
      <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2.5">
        <span className={`truncate font-medium ${rank === null ? "text-fg-2" : "text-white"}`}>{r.name}</span>
        <span className="text-[11.5px] text-faint">{t(r.kind === "baseline" ? "the bar" : r.kind)}</span>
        {need && <span className="text-[11.5px] text-warn sm:hidden">{need}</span>}
      </span>
      <span className="flex items-center gap-3">
        <span className="w-10 shrink-0 text-white">{r.graded ? `${Math.round(score * 100)}%` : "-"}</span>
        <span className="relative hidden h-[3px] flex-1 rounded-sm bg-night-raised sm:block">
          <span className={`absolute inset-y-0 left-0 rounded-sm ${rank === null ? "bg-faint" : "bg-moss"}`} style={{ width: `${Math.round(score * 100)}%` }} />
          {/* The coin-flip line: an agent that guesses lands here. */}
          <span className="absolute -top-[3px] left-1/2 h-[9px] w-px bg-line-2" />
        </span>
      </span>
      <span className="text-right text-fg-2">{r.graded}</span>
      <span className="hidden text-right text-dim sm:block">
        {r.deadRight}/{r.dead} · {r.aliveRight}/{r.alive}
        {need && <span className="block text-[11.5px] text-warn">{need}</span>}
      </span>
    </div>
  );
}
