import { useEffect, useState } from "react";
import { chainOf } from "../../chain";
import { t } from "../../i18n";
import { NODE_URLS } from "../../sim/live";
import { useGuardian } from "../../zoo";
import { Kv, Pn, type Ctx } from "./ui";

/** What the marsh node read about a token's links (apps/node/src/claims/claims.ts). */
interface Claims {
  website: string | null;
  metadataRead: boolean;
  github: {
    status: "none" | "unread" | "broken" | "oneway" | "related" | "mutual";
    url?: string;
    repo?: string;
    foundIn?: "metadata" | "dexscreener" | "website";
    createdAt?: number;
    pushedAt?: number;
    commits?: number;
    days?: number[];
    activity?: "shipping" | "active" | "quiet" | "dormant";
    lastCommitAt?: number;
    stars?: number;
    language?: string | null;
    flags: string[];
  };
  account?: { status: "none" | "unread" | "mutual" | "related" | "oneway"; handle?: string; followers?: number; joinedAt?: number; was?: string[]; flags: string[] };
  telegram?: { status: "none" | "unread" | "broken" | "group" | "channel"; name?: string; members?: number; tie?: "mutual" | "related" | "oneway"; posts?: number; since?: number; contracts?: number; under?: number; lineUsd?: number; flags: string[] };
  dex: { paid: boolean | null; paidAt?: number; takeover?: boolean; pending?: boolean; boosts?: number };
}

const MARSH = NODE_URLS.find((u) => u.includes("marsh")) ?? "";

type State = Claims | "reading" | "down";

function useClaims(mint: string): State {
  const [c, setC] = useState<State>("reading");
  useEffect(() => {
    setC("reading");
    if (!MARSH || chainOf(mint) !== "solana") {
      setC("down");
      return;
    }
    let gone = false;
    fetch(`${MARSH}/v1/claims/${mint}`, { signal: AbortSignal.timeout(20_000) })
      .then((r) => (r.ok ? (r.json() as Promise<Claims>) : null))
      .then((v) => !gone && setC(v ?? "down"))
      .catch(() => !gone && setC("down"));
    return () => {
      gone = true;
    };
  }, [mint]);
  return c;
}

/** The holders' code check (apps/node/src/claims/build.ts): the repository read against what the token claims. */
interface Build {
  repo: string;
  sha: string;
  filesRead: string[];
  filesTotal: number;
  facts: { ai: string[]; solana: string[]; ownCodeBytes: number; template: string[] };
  claims: Array<{ claim: string; status: "matches" | "partly" | "not found" | "contradicts"; evidence: Array<{ path: string; why: string }> }>;
  summary: string;
  score: { total: number; claims: number; substance: number; activity: number; ties: number };
}
type BuildState = null | "signing" | "reading" | Build | { error: string };

const STATUS_WORD: Record<Build["claims"][number]["status"], string> = { matches: "matches", partly: "partly", "not found": "not found in the files we read", contradicts: "contradicts" };

function BuildCheck({ mint }: { mint: string }) {
  const { session, signIn } = useGuardian();
  const [b, setB] = useState<BuildState>(null);
  const [want, setWant] = useState(false);
  useEffect(() => setB(null), [mint]);
  useEffect(() => {
    if (!want || !session) return;
    setWant(false);
    setB("reading");
    fetch(`${MARSH}/v1/claims/${mint}/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guardian: session }), signal: AbortSignal.timeout(120_000) })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as (Build & { error?: string }) | null;
        setB(r.ok && j && !j.error ? j : { error: j?.error ?? "the check failed, try again later" });
      })
      .catch(() => setB({ error: "the check did not answer, try again later" }));
  }, [want, session, mint]);
  const start = () => {
    setWant(true);
    if (!session) {
      setB("signing");
      void signIn().finally(() => setB((v) => (v === "signing" ? null : v)));
    }
  };
  if (b === null || b === "signing") {
    return (
      <div className="x-bc">
        <button type="button" className="x-btn" onClick={start} disabled={b === "signing"}>
          {t("Check the code against the claims")}
          <small>{t("holders")}</small>
        </button>
      </div>
    );
  }
  if (b === "reading") return <p className="x-fine x-bc">{t("Reading the repository and comparing it with what the token claims. This takes up to a minute.")}</p>;
  if ("error" in b) {
    return (
      <div className="x-bc">
        <p className="x-fine">{t(b.error)}</p>
        <button type="button" className="x-btn" onClick={() => setB(null)}>{t("Back")}</button>
      </div>
    );
  }
  const at = (path: string) => `https://github.com/${b.repo}/blob/${b.sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const parts: Array<[string, number, number]> = [
    [t("claims match"), b.score.claims, 40],
    [t("code substance"), b.score.substance, 25],
    [t("activity"), b.score.activity, 20],
    [t("ties to the token"), b.score.ties, 15],
  ];
  return (
    <div className="x-bc x-bcr">
      <div className="x-bcs">
        <strong>{b.score.total}<small>/100</small></strong>
        <ul>
          {parts.map(([k, v, max]) => (
            <li key={k}><span>{k}</span><b>{v}/{max}</b></li>
          ))}
        </ul>
      </div>
      <ul className="x-bcl">
        {b.claims.map((c) => (
          <li key={c.claim}>
            <div><span>{c.claim}</span><b className={c.status === "contradicts" ? "x-d" : ""}>{t(STATUS_WORD[c.status])}</b></div>
            {c.evidence.map((e) => (
              <p key={e.path}><a className="x-link" href={at(e.path)} target="_blank" rel="noopener noreferrer nofollow">{e.path}</a>{e.why ? ` - ${e.why}` : ""}</p>
            ))}
          </li>
        ))}
      </ul>
      {b.summary && <p className="x-bcm">{b.summary}</p>}
      {b.facts.template.length > 0 && <p className="x-fine">{b.facts.template.map((x) => t(x)).join(", ")}</p>}
      <p className="x-fine">{t("Read {n} files of {m} at commit {c}; an AI read them, it can be wrong.", { n: b.filesRead.length, m: b.filesTotal, c: b.sha.slice(0, 7) })}</p>
    </div>
  );
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const after = (from: number, to: number) => {
  const min = Math.round((to - from) / 60_000);
  return min < 120 ? t("{n} min after launch", { n: min }) : min < 2_880 ? t("{n} h after launch", { n: Math.round(min / 60) }) : t("{n} days after launch", { n: Math.round(min / 1_440) });
};

/** The server's point about a repository, in the reader's language. */
function flagText(s: string): string {
  const num = /^only (\d+) commits?$/.exec(s);
  if (num) return t("only {n} commits", { n: num[1]! });
  const made = /^created (\d+) (h|days) ago$/.exec(s);
  if (made) return made[2] === "h" ? t("created {n} h ago", { n: made[1]! }) : t("created {n} days ago", { n: made[1]! });
  const old = /^the GitHub account is (\d+) (h|days) old$/.exec(s);
  if (old) return old[2] === "h" ? t("the GitHub account is {n} h old", { n: old[1]! }) : t("the GitHub account is {n} days old", { n: old[1]! });
  const idle = /^no push in (\d+) months$/.exec(s);
  if (idle) return t("no push in {n} months", { n: idle[1]! });
  const xage = /^the X account is (\d+) (h|days) old$/.exec(s);
  if (xage) return xage[2] === "h" ? t("the X account is {n} h old", { n: xage[1]! }) : t("the X account is {n} days old", { n: xage[1]! });
  const fork = /^it is a fork of (.+)$/.exec(s);
  if (fork && fork[1] !== "another project") return t("it is a fork of {r}", { r: fork[1]! });
  return t(s);
}

const ACT: Record<NonNullable<Claims["github"]["activity"]>, [string, "d" | "up" | "w" | ""]> = {
  shipping: ["shipping", "up"],
  active: ["active", ""],
  quiet: ["quiet", "w"],
  dormant: ["dormant", "d"],
};

const ago = (ms: number) => {
  const h = (Date.now() - ms) / 3_600_000;
  return h < 1 ? t("within the hour") : h < 48 ? t("{n} h ago", { n: Math.round(h) }) : t("{n} days ago", { n: Math.round(h / 24) });
};

/** Thirty days of commits, a square a day, today on the right; the token's launch day is marked under its square. */
function Strip({ days, launch }: { days: number[]; launch: number }) {
  const top = Math.max(1, ...days);
  const total = days.reduce((a, b) => a + b, 0);
  const li = 29 - Math.floor((Date.now() - launch) / 86_400_000);
  return (
    <figure className="x-gh" aria-label={t("{n} commits in the last 30 days", { n: total })}>
      <div>
        {days.map((n, i) => (
          <i key={i} title={`${day(Date.now() - (29 - i) * 86_400_000)}: ${n}`} style={n ? { opacity: 0.35 + (0.65 * n) / top } : undefined} className={n ? "on" : ""}>
            {i === li && <s />}
          </i>
        ))}
      </div>
      <figcaption>
        <span>{t("30 days ago")}</span>
        <span>{t("today")}</span>
      </figcaption>
      <p>{total ? t("{n} commits in the last 30 days", { n: total }) : t("no commits in the last 30 days")}{li >= 0 && li < 30 ? t(", red dot: launch day") : ""}</p>
    </figure>
  );
}

const WORD: Record<Claims["github"]["status"], [string, "d" | "up" | "w" | ""]> = {
  mutual: ["names this token back", "up"],
  related: ["matches its links, but never names this token", "w"],
  oneway: ["does not mention this token", "d"],
  broken: ["the link leads nowhere", "d"],
  unread: ["GitHub did not answer, try again in a few minutes", ""],
  none: ["no link found", ""],
};

/** The GitHub a token links to, checked both ways, and whether its DexScreener profile was paid for. */
export function ClaimsPanel({ r, span = "x-s4" }: Pick<Ctx, "r"> & { span?: string }) {
  const c = useClaims(r.mint);
  if (c === "down") {
    return chainOf(r.mint) === "solana" && MARSH ? (
      <Pn span={span} title={t("Links, checked")}>
        <p className="x-fine">{t("The link reader did not answer. Reload in a minute.")}</p>
      </Pn>
    ) : null;
  }
  if (c === "reading") {
    return (
      <Pn span={span} title={t("Links, checked")} meta={t("reading")}>
        <p className="x-fine">{t("Opening what the token links to.")}</p>
      </Pn>
    );
  }
  const g = c.github;
    const d = c.dex;
  const [word, tone] = g.status === "none" && !c.metadataRead ? (["the token's metadata could not be read", ""] as const) : WORD[g.status];
  const from = g.foundIn === "metadata" ? t("in the token's metadata") : g.foundIn === "dexscreener" ? t("on its DexScreener page") : t("on its website");
  const a = c.account;
  const tg = c.telegram;
  const x: [string, "d" | "up" | "w" | ""] = !a || a.status === "none" ? ["no link found", ""] : a.status === "unread" ? ["X did not answer", ""] : a.status === "oneway" ? ["its bio does not name this token", "w"] : WORD[a.status];
  const tgWord: [string, "d" | "up" | "w" | ""] = !tg || tg.status === "none" ? ["no link found", ""] : tg.status === "unread" ? ["Telegram did not answer", ""] : tg.status === "broken" ? ["no public channel or group at that link", ""] : tg.status === "group" ? ["a group, its posts are not public", ""] : tg.tie === "mutual" || tg.tie === "related" ? WORD[tg.tie] : ["does not name it in the posts we read", "w"];
  const num = (n: number) => n.toLocaleString("en-US");
  const paid = d.paid === null ? t("DexScreener did not answer") : d.paid ? (d.paidAt && d.paidAt >= r.createdAt ? t("paid, {t}", { t: after(r.createdAt, d.paidAt) }) : t("paid")) : d.pending ? t("payment in review") : t("not paid");
  const fl = (list: string[]) =>
    list.length > 0 && (
      <ul className="x-lnf">
        {list.slice(0, 4).map((f) => (
          <li key={f}>{flagText(f)}</li>
        ))}
      </ul>
    );
  const act = g.activity ? ACT[g.activity] : null;
  const since = g.lastCommitAt ?? g.pushedAt;
  return (
    <Pn span={span} title={t("Links, checked")} meta={t("what it links to, checked")}>
      <div className="x-links">
        <section>
          <h4>GitHub<b className={tone ? `x-${tone}` : ""}>{t(word)}</b></h4>
          {g.days && <Strip days={g.days} launch={r.createdAt} />}
          <Kv
            flush
            rows={[
              act ? [t("Activity"), since ? t("{a}, last commit {d}", { a: t(act[0]), d: ago(since) }) : t(act[0]), act[1]] : null,
              g.repo || g.url ? [t("Repository"), <a key="r" className="x-link" href={g.repo ? `https://github.com/${g.repo}` : g.url} target="_blank" rel="noopener noreferrer nofollow">{g.repo ?? g.url!.replace("https://github.com/", "")} ↗</a>] : null,
              g.url && g.foundIn ? [t("Link found"), from] : null,
              g.commits !== undefined ? [t("Commits"), g.commits.toLocaleString("en-US")] : null,
              g.createdAt ? [t("Repository created"), day(g.createdAt)] : null,
              g.language ? [t("Main language"), g.language] : null,
            ]}
          />
          {fl(g.flags)}
        </section>
        <section>
          <h4>X<b className={x[1] ? `x-${x[1]}` : ""}>{t(x[0])}</b></h4>
          <Kv
            flush
            rows={[
              a?.handle ? [t("X account"), <a key="x" className="x-link" href={`https://x.com/${a.handle}`} target="_blank" rel="noopener noreferrer nofollow">@{a.handle} ↗</a>] : null,
              a?.followers !== undefined ? [t("Followers"), num(a.followers)] : null,
              a?.joinedAt ? [t("On X since"), day(a.joinedAt)] : null,
              a?.was?.length ? [t("Handle before"), a.was.map((h) => `@${h}`).join(", "), "w"] : null,
            ]}
          />
          {fl((a?.flags ?? []).filter((f) => !f.includes(" before")))}
        </section>
        <section>
          <h4>Telegram<b className={tgWord[1] ? `x-${tgWord[1]}` : ""}>{t(tgWord[0])}</b></h4>
          <Kv
            flush
            rows={[
              tg?.name ? [t("Telegram link"), <a key="t" className="x-link" href={`https://t.me/${tg.name}`} target="_blank" rel="noopener noreferrer nofollow">t.me/{tg.name} ↗</a>] : null,
              tg?.members !== undefined ? [t("Members"), num(tg.members)] : null,
              tg?.posts ? [t("Posts read"), tg.since ? t("{n}, back to {d}", { n: tg.posts, d: day(tg.since) }) : num(tg.posts)] : null,
              tg?.contracts ? [t("Other contracts posted"), tg.under !== undefined && tg.lineUsd ? t("{n}, {u} under {l} or not trading", { n: tg.contracts, u: tg.under, l: `$${num(tg.lineUsd)}` }) : num(tg.contracts), tg.contracts >= 3 && (tg.under ?? 0) / tg.contracts >= 0.8 ? "d" : ""] : null,
            ]}
          />
          {fl(tg?.flags ?? [])}
          <h4 className="x-lnh2">{t("DexScreener profile")}<b>{paid}</b></h4>
          <Kv
            flush
            rows={[d.takeover ? [t("Community takeover"), t("approved")] : null, d.boosts ? [t("DexScreener boosts"), d.boosts] : null]}
          />
        </section>
      </div>
      {g.repo && (g.status === "mutual" || g.status === "related" || g.status === "oneway") && <BuildCheck mint={r.mint} />}
      <p className="x-fine" style={{ marginTop: 14 }}>{t("Anyone can link any account: it counts as the token's only when it names the contract back. A paid profile is an ad, not a check.")}</p>
    </Pn>
  );
}
