import type { ReactNode } from "react";

/** The dashboard's panel: a surface with a hairline edge, a 40px head with a title and a quiet meta line, then the body. */
export function Panel({
  title,
  meta,
  tag,
  action,
  id,
  className = "",
  bodyClass = "p-3.5",
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  tag?: string;
  action?: ReactNode;
  id?: string;
  className?: string;
  bodyClass?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`flex min-w-0 scroll-mt-20 flex-col rounded-[12px] border border-line bg-night-surface ${className}`}>
      <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
        <h2 className="whitespace-nowrap text-[13px] font-medium text-white">{title}</h2>
        {tag && <span className="rounded-[4px] border border-lit-edge px-[5px] text-[10.5px] leading-4 text-lit">{tag}</span>}
        {meta && <span className="ml-auto min-w-0 truncate text-[11.5px] text-faint">{meta}</span>}
        {action && <span className={`${meta ? "" : "ml-auto"} shrink-0 text-[11.5px]`}>{action}</span>}
      </div>
      <div className={`min-w-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** A labelled number over a thin meter, as in the dashboard's "Right now" tiles. */
export function Tile({ k, v, sub, tone = "fg", meter, className = "" }: { k: string; v: ReactNode; sub?: ReactNode; tone?: "fg" | "danger" | "warn" | "lit"; meter?: number | null; className?: string }) {
  const color = { fg: "text-white", danger: "text-danger", warn: "text-warn", lit: "text-lit" }[tone];
  return (
    <div className={`flex min-h-[92px] min-w-0 flex-col justify-between gap-2.5 p-3.5 ${className}`}>
      <span className="text-[12px] text-dim">{k}</span>
      <span className={`text-[28px] font-medium leading-none tracking-[-0.035em] ${color}`}>{v}</span>
      {meter != null && (
        <span className="block h-[3px] overflow-hidden rounded-sm bg-night-raised">
          <span className={`block h-full ${tone === "fg" ? "bg-dim" : tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-lit"}`} style={{ width: `${Math.max(1, Math.min(100, meter * 100))}%` }} />
        </span>
      )}
      {sub && <span className="truncate text-[11.5px] text-faint">{sub}</span>}
    </div>
  );
}

/** A link styled as the dashboard's quiet "more" action. */
export function More({ href, children }: { href: string; children: ReactNode }) {
  const ext = href.startsWith("http");
  return (
    <a href={href} target={ext ? "_blank" : undefined} rel={ext ? "noopener noreferrer" : undefined} className="whitespace-nowrap text-[11.5px] text-dim hover:text-white">
      {children}
    </a>
  );
}

/** A kept page's frame: the dashboard's width and gutters, a 32px title with one line under it, and an optional right side. */
export function Page({ title, lead, side, children }: { title: ReactNode; lead?: ReactNode; side?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-8 pt-5 sm:px-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-[1.05] tracking-[-0.045em] text-white sm:text-[32px]">{title}</h1>
          {lead && <p className="mt-2 max-w-[75ch] text-[13.5px] leading-[1.55] text-fg-2">{lead}</p>}
        </div>
        {side && <div className="flex shrink-0 flex-wrap items-center gap-2">{side}</div>}
      </div>
      {children}
    </div>
  );
}

/** A quiet button in the dashboard's style; `primary` is the white one. */
export function Btn({ href, onClick, primary, children, className = "" }: { href?: string; onClick?: () => void; primary?: boolean; children: ReactNode; className?: string }) {
  const cls = `${primary ? "btn-primary" : "border border-line-2 bg-transparent text-white hover:border-[#4a524e]"} inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 text-[12.5px] font-medium ${className}`;
  if (href) {
    const ext = href.startsWith("http");
    return (
      <a href={href} target={ext ? "_blank" : undefined} rel={ext ? "noopener noreferrer" : undefined} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
