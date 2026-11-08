import { lang } from "./i18n";
/** A score is only as good as its sample: every accuracy on the site carries how many calls it rests on. */
export function accuracyLabel(skill: number | null | undefined, graded: number, unit = "call"): string {
  if (skill === null || skill === undefined) return "-";
  if (lang() === "zh") return `${Math.round(skill * 100)}% · ${graded} ${unit === "call" ? "次判断" : unit === "answer" ? "个回答" : "次"}`;
  return `${Math.round(skill * 100)}% · ${graded} ${graded === 1 ? unit : `${unit}s`}`;
}

/** A night's balanced score only counts when both a dead and a living token were graded; older nights stored 100% from the dead side alone. */
export function nightSkill(score: { skill?: number | null; cases?: Array<{ outcome: string; already?: boolean }> } | null | undefined): number | null {
  if (!score || score.skill === null || score.skill === undefined) return null;
  if (!score.cases) return score.skill;
  const fair = score.cases.filter((c) => c.outcome !== "unknown" && !c.already);
  return fair.some((c) => c.outcome === "dead") && fair.some((c) => c.outcome === "alive") ? score.skill : null;
}
