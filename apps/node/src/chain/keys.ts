import { createHash, randomBytes } from "node:crypto";
import type { StateStore } from "@aiagentzoo/sdk";

/**
 * API keys for the creator check: free for everyone, more for holders. A holder signs in with their wallet and gets
 * one key; only its hash is stored, so the key is shown once and a leak of the store leaks no keys. The holding is
 * checked again from time to time, so a key stops lifting limits when the wallet sells.
 */

export const FREE_PER_MIN = 120;
export const HOLDER_PER_MIN = 1_200;
export const FREE_DEEP_PER_MIN = 10;
export const HOLDER_DEEP_PER_MIN = 300;
/** How long a holding check stands before the wallet's balance is read again. */
export const HOLDING_TTL_MS = 30 * 60_000;

const hash = (key: string) => createHash("sha256").update(key).digest("hex");
const KEY = (h: string) => `check:key:${h}`;
const KEY_OF = (wallet: string) => `check:keyof:${wallet}`;

export const isKeyShaped = (s: string) => /^zk_[A-Za-z0-9_-]{32}$/.test(s);

/** A new key for a wallet; the wallet's previous key stops working. */
export async function issueKey(store: StateStore, wallet: string, now = Date.now()): Promise<string> {
  const old = await store.get<string>(KEY_OF(wallet));
  if (old) await store.delete(KEY(old));
  const key = `zk_${randomBytes(24).toString("base64url")}`;
  await store.set(KEY(hash(key)), { wallet, at: now });
  await store.set(KEY_OF(wallet), hash(key));
  return key;
}

/** The wallet behind a key, or null for an unknown or replaced key. */
export async function walletOfKey(store: StateStore, key: string): Promise<string | null> {
  if (!isKeyShaped(key)) return null;
  const rec = await store.get<{ wallet: string }>(KEY(hash(key)));
  return rec?.wallet ?? null;
}

/** The key from `Authorization: Bearer zk_...` or `?key=zk_...`. */
export function keyFrom(headers: Record<string, string | string[] | undefined>, query: URLSearchParams): string | null {
  const auth = String(headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (auth.startsWith("zk_")) return auth;
  const q = query.get("key");
  return q && q.startsWith("zk_") ? q : null;
}

/** Remembers recent holding checks so a busy key does not cost an RPC call per request. */
export class HoldingCache {
  private readonly seen = new Map<string, { ok: boolean; at: number }>();
  private readonly check: (wallet: string) => Promise<boolean>;
  constructor(check: (wallet: string) => Promise<boolean>) {
    this.check = check;
  }
  async holds(wallet: string, now = Date.now()): Promise<boolean> {
    const hit = this.seen.get(wallet);
    if (hit && now - hit.at < HOLDING_TTL_MS) return hit.ok;
    const ok = await this.check(wallet).catch(() => hit?.ok ?? false);
    this.seen.set(wallet, { ok, at: now });
    return ok;
  }
}
