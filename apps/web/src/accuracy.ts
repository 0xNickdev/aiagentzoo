import { lang } from "./i18n";
/** A score is only as good as its sample: every accuracy on the site carries how many calls it rests on. */
export function accuracyLabel(skill: number | null | undefined, graded: number, unit = "call"): string {
  if (skill === null || skill === undefined) return "-";
  if (lang() === "zh") return `${Math.round(skill * 100)}% · ${graded} ${unit === "call" ? "次判断" : unit === "answer" ? "个回答" : "次"}`;
  return `${Math.round(skill * 100)}% · ${graded} ${graded === 1 ? unit : `${unit}s`}`;
}
