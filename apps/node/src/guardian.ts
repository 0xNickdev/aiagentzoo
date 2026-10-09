import { verifySignature } from "@aiagentzoo/sdk";

/**
 * Guardians sign in with a Solana wallet by signing a short session
 * message. No transaction, no funds — just proof of the address.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SESSION_MAX_MS = 24 * 60 * 60 * 1000;

export function base58Decode(input: string): Uint8Array {
  let value = 0n;
  for (const char of input) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error("invalid base58");
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of input) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export interface GuardianSession {
  /** base58 Solana address. */
  publicKey: string;
  /** The exact message the wallet signed. */
  message: string;
  /** base64 of the 64-byte ed25519 signature. */
  signature: string;
}

/** The message the site asks the wallet to sign. Keep in sync with apps/web. */
export function sessionMessage(publicKey: string, issuedAt: string, expiresAt: string): string {
  return [
    "ZOOAI AGENCY guardian session",
    "",
    "Sign in as a guardian. This is not a transaction and costs nothing.",
    "",
    `Wallet: ${publicKey}`,
    `Issued: ${issuedAt}`,
    `Expires: ${expiresAt}`,
  ].join("\n");
}

/** Returns the guardian address if the session is valid and current, else a reason. */
export function verifyGuardian(session: GuardianSession, now = Date.now()): { ok: true; address: string } | { ok: false; reason: string } {
  const { publicKey, message, signature } = session ?? ({} as GuardianSession);
  if (typeof publicKey !== "string" || typeof message !== "string" || typeof signature !== "string") {
    return { ok: false, reason: "malformed session" };
  }
  let key: Uint8Array;
  try {
    key = base58Decode(publicKey);
  } catch {
    return { ok: false, reason: "invalid wallet address" };
  }
  if (key.length !== 32) return { ok: false, reason: "invalid wallet address" };

  const issued = /^Issued: (.+)$/m.exec(message)?.[1];
  const expires = /^Expires: (.+)$/m.exec(message)?.[1];
  if (!issued || !expires) return { ok: false, reason: "session message missing dates" };
  if (message !== sessionMessage(publicKey, issued, expires)) return { ok: false, reason: "unexpected session message" };
  const issuedMs = Date.parse(issued);
  const expiresMs = Date.parse(expires);
  if (!(issuedMs <= now + 60_000) || !(expiresMs > now) || expiresMs - issuedMs > SESSION_MAX_MS) {
    return { ok: false, reason: "session expired or invalid" };
  }

  const jwkX = Buffer.from(key).toString("base64url");
  const sig = Buffer.from(signature, "base64").toString("base64url");
  if (!verifySignature(jwkX, message, sig)) return { ok: false, reason: "bad signature" };
  return { ok: true, address: publicKey };
}

/** Fixed-window rate limiter keyed by caller. */
export class Cooldown {
  private last = new Map<string, number>();
  private readonly ms: number;

  constructor(ms: number) {
    this.ms = ms;
  }

  /** Milliseconds left before `key` may act again, without recording anything. */
  wait(key: string, now = Date.now()): number {
    return Math.max(0, (this.last.get(key) ?? 0) + this.ms - now);
  }

  /** Records an action for `key`. Call only after every limit passed. */
  hit(key: string, now = Date.now()): void {
    this.last.set(key, now);
    if (this.last.size > 10_000) {
      for (const [k, t] of this.last) if (t + this.ms < now) this.last.delete(k);
    }
  }
}
