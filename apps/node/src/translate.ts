import { type ModelProvider, renderUntrusted, UNTRUSTED_NOTICE } from "@aiagentzoo/sdk";

/** How the zoo's English reads in Chinese: the Chinese meme-coin community's own words, not a dictionary's. */
export const ZH_SYSTEM = [
  "Translate the text into Simplified Chinese the way the Chinese crypto meme-coin community writes it.",
  "Use their terms: rug / rugged → 跑路, the creator or dev dumped → 开发者砸盘, bundle → 捆绑, graduated → 毕业, bonding curve → 内盘, liquidity → 流动性, holders → 持币者, suspicious → 可疑, watch → 观望, promising → 看好, balanced accuracy → 平衡准确率.",
  "Keep every number, $ticker, wallet and token address exactly as written. Plain and factual, no hype, no emoji.",
  "Output only the translation.",
  UNTRUSTED_NOTICE,
].join("\n");

/** The text in Chinese, or null when no model is at hand or it fails; callers keep the English then. */
export async function toChinese(model: ModelProvider | null | undefined, text: string, maxTokens = 400): Promise<string | null> {
  if (!model || !text.trim()) return null;
  try {
    const r = await model.think({ system: ZH_SYSTEM, prompt: `Translate:\n\n${renderUntrusted(text)}`, maxTokens });
    const out = r.text.replace(/[–—]/g, "-").trim();
    return out && /[一-鿿]/.test(out) ? out.slice(0, 1200) : null;
  } catch {
    return null;
  }
}

/** Several short texts as one numbered list, so one model call translates them all. */
export const numberedLines = (texts: string[]) => texts.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, " ").trim()}`).join("\n");

/** The numbered translations back, by position; a line the model skipped or left in English is null. */
export function parseNumbered(reply: string, count: number): Array<string | null> {
  const out: Array<string | null> = Array.from({ length: count }, () => null);
  for (const line of reply.split("\n")) {
    const m = /^\s*(\d+)[.)、:：]\s*(.+)$/.exec(line);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    const text = m[2]!.replace(/[\u2013\u2014]/g, "-").trim();
    if (i >= 0 && i < count && /[\u4e00-\u9fff]/.test(text)) out[i] = text.slice(0, 400);
  }
  return out;
}
