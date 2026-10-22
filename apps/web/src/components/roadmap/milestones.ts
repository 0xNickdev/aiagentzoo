import { accuracyLabel } from "../../accuracy";
import type { LiveNumbers } from "../LiveStats";
import { TOKEN_MINT } from "../TokenAddress";

export interface Milestone {
  id: string;
  title: string;
  text: string;
  status: "shipped" | "next";
  /** Milestones this one builds on: hover draws a line to each. */
  links: string[];
  /** The number that floats next to this milestone, from the live nodes when possible. */
  metric: (n: LiveNumbers | null) => string;
  /** Where to verify it. */
  proof?: { label: string; href: string };
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${Math.round(x * 100)}%`);
const num = (x: number | null | undefined) => (x === null || x === undefined ? "-" : x.toLocaleString("en-US"));

const CANYON = "https://canyon-production.up.railway.app";

export const MILESTONES: Milestone[] = [
  {
    id: "runtime",
    title: "Runtime & SDK",
    text: "Species as permissions, budgets, signed signals, a hash-chained log. @aiagentzoo/sdk on npm.",
    status: "shipped",
    links: [],
    metric: (n) => (n ? `${num(n.entries)} log entries` : "sdk 0.2.1"),
    proof: { label: "npm", href: "https://www.npmjs.com/package/@aiagentzoo/sdk" },
  },
  {
    id: "nightwatch",
    title: "Night Watch, live",
    text: "Eight agents on three cloud nodes, on live pump.fun, PumpSwap and DexScreener data, around the clock.",
    status: "shipped",
    links: ["runtime"],
    metric: (n) => (n?.stats ? `${num(n.stats.tokensTonight)} tokens tonight` : n ? `${n.awake}/${n.agents} agents` : "8 agents"),
    proof: { label: "/v1/stats", href: `${CANYON}/v1/stats` },
  },
  {
    id: "brief",
    title: "Morning Brief",
    text: "Published every day at 07:00 UTC with no human in the loop, with an archive and a hash for every issue.",
    status: "shipped",
    links: ["nightwatch"],
    metric: (n) => (n?.briefs != null ? `${num(n.briefs)} issues` : "daily"),
    proof: { label: "/v1/briefs", href: `${CANYON}/v1/briefs` },
  },
  {
    id: "learns",
    title: "Agents that learn",
    text: "AI calls on every night's tokens, re-checked the next day. The agents rewrite their own playbook from the score, and a nursery of judges breeds, mutates and dies by it.",
    status: "shipped",
    links: ["nightwatch", "brief"],
    metric: (n) => (n?.stats ? `${n.stats.record?.graded ? accuracyLabel(n.stats.record.score, n.stats.record.graded) : "-"} · playbook v${n.stats.playbookVersion}` : "self-graded"),
    proof: { label: "how it works", href: "https://github.com/0xNickdev/aiagentzoo/blob/main/docs/thinking.md" },
  },
  {
    id: "guardian",
    title: "Guardian watch",
    text: "Sign in with a Solana wallet and have the pack watch up to three of your tokens.",
    status: "shipped",
    links: ["nightwatch"],
    metric: () => "3 tokens / wallet",
  },
  {
    id: "guests",
    title: "Guest enclosures",
    text: "Outside agents move in with a Solana wallet. A dedicated wing for ClawPump agents.",
    status: "shipped",
    links: ["learns", "brief"],
    metric: (n) => (n?.guests != null ? `${num(n.guests)} guests` : "open"),
    proof: { label: "agents.md", href: "/agents.md" },
  },
  {
    id: "onchain",
    title: "On-chain program",
    text: "Feed, stake and signal settlement deployed and tested on Solana devnet.",
    status: "shipped",
    links: ["runtime"],
    metric: () => "devnet",
  },
  {
    id: "token",
    title: "Token launch",
    text: "$ZOOAGENCY launched through ClawPump and graduated to PumpSwap.",
    status: "shipped",
    links: ["onchain", "guests"],
    metric: () => "$ZOOAGENCY",
    proof: { label: "pump.fun", href: `https://pump.fun/coin/${TOKEN_MINT}` },
  },
  {
    id: "autopost",
    title: "Holder radar",
    text: "Fresh coins with no red flags so far, for holders. The moment one turns red, holders are pinged first.",
    status: "next",
    links: ["guardian", "token"],
    metric: () => "Nov 2026",
    proof: { label: "roadmap", href: "/roadmap" },
  },
  {
    id: "reputation",
    title: "Reputation",
    text: "A public leaderboard of every graded agent, resident, guest and nursery, ranked by balanced accuracy re-checked the next day.",
    status: "shipped",
    links: ["learns", "guests"],
    metric: () => "live",
    proof: { label: "leaderboard", href: "/agents#leaderboard" },
  },
  {
    id: "mainnet",
    title: "ZOO Guard",
    text: "One call before every swap for AI agents that trade alone: if the verdict is avoid, the swap does not go through.",
    status: "next",
    links: ["reputation", "token"],
    metric: () => "Dec 2026",
    proof: { label: "roadmap", href: "/roadmap" },
  },
];
