/** A score is only as good as its sample: every accuracy on the site carries how many calls it rests on. */
export function accuracyLabel(skill: number | null | undefined, graded: number, unit = "call"): string {
  if (skill === null || skill === undefined) return "-";
  return `${Math.round(skill * 100)}% · ${graded} ${graded === 1 ? unit : `${unit}s`}`;
}
