import { Hammer, Landmark, Network, Package, Rat, Repeat, Skull, Sprout, Waves } from "lucide-react";
import { t } from "../i18n";

/**
 * What a wallet is, the way terminals label them: one small mark each, the same set everywhere the x-ray lives.
 * The node gives the tags (apps/node/src/chain/tags.ts); this is only how they look.
 */
export type WalletTag = "crew" | "rugger" | "ring" | "serial" | "bundle" | "whale" | "dev" | "exchange" | "new";

export const TAG: Record<WalletTag, { Icon: typeof Rat; color: string; label: string; what: string }> = {
  crew: { Icon: Rat, color: "#ff8a7e", label: "creator's own wallet", what: "snipes this creator's other launches too" },
  rugger: { Icon: Skull, color: "#ff8a7e", label: "known rugger", what: "launched tokens before and dumped most of them" },
  ring: { Icon: Network, color: "#ffc27a", label: "sniper ring", what: "has sniped launches together with other wallets here: one operator" },
  serial: { Icon: Repeat, color: "#c9b48a", label: "serial sniper", what: "buys launches in the first seconds to sell to whoever comes next" },
  bundle: { Icon: Package, color: "#a3aaa6", label: "bundler", what: "bought in the launch block, or bundles launches as a habit" },
  whale: { Icon: Waves, color: "#8ec5ff", label: "whale", what: "took two percent of the supply or more" },
  dev: { Icon: Hammer, color: "#d8c49a", label: "has launched before", what: "launched tokens the zoo has kept, and did not dump most of them" },
  exchange: { Icon: Landmark, color: "#a3aaa6", label: "exchange or launcher", what: "everyone's wallet, so it ties no one together" },
  new: { Icon: Sprout, color: "#a6e3b4", label: "new wallet", what: "never seen by the zoo before this launch" },
};

const ORDER: WalletTag[] = ["crew", "rugger", "ring", "serial", "bundle", "whale", "dev", "exchange", "new"];
export const sortTags = (tags: WalletTag[] | undefined) => ORDER.filter((k) => tags?.includes(k));

/** The marks in a row, each with its name on hover. */
export function Tags({ tags, size = 13, className = "" }: { tags?: WalletTag[]; size?: number; className?: string }) {
  const list = sortTags(tags);
  if (!list.length) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-label={list.map((k) => t(TAG[k].label)).join(", ")}>
      {list.map((k) => {
        const { Icon, color, label } = TAG[k];
        return <Icon key={k} size={size} strokeWidth={1.75} style={{ color }} aria-hidden={false} role="img" aria-label={t(label)} />;
      })}
    </span>
  );
}

/** The marks with their names, one line each, for a wallet's own card. */
export function TagList({ tags }: { tags?: WalletTag[] }) {
  const list = sortTags(tags);
  if (!list.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {list.map((k) => {
        const { Icon, color, label, what } = TAG[k];
        return (
          <li key={k} className="flex items-start gap-2 text-[12.5px] leading-snug">
            <Icon size={14} strokeWidth={1.75} className="mt-[2px] shrink-0" style={{ color }} aria-hidden />
            <span>
              <span style={{ color }}>{t(label)}</span>
              <span className="text-fg-4"> · {t(what)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
