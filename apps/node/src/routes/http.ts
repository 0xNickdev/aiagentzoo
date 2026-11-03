import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isEvm } from "../chain/check.ts";

export const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A token or wallet on either chain the zoo reads: base58 on Solana, 0x and forty hex digits on BNB Chain. */
const ADDR = "([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})";
export const route = (pattern: string) => new RegExp(`^${pattern.replace("ADDR", ADDR)}$`);
export const ROUTE = {
  chainToken: route("/v1/chain/token/ADDR"),
  check: route("/v1/check/ADDR"),
  xray: route("/v1/xray/ADDR"),
  creator: route("/v1/chain/creator/ADDR"),
  walletHistory: route("/v1/wallet/ADDR/history"),
  sniper: route("/v1/chain/sniper/ADDR"),
  wallet: route("/v1/wallet/ADDR"),
  bundle: route("/v1/chain/bundle/ADDR"),
  x402: route("/v1/x402/(xray|check)/ADDR"),
};
/** EVM addresses are case-insensitive, so one spelling keys everything: lowercase. Solana addresses stay as they are. */
export const norm = (address: string) => (isEvm(address) ? address.toLowerCase() : address);

const MAX_BODY = 256 * 1024;

/**
 * A sibling node on the private network (the bot on canyon asking north): no proxy in between, so no forwarding
 * headers, and a private source address. Anything from the internet comes through the platform's proxy with them.
 */
export function fromPeer(req: IncomingMessage): boolean {
  if (req.headers["x-forwarded-for"] || req.headers["x-real-ip"]) return false;
  const ip = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1$|f[cd][0-9a-f]{2}:)/i.test(ip);
}

/**
 * The caller's IP for rate limiting. Behind a proxy the client controls the
 * left-most X-Forwarded-For values, so trust X-Real-IP or the right-most hop
 * (added by our own proxy) instead.
 */
export function clientIp(req: IncomingMessage): string {
  const real = String(req.headers["x-real-ip"] ?? "").trim();
  if (real) return real;
  const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1] || req.socket.remoteAddress || "unknown";
}

export function authorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return false;
  const given = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Writes a JSON answer. Returns true so a route can answer and report the request handled in one `return`. */
export function json(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
  return true;
}

export function end(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}
