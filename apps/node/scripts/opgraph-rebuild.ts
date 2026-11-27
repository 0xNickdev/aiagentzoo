/**
 * Rebuilds the operator graph (op_members, op_edges) from history under the current tie rules, and prints the
 * group-size distribution before and after. Inside the container:
 *   node --disable-warning=ExperimentalWarning scripts/opgraph-rebuild.ts /data/history.db
 * The private tool print lives on the live tape, not in history, so a rebuild from here has no print ties; the
 * node's own background rebuild (on a version bump) keeps them.
 */
import { DatabaseSync } from "node:sqlite";
import { OPGRAPH, OperatorGraph } from "../src/chain/opgraph.ts";

const path = process.argv[2] ?? "/data/history.db";
const db = new DatabaseSync(path);
db.exec("PRAGMA busy_timeout = 10000");
const g = new OperatorGraph(db);

const report = (label: string) => {
  const sizes = g.sizes();
  let groups = 0;
  let wallets = 0;
  const buckets: Record<string, number> = { "2": 0, "3-5": 0, "6-20": 0, "21-59": 0, [`${OPGRAPH.maxMembers}+ (too broad)`]: 0, "100+": 0 };
  let largest = 0;
  for (const [n, k] of sizes) {
    groups += k;
    wallets += n * k;
    largest = Math.max(largest, n);
    const b = n >= 100 ? "100+" : n >= OPGRAPH.maxMembers ? `${OPGRAPH.maxMembers}+ (too broad)` : n >= 21 ? "21-59" : n >= 6 ? "6-20" : n >= 3 ? "3-5" : "2";
    buckets[b] = (buckets[b] ?? 0) + k;
  }
  const ties = db.prepare("SELECT type, count(*) AS n FROM op_edges GROUP BY type").all() as Array<{ type: string; n: number }>;
  console.log(`${label}: ${groups} groups, ${wallets} wallets, largest ${largest}`);
  console.log(`  sizes: ${Object.entries(buckets).map(([b, k]) => `${b}: ${k}`).join(", ")}`);
  console.log(`  edges: ${ties.map((t) => `${t.type} ${t.n}`).join(", ")}`);
};

report("before");
const t = Date.now();
const n = g.rebuild(Date.now(), (total) => process.stdout.write(`\r  ${total} tokens read`));
console.log(`\n  rebuilt from ${n} tokens in ${Math.round((Date.now() - t) / 1000)}s`);
report("after");
db.close();
