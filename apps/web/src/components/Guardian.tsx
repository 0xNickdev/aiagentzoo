import { useEffect, useState } from "react";
import { loadDirectory, shortAddress, useGuardian, wakeAgent } from "../zoo";

/** Sign in / out as a guardian with a Solana wallet. */
export function GuardianButton({ className = "" }: { className?: string }) {
  const { session, signIn, signOut, error, busy } = useGuardian();
  return (
    <div className={className}>
      {session ? (
        <button
          type="button"
          onClick={signOut}
          title="Sign out"
          className="liquid-glass rounded-full px-4 py-2 text-[12px] text-white/90"
        >
          Guardian {shortAddress(session.publicKey)}
        </button>
      ) : (
        <button
          type="button"
          onClick={signIn}
          disabled={busy}
          className="liquid-glass w-full rounded-full px-4 py-2.5 text-[12px] text-white/90 disabled:opacity-50"
        >
          {busy ? "Check your wallet…" : "Sign in as guardian"}
        </button>
      )}
      {error && <p className="mt-2 text-[11px] text-white/50">{error}</p>}
    </div>
  );
}

/** Wakes a real agent on its live node. Rate-limited per visitor, per wallet and per agent. */
export function WakeButton({ agent }: { agent: string }) {
  const { session } = useGuardian();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [state, setState] = useState<{ text: string; until?: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    loadDirectory()
      .then((nodes) => setAllowed(nodes.some((n) => n.visitorAgents.includes(agent))))
      .catch(() => setAllowed(false));
  }, [agent]);

  useEffect(() => {
    if (!state?.until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state?.until]);

  if (allowed === false) return null;
  const waiting = state?.until && state.until > now ? Math.ceil((state.until - now) / 1000) : 0;

  const wake = async () => {
    setState({ text: "Waking…" });
    const result = await wakeAgent(agent, session);
    if (result.ok) {
      setState({ text: `Woken ${result.by.startsWith("guardian") ? "by you, guardian" : "by you"} — watch the log.`, until: Date.now() + 60_000 });
    } else {
      setState({ text: result.error, until: result.retryAfterMs ? Date.now() + result.retryAfterMs : undefined });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        onClick={wake}
        disabled={allowed === null || waiting > 0 || state?.text === "Waking…"}
        className="rounded-full bg-white px-4 py-2.5 text-[12px] font-medium text-black transition hover:bg-white/90 disabled:opacity-40"
      >
        {waiting > 0 ? `Again in ${waiting}s` : `Wake the ${agent}`}
      </button>
      {state && <span className="text-[11px] font-light leading-snug text-white/55">{state.text}</span>}
    </div>
  );
}
