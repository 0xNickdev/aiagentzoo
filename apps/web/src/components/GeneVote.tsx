import { useCallback, useEffect, useState } from "react";
import { nodeOf, useGuardian } from "../zoo";
import { Section, SectionHead } from "./ui";

interface Candidate {
  id: "a" | "b" | "c";
  rule: string;
}
interface Gene {
  week: string;
  closesAt: string;
  candidates: Candidate[];
  tally: Record<string, number>;
  voters: number;
  mine: string | null;
  lastWinner: Candidate | null;
  pending: { week: string; rule: string } | null;
  naming: { week: string; name: string | null; you: boolean } | null;
}

const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

function left(iso: string): string {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d ? `${d}d ${h}h` : `${h}h`;
}

/** The holders' gene: three rules for the nursery's next newborn, voted with $ZOOAGENCY, and its name from the week's best human. */
export default function GeneVote() {
  const { session, signIn, busy: signing } = useGuardian();
  const [gene, setGene] = useState<Gene | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    const n = await nodeOf("beaver");
    if (!n) return;
    const r = await fetch(`${n.url}/v1/gene${session ? `?wallet=${session.publicKey}` : ""}`).catch(() => null);
    if (r?.ok) setGene((await r.json()) as Gene);
  }, [session]);
  useEffect(() => void load(), [load]);

  const post = async (path: string, extra: Record<string, string>) => {
    if (!session) return void signIn();
    setMsg(null);
    const n = await nodeOf("beaver");
    const r = await fetch(`${n!.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guardian: { publicKey: session.publicKey, message: session.message, signature: session.signature }, ...extra }),
    }).catch(() => null);
    const body = r ? ((await r.json()) as { weight?: number; error?: string }) : { error: "the node did not answer" };
    if (!r?.ok) setMsg(body.error ?? "Could not save.");
    else setMsg(body.weight ? `Counted with ${short(body.weight)} $ZOOAGENCY. You can change your vote until the week closes.` : "Saved.");
    void load();
  };

  const total = Object.values(gene?.tally ?? {}).reduce((a, b) => a + b, 0);

  return (
    <Section className="!pt-4">
      <SectionHead
        eyebrow="The holders' gene · every week"
        title={["Pick the rule", "the next judge is born with."]}
        text="Every week the heron proposes three rules aimed at the nursery's latest mistakes. Holders vote with their balance; the winner becomes the mutation of the next creature born. The week's best human on this page names it."
      />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="liquid-glass rounded-3xl p-6">
          <div className="font-mono flex justify-between text-[10.5px] text-white/45">
            <span>this week's candidates</span>
            <span>{gene ? `${gene.voters} ${gene.voters === 1 ? "voter" : "voters"} · closes in ${left(gene.closesAt)}` : ""}</span>
          </div>
          {!gene?.candidates.length ? (
            <p className="mt-6 text-[13.5px] font-light text-white/55">The heron sets this week's three rules shortly. Come back in a little while.</p>
          ) : (
            <ol className="mt-3 flex flex-col gap-2">
              {gene.candidates.map((c) => {
                const share = total ? (gene.tally[c.id] ?? 0) / total : 0;
                const mine = gene.mine === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => void post("/v1/gene/vote", { pick: c.id })}
                      disabled={signing}
                      className={`relative w-full overflow-hidden rounded-2xl p-4 text-left ring-1 transition ${mine ? "ring-amber-200/60" : "ring-white/10 hover:ring-white/30"}`}
                    >
                      <span className="absolute inset-y-0 left-0 bg-white/[0.06]" style={{ width: `${Math.round(share * 100)}%` }} />
                      <span className="relative flex items-baseline justify-between gap-4">
                        <span className="text-[14px] font-light leading-relaxed text-white/85">{c.rule}</span>
                        <span className="font-mono shrink-0 text-[12px] text-white/50">{total ? `${Math.round(share * 100)}%` : "-"}</span>
                      </span>
                      {mine && <span className="font-mono relative mt-1 block text-[10.5px] text-amber-100/80">your vote</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {msg && <p className="mt-3 text-[13px] text-white/70">{msg}</p>}
          {!session && gene?.candidates.length ? (
            <p className="mt-3 text-[12.5px] font-light text-white/50">Tap a rule to sign in and vote. Holders of 500,000+ $ZOOAGENCY only.</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div className="liquid-glass rounded-3xl p-6">
            <p className="font-mono text-[10.5px] text-amber-100/70">waiting for the next birth</p>
            {gene?.pending ? (
              <p className="mt-2 text-[14px] font-light leading-relaxed text-white/80">{gene.pending.rule}</p>
            ) : (
              <p className="mt-2 text-[13.5px] font-light text-white/55">{gene?.lastWinner ? "Last week's gene is already in the nursery." : "The first holders' gene is chosen when this week's vote closes."}</p>
            )}
            {gene?.naming && (
              <p className="font-mono mt-3 text-[11px] text-white/50">
                {gene.naming.name ? `its name: ${gene.naming.name}` : "its name: waiting for last week's best human"}
              </p>
            )}
          </div>
          {gene?.naming?.you && !gene.naming.name && (
            <div className="liquid-glass rounded-3xl p-6">
              <p className="font-mono text-[10.5px] text-amber-100/70">you won the week</p>
              <p className="mt-2 text-[13.5px] font-light text-white/70">Name the nursery's next newborn. One word, starting with a capital.</p>
              <div className="mt-3 flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ember" maxLength={14} className="font-mono min-w-0 flex-1 rounded-full bg-black/40 px-4 py-2.5 text-[13px] outline-none ring-1 ring-white/10 focus:ring-white/30" />
                <button type="button" onClick={() => void post("/v1/gene/name", { name })} className="rounded-full bg-white px-5 py-2.5 text-[13px] font-medium text-black hover:bg-white/90">
                  Name it
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
