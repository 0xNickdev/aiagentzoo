// Lists t("...") keys in apps/web/src that have no entry in zh.ts. Usage: node scripts/zh-missing.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = new URL("../apps/web/src/", import.meta.url).pathname;
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && f !== "zh.ts") files.push(p); } };
walk(root);
const unq = (q, s) => q === "`" ? s : JSON.parse(q === "'" ? `"${s.replace(/\\'/g, "'").replace(/"/g, '\\"')}"` : `"${s}"`);
const zhSrc = readFileSync(join(root, "zh.ts"), "utf8");
const zh = new Set();
for (const m of zhSrc.matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*:/gm)) zh.add(JSON.parse(m[1]));
const missing = new Map();
const re = /\bt\(\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1\s*[,)]/g;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(re)) {
    if (m[1] === "`" && m[2].includes("${")) continue;
    const k = unq(m[1], m[2]);
    if (!zh.has(k) && !missing.has(k)) missing.set(k, f.slice(root.length));
  }
}
for (const [k, f] of missing) console.log(`${f}\t${JSON.stringify(k)}`);
console.error(`missing: ${missing.size}`);
