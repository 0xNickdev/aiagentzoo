import { useEffect, useMemo, useState } from "react";
import { useGuardian } from "../../zoo";
import { GuardianButton } from "../Guardian";
import { t as tr } from "../../i18n";
import type { BriefDoc } from "./types";
import { nodeUrl } from "./shared";
import { Watched } from "./sections";

export function WatchPanel({ brief }: { brief: BriefDoc | null }) {
  const { session } = useGuardian();
  const [mints, setMints] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return setMints([]);
    nodeUrl("raven")
      .then((url) => url && fetch(`${url}/v1/watchlist/${session.publicKey}`).then((r) => r.json()))
      .then((body) => body && setMints(body.mints ?? []))
      .catch(() => undefined);
  }, [session]);

  const change = async (mint: string, action: "add" | "remove") => {
    if (!session) return;
    setMessage(null);
    const url = await nodeUrl("raven");
    if (!url) return setMessage(tr("The watch node is unreachable."));
    const res = await fetch(`${url}/v1/watchlist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guardian: { publicKey: session.publicKey, message: session.message, signature: session.signature }, mint, action }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage(body.error ?? `HTTP ${res.status}`);
    setMints(body.mints);
    setInput("");
    setMessage(tr(action === "add" ? "Added. The raven hands the watch to the hedgehog every hour." : "Removed."));
  };

  const mine = useMemo(
    () => (brief?.sections.watched ?? []).filter((o) => session && o.watchedBy?.includes(session.publicKey)),
    [brief, session],
  );

  return (
    <div className="grid gap-8 rounded-2xl bg-gradient-to-br from-white/[0.04] to-transparent p-7 ring-1 ring-white/10 sm:p-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <p className="tabular-nums text-[13px] text-fg-4">{tr("Guardian watch · free")}</p>
        <h3 className="font-display mt-3 text-4xl">{tr("Watch my token")}</h3>
        <p className="mt-3 max-w-md text-[14px] font-normal leading-relaxed text-fg-4">
          {tr("Sign in with a Solana wallet and add up to three tokens. The pack checks them every hour (liquidity, volume, sharp moves) and they get your own section in the next Morning Brief.")}
        </p>
      </div>
      <div className="flex flex-col justify-center">
      {!session ? (
        <GuardianButton />
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) void change(input.trim(), "add");
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={tr("Token mint address")}
              className="min-w-0 flex-1 rounded-full bg-white/5 px-4 py-2.5 font-mono text-[13px] text-white placeholder:text-fg-4 ring-1 ring-white/15 focus:outline-none focus:ring-white/40"
            />
            <button type="submit" className="rounded-full bg-white px-5 py-2.5 text-[13px] font-medium [&::first-letter]:uppercase text-black hover:bg-white/90">
              {tr("Add")}
            </button>
          </form>
          {message && <p className="mt-2 text-[13px] font-normal text-fg-4">{message}</p>}
          <ul className="mt-4 grid gap-2">
            {mints.map((m) => (
              <li key={m} className="flex items-center justify-between gap-3 rounded-full bg-white/5 px-4 py-2 tabular-nums text-[13px] text-fg-2">
                <span className="truncate">{m}</span>
                <button type="button" onClick={() => change(m, "remove")} className="shrink-0 text-fg-4 hover:text-white">
                  {tr("remove")}
                </button>
              </li>
            ))}
          </ul>
          {mine.length > 0 && <div className="mt-5"><Watched items={mine} /></div>}
          <GuardianButton className="mt-5" />
        </>
      )}
      </div>
    </div>
  );
}
