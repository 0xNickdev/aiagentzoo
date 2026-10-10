// Copies the repo's docs into public/docs: one copy that the /docs page renders and agents fetch as plain markdown.
// Vercel deploys apps/web on its own, so the copies are committed; this refreshes them on every local build.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(web, "..", "..");
const out = join(web, "public", "docs");

const sources = {
  "concepts.md": "docs/concepts.md",
  "protocol.md": "docs/protocol.md",
  "running-a-node.md": "docs/running-a-node.md",
  "night-watch.md": "docs/night-watch.md",
  "economics.md": "docs/economics.md",
  "security.md": "docs/security.md",
  "guests.md": "docs/guests.md",
  "thinking.md": "docs/thinking.md",
  "sdk.md": "packages/sdk/README.md",
};

if (!existsSync(join(repo, "docs"))) {
  console.log("sync-docs: repo docs not here, using the committed copies");
} else {
  for (const [name, from] of Object.entries(sources)) copyFileSync(join(repo, from), join(out, name));
  console.log(`sync-docs: ${Object.keys(sources).length} files`);
}
