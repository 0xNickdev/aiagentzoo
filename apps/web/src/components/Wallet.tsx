import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { NODE_URLS } from "../sim/live";
import { shortAddress, useGuardian } from "../zoo";
import { t } from "../i18n";

const CANYON = NODE_URLS.find((u) => u.includes("canyon")) ?? NODE_URLS[NODE_URLS.length - 1] ?? "";

interface Holder {
  holder: boolean;
  balance: number | null;
  min: number;
}

/** Whether the signed-in wallet holds enough $ZOOAGENCY for the holder perks; null until known. */
export function useHolder(wallet: string | null): Holder | null {
  const [h, setH] = useState<Holder | null>(null);
  useEffect(() => {
    setH(null);
    if (!wallet || !CANYON) return;
    fetch(`${CANYON}/v1/holder/${wallet}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Holder | null) => b && setH(b))
      .catch(() => {});
  }, [wallet]);
  return h;
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

/**
 * The header's one primary action. Signing in is a free message signature, never a transaction; it is the key to
 * every holder perk (alerts first, more checks, the vote).
 */
export default function WalletButton({ block = false }: { block?: boolean }) {
  const { session, signIn, signOut, error, busy } = useGuardian();
  const holder = useHolder(session?.publicKey ?? null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const base = `rounded-full px-4 py-2 text-[13.5px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 ${block ? "w-full py-3 text-[15px]" : ""}`;

  if (!session)
    return (
      <div className={block ? "w-full" : ""}>
        <button type="button" onClick={signIn} disabled={busy} className={`${base} bg-white text-black hover:bg-white/90 disabled:opacity-70`}>
          {busy ? t("Check your wallet...") : t("Connect wallet")}
        </button>
        {error && <p className="mt-2 max-w-[220px] text-[12.5px] text-[#ff8a7e]">{t(error)}</p>}
      </div>
    );

  return (
    <div ref={box} className={`relative ${block ? "w-full" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${base} font-mono flex items-center justify-center gap-2 border border-white/20 bg-white/[0.06] text-white hover:bg-white/[0.1]`}>
        <span className={`h-2 w-2 rounded-full ${holder?.holder ? "bg-amber-200 shadow-[0_0_8px_rgba(253,230,138,0.8)]" : "bg-white/40"}`} />
        {shortAddress(session.publicKey)}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-white/15 bg-[#070908]/[0.97] p-4 text-left shadow-[0_24px_60px_rgba(0,0,0,0.7)] backdrop-blur-xl"
          >
            <p className="font-mono text-[12.5px] text-white/60">{shortAddress(session.publicKey)}</p>
            {holder ? (
              holder.holder ? (
                <p className="mt-2 text-[15px] text-amber-100">{t("Holder · alerts first, more checks, the vote")}</p>
              ) : (
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                  {t("Not a holder yet. Holding {n} $ZOOAGENCY opens alerts first, more checks and the vote.", { n: fmt(holder.min) })}
                </p>
              )
            ) : (
              <p className="mt-2 text-[14px] text-white/60">{t("Reading your balance...")}</p>
            )}
            {holder?.balance != null && <p className="font-mono mt-1 text-[12.5px] text-white/55">{t("balance {n}", { n: fmt(holder.balance) })}</p>}
            <div className="mt-4 grid gap-1 border-t border-white/10 pt-3 text-[14px]">
              <a href="/ask" className="rounded-lg px-2 py-1.5 text-white/85 hover:bg-white/[0.06] hover:text-white">
                {t("Watch a token in Telegram")}
              </a>
              <a href="/connect#api" className="rounded-lg px-2 py-1.5 text-white/85 hover:bg-white/[0.06] hover:text-white">
                {t("Your API key")}
              </a>
              <button type="button" onClick={() => (signOut(), setOpen(false))} className="rounded-lg px-2 py-1.5 text-left text-white/60 hover:bg-white/[0.06] hover:text-white">
                {t("Disconnect")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
