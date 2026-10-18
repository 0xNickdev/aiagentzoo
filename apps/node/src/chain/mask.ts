/**
 * Slurs in token names and tickers. Launchers put them there on purpose; the zoo shows the token, not the insult:
 * the matched part becomes its first letter and dots, the rest of the name stays readable.
 */
const SLURS = [
  /n[i1!|]gg+(?:a|er|ah|uh|az|ers|as)?/gi,
  /n[eè]gr[eo]s?/gi,
  /f[a@4]gg?[o0]ts?/gi,
  /k[i1]kes?/gi,
  /ch[i1]nks?/gi,
  /tr[a@4]nn(?:y|ies)/gi,
  /\bsp[i1]cs?\b/gi,
  /\bc[o0]{2}ns?\b/gi,
];

export function mask(text: string): string {
  let out = text;
  for (const re of SLURS) out = out.replace(re, (m) => m[0] + "•".repeat(Math.max(2, m.length - 1)));
  return out;
}
