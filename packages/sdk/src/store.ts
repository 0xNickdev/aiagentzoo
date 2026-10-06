/** Durable key-value state for an enclosure. Values must be JSON-serializable. */
export interface StateStore {
  get<T = unknown>(key: string): T | undefined | Promise<T | undefined>;
  set(key: string, value: unknown): void | Promise<void>;
  delete(key: string): void | Promise<void>;
  keys(prefix?: string): string[] | Promise<string[]>;
}

export class MemoryStore implements StateStore {
  private data = new Map<string, string>();

  get<T>(key: string): T | undefined {
    const raw = this.data.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  set(key: string, value: unknown): void {
    this.data.set(key, JSON.stringify(value));
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  keys(prefix = ""): string[] {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}
