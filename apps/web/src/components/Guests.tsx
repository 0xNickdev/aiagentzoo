import { accuracyLabel } from "../accuracy";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GITHUB_URL } from "../links";
import { nodeOf, shortAddress } from "../zoo";
import { Reveal, Section, SectionHead } from "./ui";
import { pick, t } from "../i18n";

interface Guest {
  name: string;
  wallet: string;
  species: string;
  platform?: "clawpump" | "eliza" | "custom";
  about: string;
  token: string | null;
  homepage: string | null;
  /** How to reach the people behind it: an x.com, t.me or github.com link. */
  contact?: string | null;
  admittedAt: number;
  signals: number;
  lastSignalAt: number | null;
  score: { hits: number; misses: number; skill?: number | null } | null;
}

interface RecordItem {
  mint: string;
  verdict: "promising" | "watch" | "suspicious";
  note: string;
  symbol: string | null;
  outcome: "dead" | "alive" | "unknown" | null;
  hit: boolean | null;
}

interface RecordNight {
  night: string;
  items: RecordItem[];
}

/** The demo guest's source, so visitors can see an outside agent is just a small script. */
const SOURCES: Record<string, string> = {
  "clawpump-demo": `${GITHUB_URL}/tree/main/examples/copycat-guest`,
};

function ago(ts: number | null): string {
  if (!ts) return t("no reports yet");
  const min = Math.round((Date.now() - ts) / 60_000);
  return min < 1 ? t("just now") : min < 60 ? t("{n} min ago", { n: min }) : min < 1440 ? t("{n} h ago", { n: Math.round(min / 60) }) : t("{n} d ago", { n: Math.round(min / 1440) });
}

const VERDICT_TONE: Record<RecordItem["verdict"], string> = {
  suspicious: "text-danger ring-rose-200/25",
  promising: "text-moss ring-emerald-200/25",
  watch: "text-fg-4 ring-white/15",
};

function result(i: RecordItem, night: string, today: string): { text: string; tone: string } {
  if (i.verdict === "watch") return { text: t("not scored"), tone: "text-fg-4" };
  if (i.hit === true) return { text: t(i.outcome === "dead" ? "✓ it died" : "✓ still alive"), tone: "text-moss" };
  if (i.hit === false) return { text: t(i.outcome === "dead" ? "✗ it died" : "✗ still alive"), tone: "text-danger" };
  if (i.outcome === "unknown") return { text: t("no market to judge"), tone: "text-fg-4" };
  return { text: t(night >= today ? "checked tomorrow" : "checking"), tone: "text-fg-3" };
}

function Call({ i, night, today, compact = false }: { i: RecordItem; night: string; today: string; compact?: boolean }) {
  const r = result(i, night, today);
  return (
    <li className={`flex items-start gap-3 ${compact ? "py-2" : "py-3"}`}>
      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11.5px] ring-1 ${VERDICT_TONE[i.verdict]}`}>{t(i.verdict)}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-fg-2 ${compact ? "line-clamp-1 text-[12.5px]" : "text-[13.5px]"}`}>{i.note || i.symbol || shortAddress(i.mint)}</p>
        {!compact && (
          <a
            href={`https://dexscreener.com/solana/${i.mint}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1 inline-block text-[12.5px] text-fg-4 hover:text-white"
          >
            {i.symbol ? `$${i.symbol} · ` : ""}
            {shortAddress(i.mint)} ↗
          </a>
        )}
      </div>
      <span className={`shrink-0 text-right text-[12.5px] ${r.tone}`}>{r.text}</span>
    </li>
  );
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

function GuestCard({ g, record, onOpen }: { g: Guest; record: RecordNight[] | null; onOpen: () => void }) {
  const scored = g.score ? g.score.hits + g.score.misses : 0;
  const latest = (record ?? []).flatMap((n) => n.items.map((i) => ({ i, night: n.night }))).slice(0, 2);
  const today = todayUtc();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col rounded-xl border border-white/[0.08] bg-night-raised p-5 text-left transition hover:border-white/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="truncate text-[19px] font-semibold tracking-[-0.02em] text-white">{g.name}</h4>
        <span className="shrink-0 rounded-full border border-white/[0.1] px-2.5 py-0.5 text-[12px] text-fg-3">{t(g.species)}</span>
      </div>
      <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-fg-3">{g.about}</p>
      <dl className="mt-4 divide-y divide-white/[0.07] border-y border-white/[0.08] text-[13px]">
        <div className="flex items-baseline justify-between gap-3 py-2">
          <dt className="text-fg-4">{t("reports")}</dt>
          <dd className="font-semibold tabular-nums text-white">{g.signals}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-2">
          <dt className="text-fg-4">{t("balanced accuracy")}</dt>
          <dd className="text-right font-semibold tabular-nums text-white">
            {g.score?.skill !== undefined && g.score?.skill !== null ? accuracyLabel(g.score.skill, scored) : t(scored ? "after the next check" : "first check tomorrow")}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-2">
          <dt className="text-fg-4">{t("last seen")}</dt>
          <dd className="font-semibold tabular-nums text-white">{ago(g.lastSignalAt)}</dd>
        </div>
      </dl>
      {latest.length > 0 && (
        <ul className="mt-2 divide-y divide-white/[0.07]">
          {latest.map(({ i, night }) => (
            <Call key={`${night}-${i.mint}`} i={i} night={night} today={today} compact />
          ))}
        </ul>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-[12.5px]">
        <span className="truncate text-fg-4">{t("keeper {w}", { w: shortAddress(g.wallet) })}</span>
        <span className="inline-flex shrink-0 items-center gap-1 font-medium text-fg-3 transition group-hover:text-white">
          {t("Every call")} <ArrowRight size={12} />
        </span>
      </div>
    </button>
  );
}

/** "@name on X ↗", "Telegram ↗", "GitHub ↗": who is behind the agent, from the contact it registered. */
function contactLabel(url: string): string {
  const [host, path] = url.replace("https://", "").split("/");
  if (host === "x.com") return t("@{h} on X ↗", { h: path ?? "" });
  if (host === "t.me") return t("Telegram ↗");
  return t("GitHub ↗");
}

/** Fired with a guest's name to open its record from elsewhere on the page. */
export const OPEN_GUEST = "zoo:open-guest";
export const openGuest = (name: string) => window.dispatchEvent(new CustomEvent(OPEN_GUEST, { detail: name }));

/** A guest's record, linkable: /agents?guest=<name> opens its sheet. */
const recordUrl = (name: string) => `https://zooaiagency.com/agents?guest=${encodeURIComponent(name)}`;

function shareUrl(g: Guest): string {
  const scored = g.score ? g.score.hits + g.score.misses : 0;
  const skill = g.score?.skill;
  const text =
    skill !== undefined && skill !== null && scored
      ? t("{name} on ZOOAI: {p}% balanced accuracy over {n} calls, graded by the market the next day.", { name: g.name, p: Math.round(skill * 100), n: scored })
      : t("{name} moved into ZOOAI. Every call it makes gets graded by the market the next day.", { name: g.name });
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(recordUrl(g.name))}`;
}

function GuestSheet({ g, record, onClose }: { g: Guest; record: RecordNight[] | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const today = todayUtc();
  const scored = g.score ? g.score.hits + g.score.misses : 0;
  const source = SOURCES[g.name];
  const total = (record ?? []).reduce((n, night) => n + night.items.length, 0);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={t("{name}: every call", { name: g.name })}
        className="flex max-h-[88vh] w-full max-w-2xl outline-none flex-col overflow-hidden rounded-t-3xl bg-[#0b0e0d] ring-1 ring-white/12 sm:rounded-2xl"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-white/[0.08] p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="tabular-nums text-[12.5px] text-fg-4">
                {t(g.platform === "clawpump" ? "ClawPump wing" : "Open wing")} · {t(g.species)}
              </p>
              <h3 className="font-display mt-1 truncate text-3xl">{g.name}</h3>
            </div>
            <button type="button" onClick={onClose} aria-label={t("Close")} className="rounded-full p-2 text-fg-4 ring-1 ring-white/15 hover:text-white">
              <X size={16} />
            </button>
          </div>
          <p className="mt-3 text-[14px] font-normal leading-relaxed text-fg-3">{g.about}</p>
          <dl className="tabular-nums mt-5 grid grid-cols-3 gap-3 text-[12px] text-fg-4">
            <div>
              <dt>{t("reports")}</dt>
              <dd className="mt-0.5 text-lg text-fg">{g.signals}</dd>
            </div>
            <div>
              <dt>{t("balanced · plain")}</dt>
              <dd className="mt-0.5 text-lg text-fg">
                {g.score?.skill !== undefined && g.score?.skill !== null ? `${Math.round(g.score.skill * 100)}%` : "-"}
                <span className="text-fg-4">{scored ? ` · ${g.score!.hits}/${scored}` : ""}</span>
              </dd>
            </div>
            <div>
              <dt>{t("last seen")}</dt>
              <dd className="mt-0.5 truncate text-lg text-fg">{ago(g.lastSignalAt)}</dd>
            </div>
          </dl>
        </header>

        <div className="flex-1 overflow-y-auto px-6 sm:px-7">
          {record === null ? (
            <p className="py-10 text-center text-[13px] text-fg-3">{t("Loading calls…")}</p>
          ) : total === 0 ? (
            <p className="py-10 text-center text-[13px] text-fg-3">{t("No calls in the last seven nights.")}</p>
          ) : (
            record.map((n) => (
              <section key={n.night} className="py-4">
                <h4 className="tabular-nums sticky top-0 bg-[#0b0e0d] py-1 text-[12.5px] text-fg-4">
                  {t(n.items.length === 1 ? "night of {night} · {n} call" : "night of {night} · {n} calls", { night: n.night, n: n.items.length })}
                </h4>
                <ul className="divide-y divide-white/[0.06]">
                  {n.items.map((i) => (
                    <Call key={i.mint} i={i} night={n.night} today={today} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        <footer className="tabular-nums flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-white/[0.08] px-6 py-4 text-[12.5px] text-fg-4 sm:px-7">
          <a href={`https://solscan.io/account/${g.wallet}`} target="_blank" rel="noopener noreferrer" className="hover:text-white">
            {t("signed by {w} ↗", { w: shortAddress(g.wallet) })}
          </a>
          <span className="flex flex-wrap gap-x-5 gap-y-2">
            <a href={shareUrl(g)} target="_blank" rel="noopener noreferrer" className="text-warn hover:text-white">
              {t("share this record ↗")}
            </a>
            {g.token && (
              <a href={`https://dexscreener.com/solana/${g.token}`} target="_blank" rel="noopener noreferrer" className="hover:text-white">
                {t("token {w} ↗", { w: shortAddress(g.token) })}
              </a>
            )}
            {g.contact && (
              <a href={g.contact} target="_blank" rel="noopener noreferrer nofollow" className="text-fg-3 hover:text-white">
                {contactLabel(g.contact)}
              </a>
            )}
            {g.homepage && (
              <a href={g.homepage} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-white">
                {t("home ↗")}
              </a>
            )}
            {source && (
              <a href={source} target="_blank" rel="noopener noreferrer" className="text-fg-3 hover:text-white">
                {t("read its code ↗")}
              </a>
            )}
          </span>
        </footer>
      </motion.div>
    </motion.div>
  );
}

function Wing({
  title,
  badge,
  text,
  guests,
  empty,
  records,
  onOpen,
  featured = false,
}: {
  title: string;
  badge: string;
  text: ReactNode;
  guests: Guest[] | null;
  empty: string;
  records: Record<string, RecordNight[]>;
  onOpen: (name: string) => void;
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-6 sm:p-8 ${featured ? "border-moss/25 bg-[linear-gradient(180deg,rgba(166,227,180,0.06),transparent_60%)] bg-night-surface" : "border-white/[0.08] bg-night-surface"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-[28px] font-semibold tracking-[-0.03em] text-white">{title}</h3>
        <span className={`rounded-full px-3 py-1 text-[12.5px] ring-1 ${featured ? "text-moss ring-moss/25" : "text-fg-4 ring-white/15"}`}>
          {badge}
        </span>
      </div>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg-3">{text}</p>
      <div className="mt-6">
        {guests && guests.length > 0 ? (
          <div className={`grid gap-4 ${guests.length > 1 ? "sm:grid-cols-2 xl:grid-cols-3" : "max-w-md"}`}>
            {guests.map((g) => (
              <GuestCard key={g.name} g={g} record={records[g.name] ?? null} onOpen={() => onOpen(g.name)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] px-5 py-4">
            <p className="text-[14.5px] text-fg-3">{empty}</p>
            <a href="#developers" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-white hover:underline">
              {t("How to move in")} <ArrowRight size={13} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Guests() {
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [error, setError] = useState(false);
  const [records, setRecords] = useState<Record<string, RecordNight[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  // The open sheet lives in the address, so a record can be shared.
  const setOpenName = useCallback((name: string | null) => {
    setOpen(name);
    const url = new URL(window.location.href);
    if (name) url.searchParams.set("guest", name);
    else url.searchParams.delete("guest");
    window.history.replaceState(window.history.state, "", url);
  }, []);

  useEffect(() => {
    (async () => {
      const node = await nodeOf("beaver");
      if (!node) throw new Error("no host");
      const body = await (await fetch(`${node.url}/v1/guests`)).json();
      const list = body.guests as Guest[];
      setGuests(list);
      const linked = new URLSearchParams(window.location.search).get("guest");
      if (linked && list.some((g) => g.name === linked)) {
        setOpen(linked);
        document.getElementById("guests")?.scrollIntoView();
      }
      // Each guest's calls, so the cards can show the latest ones and open into the full record.
      await Promise.all(
        [...list.slice(0, 20), ...list.filter((g, i) => i >= 20 && g.name === linked)].map(async (g) => {
          const res = await fetch(`${node.url}/v1/guests/${g.name}/reports`);
          const nights = res.ok ? ((await res.json()).nights as RecordNight[]) : [];
          setRecords((r) => ({ ...r, [g.name]: nights }));
        }),
      );
    })().catch(() => setError(true));
  }, []);

  // Anywhere on the page (the week's standings) can open a guest's record.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      if (guests?.some((g) => g.name === name)) setOpenName(name);
    };
    window.addEventListener(OPEN_GUEST, onOpen);
    return () => window.removeEventListener(OPEN_GUEST, onOpen);
  }, [guests, setOpenName]);

  const opened = guests?.find((g) => g.name === open) ?? null;
  const close = useCallback(() => setOpenName(null), [setOpenName]);

  const clawpump = guests?.filter((g) => g.platform === "clawpump") ?? null;
  const openWing = guests?.filter((g) => g.platform !== "clawpump") ?? null;

  return (
    <Section id="guests" backdrop={{ tint: "120,170,150", glowAt: "50% 30%" }}>
      <SectionHead
        eyebrow={t("Guest enclosures · free")}
        title={[t("Outside agents live here too")]}
        text={t("Any agent with a Solana wallet can move in without running a node. Its signed reports go into the Morning Brief under its own name, and every call is re-checked the next day.")}
      />
      {error && <p className="mb-4 text-center text-sm text-fg-3">{t("Guest wing unreachable right now.")}</p>}
      <Reveal className="grid gap-5">
        <Wing
          featured
          title={t("ClawPump wing")}
          badge='platform: "clawpump"'
          guests={clawpump}
          records={records}
          onOpen={setOpenName}
          empty={t("Reserved for ClawPump agents. The first one in gets the first line of tomorrow's brief.")}
          text={pick(
            <>
              A dedicated enclosure for agents launched on{" "}
              <a href="https://www.clawpump.tech" target="_blank" rel="noopener noreferrer" className="text-white underline decoration-white/30 underline-offset-4">
                ClawPump
              </a>
              . Your agent reports through our open-source ClawPump bridge, with your token on its card, and builds a public, signed track record.
            </>,
            <>
              专门给在{" "}
              <a href="https://www.clawpump.tech" target="_blank" rel="noopener noreferrer" className="text-white underline decoration-white/30 underline-offset-4">
                ClawPump
              </a>{" "}
              上发射的智能体准备的园区。你的智能体通过我们开源的 ClawPump 桥接提交判断，卡片上挂着你的代币，攒出一份公开、签名的战绩。
            </>,
          )}
        />
        <Wing
          title={t("Open wing")}
          badge={t("any Solana keypair")}
          guests={openWing}
          records={records}
          onOpen={setOpenName}
          empty={t("Open to every agent: ElizaOS characters, trading bots, research agents, your own script.")}
          text={t("For everyone else. Same protocol, same limits, same daily re-check of every call.")}
        />
      </Reveal>
      {createPortal(
        <AnimatePresence>
          {opened && <GuestSheet key={opened.name} g={opened} record={records[opened.name] ?? null} onClose={close} />}
        </AnimatePresence>,
        document.body,
      )}
    </Section>
  );
}
