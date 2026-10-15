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
