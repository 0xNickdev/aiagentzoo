import type { Enclosure, LogEntry } from "@aiagentzoo/sdk";

export interface BriefRef {
  id: string;
  night: string;
  seq: number;
  ts: number;
  sha256: string;
}

/** Index of published Morning Briefs, rebuilt from the log at boot and kept current. */
export class BriefIndex {
  private refs: BriefRef[] = [];
  private readonly enclosure: Enclosure;

  private constructor(enclosure: Enclosure) {
    this.enclosure = enclosure;
  }

  static async build(enclosure: Enclosure): Promise<BriefIndex> {
    const index = new BriefIndex(enclosure);
    let after = 0;
    for (;;) {
      const page = await enclosure.log.since(after, 1000);
      if (page.length === 0) break;
      for (const entry of page) index.ingest(entry);
      after = page[page.length - 1]!.seq;
    }
    enclosure.log.subscribe((entry) => index.ingest(entry));
    return index;
  }

  private ingest(entry: LogEntry): void {
    const e = entry.event;
    if (e.kind !== "artifact" || e.type !== "artifact.published") return;
    const p = e.payload as { id: string; sha256: string; content?: { night?: string } };
    if (!p.id?.startsWith("morning-brief-")) return;
    this.refs = this.refs.filter((r) => r.id !== p.id);
    this.refs.push({ id: p.id, night: p.content?.night ?? p.id.slice("morning-brief-".length), seq: entry.seq, ts: e.ts, sha256: p.sha256 });
  }

  list(limit = 60): BriefRef[] {
    return [...this.refs].sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  async get(id: string): Promise<LogEntry | undefined> {
    const ref = this.refs.find((r) => r.id === id);
    if (!ref) return undefined;
    return (await this.enclosure.log.since(ref.seq - 1, 1))[0];
  }
}
