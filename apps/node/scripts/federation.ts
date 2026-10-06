/**
 * Runs the whole Night Watch locally: three nodes, three enclosures,
 * real data, real signatures, real HTTP federation between them.
 *
 *   npm run dev -w @aiagentzoo/node
 *
 * Node keys are created once under ./data/<role>/identity.key and reused.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Identity } from "@aiagentzoo/sdk";

const roles = [
  { role: "north", port: 8781 },
  { role: "marsh", port: 8782 },
  { role: "canyon", port: 8783 },
] as const;

const root = join(process.cwd(), "data");
const nodes = roles.map(({ role, port }) => {
  const dir = join(root, role);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "identity.key");
  if (!existsSync(file)) writeFileSync(file, Identity.generate().export(), { mode: 0o600 });
  const identity = Identity.import(readFileSync(file, "utf8").trim());
  return { role, port, id: `${role}.zoo`, url: `http://localhost:${port}`, publicKey: identity.publicKey, dir };
});

const scanEvery = process.env.ZOO_SCAN_EVERY_MS ?? String(60_000);

for (const node of nodes) {
  const peers = nodes.filter((n) => n !== node).map(({ id, url, publicKey }) => ({ id, url, publicKey }));
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/main.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      ZOO_ROLE: node.role,
      ZOO_NODE_ID: node.id,
      ZOO_DATA_DIR: node.dir,
      ZOO_PEERS: JSON.stringify(peers),
      ZOO_NODE_NORTH: "north.zoo",
      ZOO_NODE_MARSH: "marsh.zoo",
      ZOO_NODE_CANYON: "canyon.zoo",
      ZOO_SCAN_EVERY_MS: scanEvery,
      ZOO_ADMIN_TOKEN: process.env.ZOO_ADMIN_TOKEN ?? "dev-warden",
      PORT: String(node.port),
    },
  });
  child.on("exit", (code) => {
    console.error(`[${node.id}] exited with ${code}`);
    process.exit(code ?? 1);
  });
}
