import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Identity, type Peer } from "@aiagentzoo/sdk";
import type { Role } from "./agents/nightWatch.ts";

export interface NodeConfig {
  id: string;
  role: Role;
  name: string;
  port: number;
  dataDir: string;
  identity: Identity;
  peers: Peer[];
  nodes: Record<Role, string>;
  keeper: string;
  operator: string;
  feedGrant: number;
  /** "free" (default): no feed or stake, budgets still apply. "credits": v1 internal feed ledger. */
  feedMode: "free" | "credits";
  adminToken: string | undefined;
  briefAt: string;
  scanEveryMs: number;
  corsOrigin: string;
}

const NAMES: Record<Role, string> = {
  north: "Northern Edge",
  marsh: "Quiet Marsh",
  canyon: "Stone Canyon",
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

/** Loads the node identity from ZOO_NODE_SECRET, or creates one in the data dir. */
function loadIdentity(dataDir: string): Identity {
  if (process.env.ZOO_NODE_SECRET) return Identity.import(process.env.ZOO_NODE_SECRET);
  const file = join(dataDir, "identity.key");
  if (existsSync(file)) return Identity.import(readFileSync(file, "utf8").trim());
  const identity = Identity.generate();
  writeFileSync(file, identity.export(), { mode: 0o600 });
  return identity;
}

export function loadConfig(): NodeConfig {
  const role = required("ZOO_ROLE") as Role;
  if (!(role in NAMES)) throw new Error(`ZOO_ROLE must be one of ${Object.keys(NAMES).join(", ")}`);
  const id = process.env.ZOO_NODE_ID ?? `${role}.zoo`;
  const dataDir = process.env.ZOO_DATA_DIR ?? join(process.cwd(), "data", role);
  mkdirSync(dataDir, { recursive: true });

  // ZOO_PEERS: JSON array of { id, url, publicKey }
  const peers = JSON.parse(process.env.ZOO_PEERS ?? "[]") as Peer[];
  const nodes = {
    north: process.env.ZOO_NODE_NORTH ?? "north.zoo",
    marsh: process.env.ZOO_NODE_MARSH ?? "marsh.zoo",
    canyon: process.env.ZOO_NODE_CANYON ?? "canyon.zoo",
  };
  nodes[role] = id;

  return {
    id,
    role,
    name: NAMES[role],
    port: Number(process.env.PORT ?? 8787),
    dataDir,
    identity: loadIdentity(dataDir),
    peers,
    nodes,
    keeper: process.env.ZOO_KEEPER ?? `keeper:${id}`,
    operator: process.env.ZOO_OPERATOR ?? `operator:${id}`,
    feedGrant: Number(process.env.ZOO_FEED_GRANT ?? 10_000),
    feedMode: process.env.ZOO_FEED_MODE === "credits" ? "credits" : "free",
    adminToken: process.env.ZOO_ADMIN_TOKEN || undefined,
    briefAt: process.env.ZOO_BRIEF_AT ?? "07:00",
    scanEveryMs: Number(process.env.ZOO_SCAN_EVERY_MS ?? 10 * 60_000),
    corsOrigin: process.env.ZOO_CORS_ORIGIN ?? "*",
  };
}
