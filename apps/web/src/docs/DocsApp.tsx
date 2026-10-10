import { ArrowLeft, ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GITHUB_URL, GitHubIcon, X_URL, XIcon } from "../links";
import { GROUPS, markdownUrl, PAGES, type Page, render } from "./pages";

const slugFromPath = () => location.pathname.replace(/^\/docs\/?/, "").replace(/\/$/, "") || PAGES[0]!.slug;

function usePage(): [Page, (slug: string, hash?: string) => void] {
  const [slug, setSlug] = useState(slugFromPath);
  useEffect(() => {
    const onPop = () => setSlug(slugFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (next: string, hash = "") => {
    history.pushState(null, "", `/docs/${next}${hash}`);
    setSlug(next);
    if (hash) requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView());
    else window.scrollTo({ top: 0, behavior: "instant" });
  };
  return [PAGES.find((p) => p.slug === slug) ?? PAGES[0]!, go];
}

function Nav({ page, go }: { page: Page; go: (slug: string) => void }) {
  return (
    <nav className="space-y-8">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="font-mono mb-3 text-[10.5px] uppercase tracking-[0.14em] text-white/35">{g.title}</p>
          <ul className="space-y-1">
            {g.pages.map((p) => (
              <li key={p.slug}>
                <a
                  href={`/docs/${p.slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    go(p.slug);
                  }}
                  className={`block rounded-lg px-3 py-1.5 text-[14px] transition ${
                    p.slug === page.slug ? "bg-white/[0.07] text-white" : "text-white/55 hover:text-white"
                  }`}
                >
                  {p.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default function DocsApp() {
  const [page, go] = usePage();
  const [menu, setMenu] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const [markdown, setMarkdown] = useState<{ slug: string; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(markdownUrl(page))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => live && setMarkdown({ slug: page.slug, text }))
      .catch(() => live && setMarkdown({ slug: page.slug, text: `# ${page.title}\n\nThis page could not be loaded. [Read it on GitHub](https://github.com/0xNickdev/aiagentzoo/blob/main/${page.source}).` }));
    return () => {
      live = false;
    };
  }, [page]);
  const ready = markdown?.slug === page.slug;
  const { html, headings } = useMemo(() => (ready ? render(page, markdown.text) : { html: "", headings: [] }), [page, markdown, ready]);
  const index = PAGES.indexOf(page);
  const prev = PAGES[index - 1];
  const next = PAGES[index + 1];

  useEffect(() => {
    document.title = `${page.title} - ZOOAI AGENCY docs`;
    setMenu(false);
  }, [page]);

  // In-page links stay in the app; code blocks get a copy button; the TOC follows the scroll.
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      const href = a?.getAttribute("href");
      if (!a || !href || a.target === "_blank" || !href.startsWith("/docs/")) return;
      e.preventDefault();
      const [path, hash] = href.split("#");
      go(path!.replace("/docs/", ""), hash ? `#${hash}` : "");
    };
    root.addEventListener("click", onClick);

    for (const pre of root.querySelectorAll("pre")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy";
      button.textContent = "copy";
      button.onclick = () => {
        void navigator.clipboard?.writeText(pre.querySelector("code")?.textContent ?? "").then(() => {
          button.textContent = "copied";
          setTimeout(() => (button.textContent = "copy"), 1400);
        });
      };
      pre.appendChild(button);
    }

    const spy = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).map((e) => e.target.id);
        if (seen[0]) setActive(seen[0]);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    root.querySelectorAll("h2[id]").forEach((h) => spy.observe(h));
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    return () => {
      root.removeEventListener("click", onClick);
      spy.disconnect();
    };
  }, [html]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#030504]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-center gap-2.5 text-[15px] font-medium tracking-tight text-white">
              <img src="/token.png" alt="" className="h-7 w-7 rounded-full ring-1 ring-white/20" />
              ZOOAI AGENCY
            </a>
            <span className="font-mono rounded-full px-2.5 py-0.5 text-[11px] text-white/55 ring-1 ring-white/15">docs</span>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className="hidden text-[13.5px] text-white/60 hover:text-white sm:block">
              Back to the zoo
            </a>
            <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="ZOOAI AGENCY on X" className="ml-3 rounded-full p-2 text-white/70 ring-1 ring-white/15 hover:text-white">
              <XIcon size={13} />
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="Source on GitHub" className="rounded-full p-2 text-white/70 ring-1 ring-white/15 hover:text-white">
              <GitHubIcon size={14} />
            </a>
            <button type="button" onClick={() => setMenu((m) => !m)} aria-label={menu ? "Close menu" : "Open menu"} className="ml-1 p-2 text-white lg:hidden">
              {menu ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {menu && (
          <div className="max-h-[70vh] overflow-y-auto border-t border-white/[0.07] px-5 py-6 lg:hidden">
            <Nav page={page} go={go} />
          </div>
        )}
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-10 px-5 sm:px-8 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_200px]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] overflow-y-auto py-10 lg:block">
          <Nav page={page} go={go} />
        </aside>

        <main className="min-w-0 py-10 sm:py-14">
          <p className="font-mono text-[11px] text-white/40">{GROUPS.find((g) => g.pages.includes(page))?.title}</p>
          {ready ? (
            <div ref={body} className="doc" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div className="doc">
              <h1>{page.title}</h1>
            </div>
          )}

          <div className="mt-16 grid gap-3 border-t border-white/[0.07] pt-8 sm:grid-cols-2">
            {prev ? (
              <a
                href={`/docs/${prev.slug}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(prev.slug);
                }}
                className="group rounded-2xl p-5 ring-1 ring-white/10 transition hover:ring-white/25"
              >
                <span className="font-mono flex items-center gap-1.5 text-[11px] text-white/40">
                  <ArrowLeft size={12} /> previous
                </span>
                <span className="mt-1 block text-[16px] text-white">{prev.title}</span>
              </a>
            ) : (
              <span />
            )}
            {next && (
              <a
                href={`/docs/${next.slug}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(next.slug);
                }}
                className="group rounded-2xl p-5 text-right ring-1 ring-white/10 transition hover:ring-white/25"
              >
                <span className="font-mono flex items-center justify-end gap-1.5 text-[11px] text-white/40">
                  next <ArrowRight size={12} />
                </span>
                <span className="mt-1 block text-[16px] text-white">{next.title}</span>
                <span className="mt-1 block text-[12.5px] text-white/45">{next.blurb}</span>
              </a>
            )}
          </div>
          <a
            href={`${GITHUB_URL}/blob/main/${page.source}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono mt-8 inline-block text-[11px] text-white/35 hover:text-white"
          >
            edit this page on GitHub ↗
          </a>
          <a href={markdownUrl(page)} className="font-mono ml-6 mt-8 inline-block text-[11px] text-white/35 hover:text-white">
            raw markdown
          </a>
        </main>

        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] overflow-y-auto py-14 xl:block">
          {headings.length > 1 && (
            <>
              <p className="font-mono mb-3 text-[10.5px] uppercase tracking-[0.14em] text-white/35">On this page</p>
              <ul className="space-y-2 border-l border-white/[0.08]">
                {headings.map((h) => (
                  <li key={h.id}>
                    <a
                      href={`#${h.id}`}
                      className={`-ml-px block border-l py-0.5 pl-3 text-[12.5px] transition ${
                        active === h.id ? "border-amber-200/70 text-white" : "border-transparent text-white/45 hover:text-white"
                      }`}
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
