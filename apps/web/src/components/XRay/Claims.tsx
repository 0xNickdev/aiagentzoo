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
  // The rename and the contract count have rows of their own.
  const points = [...g.flags, ...(c.account?.flags ?? []).filter((f) => !f.includes(" before"))];
  const d = c.dex;
  const [word, tone] = g.status === "none" && !c.metadataRead ? (["the token's metadata could not be read", ""] as const) : WORD[g.status];
  const from = g.foundIn === "metadata" ? t("in the token's metadata") : g.foundIn === "dexscreener" ? t("on its DexScreener page") : t("on its website");
  const a = c.account;
  const tg = c.telegram;
  const x: [string, "d" | "up" | "w" | ""] = !a || a.status === "none" ? ["no link found", ""] : a.status === "unread" ? ["X did not answer", ""] : a.status === "oneway" ? ["its bio does not name this token", "w"] : WORD[a.status];
  const tgWord: [string, "d" | "up" | "w" | ""] = !tg || tg.status === "none" ? ["no link found", ""] : tg.status === "unread" ? ["Telegram did not answer", ""] : tg.status === "broken" ? ["no public channel or group at that link", ""] : tg.status === "group" ? ["a group, its posts are not public", ""] : tg.tie === "mutual" || tg.tie === "related" ? WORD[tg.tie] : ["does not name it in the posts we read", "w"];
  const num = (n: number) => n.toLocaleString("en-US");
  const paid = d.paid === null ? t("DexScreener did not answer") : d.paid ? (d.paidAt && d.paidAt >= r.createdAt ? t("paid, {t}", { t: after(r.createdAt, d.paidAt) }) : t("paid")) : d.pending ? t("payment in review") : t("not paid");
  return (
    <Pn span={span} title={t("Links, checked")} meta={t("what it links to, checked")} className={span === "x-s12" ? "x-two" : ""}>
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
          ["X", t(x[0]), x[1]],
          a?.handle ? [t("X account"), <a key="x" className="x-link" href={`https://x.com/${a.handle}`} target="_blank" rel="noopener noreferrer nofollow">@{a.handle} ↗</a>] : null,
          a?.followers !== undefined ? [t("Followers"), num(a.followers)] : null,
          a?.joinedAt ? [t("On X since"), day(a.joinedAt)] : null,
          a?.was?.length ? [t("Handle before"), a.was.map((h) => `@${h}`).join(", "), "w"] : null,
          ["Telegram", t(tgWord[0]), tgWord[1]],
          tg?.name ? [t("Telegram link"), <a key="t" className="x-link" href={`https://t.me/${tg.name}`} target="_blank" rel="noopener noreferrer nofollow">t.me/{tg.name} ↗</a>] : null,
          tg?.members !== undefined ? [t("Members"), num(tg.members)] : null,
          tg?.posts ? [t("Posts read"), tg.since ? t("{n}, back to {d}", { n: tg.posts, d: day(tg.since) }) : num(tg.posts)] : null,
          tg?.contracts ? [t("Other contracts posted"), tg.under !== undefined && tg.lineUsd ? t("{n}, {u} under {l} or not trading", { n: tg.contracts, u: tg.under, l: `$${num(tg.lineUsd)}` }) : num(tg.contracts), tg.contracts >= 3 && (tg.under ?? 0) / tg.contracts >= 0.8 ? "d" : ""] : null,
          [t("DexScreener profile"), paid],
          d.takeover ? [t("Community takeover"), t("approved")] : null,
          d.boosts ? [t("DexScreener boosts"), d.boosts] : null,
        ]}
      />
      {points.length > 0 && (
        <ul className="x-fine" style={{ display: "grid", gap: 4, marginTop: 10 }}>
          {points.slice(0, 5).map((f) => (
            <li key={f}>{flagText(f)}</li>
          ))}
        </ul>
      )}
      <p className="x-fine" style={{ marginTop: 10 }}>{t("Anyone can link any account: it counts as the token's only when it names the contract back. A paid profile is an ad, not a check.")}</p>
    </Pn>
  );
}
