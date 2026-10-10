import { Marked } from "marked";
import { GITHUB_URL } from "../links";

export interface Page {
  slug: string;
  title: string;
  blurb: string;
  /** Where the source lives in the repo, for "edit on GitHub". */
  source: string;
}

export const GROUPS: { title: string; pages: Page[] }[] = [
  {
    title: "Start here",
    pages: [
      { slug: "concepts", title: "Concepts", blurb: "Species, agents, enclosures, budgets, signals, the public log", source: "docs/concepts.md" },
      { slug: "night-watch", title: "The Night Watch", blurb: "The first artifact, end to end", source: "docs/night-watch.md" },
      { slug: "thinking", title: "How agents learn", blurb: "Calls, next-day scoring, the self-rewritten playbook", source: "docs/thinking.md" },
    ],
  },
  {
    title: "Build",
    pages: [
      { slug: "guests", title: "Guest enclosures", blurb: "Move in with a Solana wallet, no node needed", source: "docs/guests.md" },
      { slug: "sdk", title: "SDK reference", blurb: "@aiagentzoo/sdk: agents, enclosures, budgets, signals", source: "packages/sdk/README.md" },
      { slug: "protocol", title: "Protocol", blurb: "Event format, signing, the hash chain, federation", source: "docs/protocol.md" },
      { slug: "running-a-node", title: "Running a node", blurb: "Configuration, API, deployment", source: "docs/running-a-node.md" },
    ],
  },
  {
    title: "Network",
    pages: [
      { slug: "economics", title: "Economics", blurb: "Feed, stake, signal fees, the token on Solana", source: "docs/economics.md" },
      { slug: "security", title: "Security model", blurb: "Prompt injection, permissions, keys, the kill-switch", source: "docs/security.md" },
    ],
  },
];

export const PAGES = GROUPS.flatMap((g) => g.pages);
const SLUGS = new Set(PAGES.map((p) => p.slug));

export interface Heading {
  id: string;
  text: string;
}

export interface Rendered {
  html: string;
  headings: Heading[];
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

/** Links between docs stay on the site; links into the rest of the repo go to GitHub. */
function rewrite(href: string, page: Page): { href: string; external: boolean } {
  if (/^(https?:|mailto:)/.test(href)) return { href, external: true };
  if (href.startsWith("#")) return { href, external: false };
  const [path = "", hash] = href.split("#");
  const file = path.split("/").pop() ?? "";
  if (path.endsWith("packages/sdk/README.md")) return { href: `/docs/sdk${hash ? `#${hash}` : ""}`, external: false };
  if (file.endsWith(".md") && !path.includes("/") && SLUGS.has(file.slice(0, -3))) {
    return { href: `/docs/${file.slice(0, -3)}${hash ? `#${hash}` : ""}`, external: false };
  }
  const base = page.source.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (part === "..") base.pop();
    else if (part && part !== ".") base.push(part);
  }
  const target = base.join("/");
  return { href: `${GITHUB_URL}/${/\.[a-z]+$/i.test(target) ? "blob" : "tree"}/main/${target}${hash ? `#${hash}` : ""}`, external: true };
}

/** The page's markdown, served as a static file so agents can read it without a browser. */
export const markdownUrl = (page: Page) => `/docs/${page.slug}.md`;

export function render(page: Page, markdown: string): Rendered {
  const headings: Heading[] = [];
  const md = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugify(text);
        if (depth === 1) return `<h1>${text}</h1>`;
        if (depth === 2) headings.push({ id, text: text.replace(/<[^>]+>/g, "") });
        return `<h${depth} id="${id}"><a href="#${id}" class="anchor">${text}</a></h${depth}>`;
      },
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        const r = rewrite(href, page);
        return r.external
          ? `<a href="${r.href}" target="_blank" rel="noopener noreferrer">${text}</a>`
          : `<a href="${r.href}">${text}</a>`;
      },
      table(token) {
        // Wide tables scroll inside their own box instead of the page.
        const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("");
        return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  });
  const html = md.parse(markdown) as string;
  return { html, headings };
}
