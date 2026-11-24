import { useEffect, useState } from "react";
import { chainOf } from "../../chain";
import { t } from "../../i18n";
import { NODE_URLS } from "../../sim/live";
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
    stars?: number;
    language?: string | null;
    flags: string[];
  };
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
  const fork = /^it is a fork of (.+)$/.exec(s);
  if (fork && fork[1] !== "another project") return t("it is a fork of {r}", { r: fork[1]! });
  return t(s);
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
      <Pn span={span} title={t("GitHub and DexScreener")}>
        <p className="x-fine">{t("The link reader did not answer. Reload in a minute.")}</p>
      </Pn>
    ) : null;
  }
  if (c === "reading") {
    return (
      <Pn span={span} title={t("GitHub and DexScreener")} meta={t("reading")}>
        <p className="x-fine">{t("Opening what the token links to.")}</p>
      </Pn>
    );
  }
  const g = c.github;
  const d = c.dex;
  const [word, tone] = g.status === "none" && !c.metadataRead ? (["the token's metadata could not be read", ""] as const) : WORD[g.status];
  const from = g.foundIn === "metadata" ? t("in the token's metadata") : g.foundIn === "dexscreener" ? t("on its DexScreener page") : t("on its website");
  const paid = d.paid === null ? t("DexScreener did not answer") : d.paid ? (d.paidAt && d.paidAt >= r.createdAt ? t("paid, {t}", { t: after(r.createdAt, d.paidAt) }) : t("paid")) : d.pending ? t("payment in review") : t("not paid");
  return (
    <Pn span={span} title={t("GitHub and DexScreener")} meta={t("what it links to, checked")} className={span === "x-s12" ? "x-two" : ""}>
      <Kv
        flush
        rows={[
          ["GitHub", t(word), tone],
          g.repo || g.url ? [t("Repository"), <a key="r" className="x-link" href={g.repo ? `https://github.com/${g.repo}` : g.url} target="_blank" rel="noopener noreferrer nofollow">{g.repo ?? g.url!.replace("https://github.com/", "")} ↗</a>] : null,
          g.url && g.foundIn ? [t("Link found"), from] : null,
          g.commits !== undefined ? [t("Commits"), g.commits.toLocaleString("en-US")] : null,
          g.createdAt ? [t("Repository created"), day(g.createdAt)] : null,
          g.pushedAt ? [t("Last push"), day(g.pushedAt)] : null,
          g.language ? [t("Main language"), g.language] : null,
          [t("DexScreener profile"), paid],
          d.takeover ? [t("Community takeover"), t("approved")] : null,
          d.boosts ? [t("DexScreener boosts"), d.boosts] : null,
        ]}
      />
      {g.flags.length > 0 && (
        <ul className="x-fine" style={{ display: "grid", gap: 4, marginTop: 10 }}>
          {g.flags.slice(0, 4).map((f) => (
            <li key={f}>{flagText(f)}</li>
          ))}
        </ul>
      )}
      <p className="x-fine" style={{ marginTop: 10 }}>{t("A paid profile is an ad, not a check. A repository that names the token shows whose it is, not that the code works.")}</p>
    </Pn>
  );
}
