import { useCallback, useEffect, useState } from "react";
import type { Access, XRayReport } from "./types";

/**
 * Who may open the deep check, and how they pay for it. Everything the payment step needs plugs in here: the panels
 * only ever call `useAccess`, `useFreeDeepCheck` and `startCheckout`.
 *
 * TODO(payments): the node already serves `access.tier` on /v1/xray. When the SOL checkout lands:
 *   - `startCheckout` opens the real payment (SOL transfer, $ZOOAGENCY holder discount checked on the node), then
 *     re-fetches the report so `access.tier` comes back "pro";
 *   - `useFreeDeepCheck().run` asks the node to spend the reader's weekly free deep check on this mint. Until then it
 *     opens nothing and says so.
 */

export type Period = "day" | "week" | "month";

/** Pro passes in USD, paid in SOL at the rate of the moment. */
export const PRICES: Record<Period, { usd: number; per: string; save: string }> = {
  day: { usd: 3, per: "per day", save: "" },
  week: { usd: 12, per: "per week", save: "$9 less than seven day passes" },
  month: { usd: 35, per: "per month", save: "$13 less than four week passes" },
};
/** Holders of this much $ZOOAGENCY pay half; a tenth of every pass buys $ZOOAGENCY back. */
export const HOLDER_MIN = 500_000;

export interface AccessState {
  tier: string;
  pro: boolean;
  /** The deep check is open for this mint: Pro, or the weekly free check spent on it. */
  deep: boolean;
  perMinute: number | null;
  until: number | null;
}

/** What the panels say while the payment backend is not live: nothing deep opens on the client alone. */
export const NOT_LIVE = "Paying in SOL and the free deep check open in a few days.";
const MSG_EVENT = "zoo-deep-msg";

/** The reader's tier as the node served this report, and whether the deep check is open for it. */
export function useAccess(r: Pick<XRayReport, "mint" | "access"> | null): AccessState {
  const a: Access | undefined = r?.access;
  const tier = a?.tier ?? "free";
  const pro = tier !== "free";
  // Only the node opens the deep check: a client-side marker would be a lock anyone can lift.
  return { tier, pro, deep: pro, perMinute: a?.perMinute ?? null, until: a?.until ?? null };
}

/**
 * One free deep check a week. Until the node spends it (TODO(payments)), `run` opens nothing: it shows the same
 * "opens in a few days" message as the checkout, on every panel that offers it.
 */
export function useFreeDeepCheck(mint: string | null) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setMessage(null);
  }, [mint]);
  useEffect(() => {
    const on = (e: Event) => setMessage((e as CustomEvent<string>).detail);
    window.addEventListener(MSG_EVENT, on);
    return () => window.removeEventListener(MSG_EVENT, on);
  }, []);
  const run = useCallback(async () => {
    // TODO(payments): POST the mint to the node's free deep check and re-fetch the report when it answers.
    window.dispatchEvent(new CustomEvent(MSG_EVENT, { detail: NOT_LIVE }));
    return false;
  }, []);
  return { left: 1 as 0 | 1, usedOn: null as string | null, resetsAt: null as number | null, busy: false, message, run };
}

/** Starts paying for a Pro pass. Resolves with what the panel should say while the checkout is not live yet. */
export async function startCheckout(period: Period): Promise<{ ok: boolean; message: string }> {
  // TODO(payments): open the SOL checkout for PRICES[period].usd and refresh access when it lands.
  void period;
  return { ok: false, message: NOT_LIVE };
}
