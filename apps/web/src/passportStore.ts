import { useSyncExternalStore } from "react";

/** One passport dialog for the whole page; any section can open it. */
let current: string | null = null;
const listeners = new Set<() => void>();

export function openPassport(agent: string): void {
  current = agent;
  listeners.forEach((l) => l());
}

export function closePassport(): void {
  current = null;
  listeners.forEach((l) => l());
}

export function usePassport(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
