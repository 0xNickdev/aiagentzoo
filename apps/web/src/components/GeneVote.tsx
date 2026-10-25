import { useCallback, useEffect, useState } from "react";
import { nodeOf, useGuardian } from "../zoo";
import { Section, SectionHead } from "./ui";
import { t } from "../i18n";

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
    const body = r ? ((await r.json()) as { weight?: number; error?: string }) : { error: t("the node did not answer") };
    if (!r?.ok) setMsg(body.error ?? t("Could not save."));
    else setMsg(body.weight ? t("Counted with {w} $ZOOAGENCY. You can change your vote until the week closes.", { w: short(body.weight) }) : t("Saved."));
    void load();
  };

  const total = Object.values(gene?.tally ?? {}).reduce((a, b) => a + b, 0);

  return (
    <Section className="!pt-4">
      <SectionHead
        eyebrow={t("The holders' gene · every week")}
        title={[t("Pick the rule"), t("the next judge is born with.")]}
        text={t("Every week the heron proposes three rules aimed at the nursery's latest mistakes. Holders vote with their balance; the winner becomes the mutation of the next creature born. The week's best human on this page names it.")}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-6">
          <div className="tabular-nums flex justify-between text-[12px] text-fg-3">
            <span>{t("this week's candidates")}</span>
            <span>{gene ? t(gene.voters === 1 ? "{n} voter · closes in {left}" : "{n} voters · closes in {left}", { n: gene.voters, left: left(gene.closesAt) }) : ""}</span>
          </div>
          {!gene?.candidates.length ? (
            <p className="mt-6 text-[13.5px] font-normal text-fg-4">{t("The heron sets this week's three rules shortly. Come back in a little while.")}</p>
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
                        <span className="text-[14px] font-normal leading-relaxed text-fg-2">{c.rule}</span>
                        <span className="tabular-nums shrink-0 text-[12px] text-fg-3">{total ? `${Math.round(share * 100)}%` : "-"}</span>
                      </span>
                      {mine && <span className="tabular-nums relative mt-1 block text-[12px] text-warn">{t("your vote")}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {msg && <p className="mt-3 text-[13px] text-fg-3">{msg}</p>}
          {!session && gene?.candidates.length ? (
            <p className="mt-3 text-[12.5px] font-normal text-fg-3">{t("Tap a rule to sign in and vote. Holders of 500,000+ $ZOOAGENCY only.")}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-6">
            <p className="tabular-nums text-[12px] text-warn">{t("waiting for the next birth")}</p>
            {gene?.pending ? (
              <p className="mt-2 text-[14px] font-normal leading-relaxed text-fg-2">{gene.pending.rule}</p>
            ) : (
              <p className="mt-2 text-[13.5px] font-normal text-fg-4">{t(gene?.lastWinner ? "Last week's gene is already in the nursery." : "The first holders' gene is chosen when this week's vote closes.")}</p>
            )}
            {gene?.naming && (
              <p className="tabular-nums mt-3 text-[12.5px] text-fg-3">
                {gene.naming.name ? t("its name: {n}", { n: gene.naming.name }) : t("its name: waiting for last week's best human")}
              </p>
            )}
          </div>
          {gene?.naming?.you && !gene.naming.name && (
            <div className="bg-night-surface border border-white/[0.08] rounded-2xl p-6">
              <p className="tabular-nums text-[12px] text-warn">{t("you won the week")}</p>
              <p className="mt-2 text-[13.5px] font-normal text-fg-3">{t("Name the nursery's next newborn. One word, starting with a capital.")}</p>
              <div className="mt-3 flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ember" maxLength={14} className="tabular-nums min-w-0 flex-1 rounded-full bg-black/40 px-4 py-2.5 text-[13px] outline-none ring-1 ring-white/10 focus:ring-white/30" />
                <button type="button" onClick={() => void post("/v1/gene/name", { name })} className="rounded-full bg-white px-5 py-2.5 text-[13px] font-medium text-black hover:bg-white/90">
                  {t("Name it")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
