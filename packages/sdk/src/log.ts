import { canonicalJson, sha256 } from "./crypto.js";
import type { ZooEvent } from "./events.js";

/**
 * One entry of the public log. Entries form a hash chain: changing or
 * dropping any past entry breaks every hash after it, so anyone holding
 * the latest hash can audit the whole history.
 */
export interface LogEntry {
  seq: number;
  prevHash: string;
  hash: string;
  event: ZooEvent;
}

export const GENESIS_HASH = "0".repeat(64);

export interface LogStore {
  append(entry: LogEntry): void | Promise<void>;
  last(): LogEntry | undefined | Promise<LogEntry | undefined>;
  /** Entries with `seq > after`, oldest first. */
  since(after: number, limit?: number): LogEntry[] | Promise<LogEntry[]>;
}

export function entryHash(seq: number, prevHash: string, event: ZooEvent): string {
  return sha256(canonicalJson({ seq, prevHash, event }));
}

export class PublicLog {
  private listeners = new Set<(entry: LogEntry) => void>();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: LogStore = new MemoryLogStore()) {}

  /** Appends are serialized so the chain never forks under concurrency. */
  append(event: ZooEvent): Promise<LogEntry> {
    const next = this.tail.then(async () => {
      const last = await this.store.last();
      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? GENESIS_HASH;
      const entry: LogEntry = { seq, prevHash, hash: entryHash(seq, prevHash, event), event };
      await this.store.append(entry);
      for (const listener of this.listeners) listener(entry);
      return entry;
    });
    this.tail = next.catch(() => undefined);
    return next;
  }

  since(after = 0, limit = 500): Promise<LogEntry[]> {
    return Promise.resolve(this.store.since(after, limit));
  }

  head(): Promise<LogEntry | undefined> {
    return Promise.resolve(this.store.last());
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Returns the first broken `seq`, or `null` if the chain is intact. */
export function verifyChain(entries: LogEntry[], prevHash = GENESIS_HASH): number | null {
  let prev = prevHash;
  for (const entry of entries) {
    if (entry.prevHash !== prev || entry.hash !== entryHash(entry.seq, entry.prevHash, entry.event)) {
      return entry.seq;
    }
    prev = entry.hash;
  }
  return null;
}

export class MemoryLogStore implements LogStore {
  private entries: LogEntry[] = [];

  append(entry: LogEntry): void {
    this.entries.push(entry);
  }

  last(): LogEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  since(after: number, limit = 500): LogEntry[] {
    return this.entries.filter((e) => e.seq > after).slice(0, limit);
  }
}
