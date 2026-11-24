import { lookup } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

/**
 * Reads a page a stranger chose. Only https on 443, only public addresses (checked at the moment of connecting, so a
 * name that resolves differently the second time gains nothing), few redirects, a size cap and one deadline.
 */

const blocked = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(net, bits, "ipv4");

/** Public unicast only. IPv6 is allowed solely in 2000::/3, minus the ranges that wrap an IPv4 address or are for documentation. */
const v6ok = new BlockList();
v6ok.addSubnet("2000::", 3, "ipv6");
const v6bad = new BlockList();
for (const [net, bits] of [["2001::", 32], ["2001:db8::", 32], ["2002::", 16]] as const) v6bad.addSubnet(net, bits, "ipv6");

export function publicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !blocked.check(ip, "ipv4");
  if (kind === 6) return v6ok.check(ip, "ipv6") && !v6bad.check(ip, "ipv6");
  return false;
}

/** A URL worth opening: https, the default port, no credentials, a real host name. */
export function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) || !host.includes(".") || /\.(local|internal|localhost|lan|home|arpa)$/i.test(host)) return null;
    return u;
  } catch {
    return null;
  }
}

export interface Page {
  status: number;
  body: string;
  url: string;
}

const MAX_HOPS = 3;

export async function safeFetch(raw: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<Page | null> {
  const deadline = Date.now() + (opts.timeoutMs ?? 6_000);
  let next = raw;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const url = safeUrl(next);
    if (!url) return null;
    const left = deadline - Date.now();
    if (left <= 0) return null;
    const got = await once(url, opts.maxBytes ?? 400_000, left);
    if (!got) return null;
    if (got.location) {
      try {
        next = new URL(got.location, url).href;
      } catch {
        return null;
      }
      continue;
    }
    return { status: got.status, body: got.body, url: url.href };
  }
  return null;
}

function once(url: URL, maxBytes: number, ms: number): Promise<{ status: number; body: string; location?: string } | null> {
  return new Promise((resolve) => {
    let done = false;
    const end = (v: { status: number; body: string; location?: string } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.destroy();
      resolve(v);
    };
    const req = request(
      url,
      {
        agent: false,
        headers: { "user-agent": "Mozilla/5.0 (compatible; zoo-claims)", accept: "text/html,application/json,text/plain;q=0.9" },
        lookup: (host, options, cb) => {
          lookup(host, { all: true }, (err, list) => {
            if (err) return cb(err, "", 4);
            // One private answer among public ones is enough to refuse the name.
            if (!list.length || !list.every((a) => publicAddress(a.address))) return cb(new Error("not a public address"), "", 4);
            const all = (options as { all?: boolean }).all;
            if (all) (cb as unknown as (e: null, l: typeof list) => void)(null, list);
            else cb(null, list[0]!.address, list[0]!.family);
          });
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) return end({ status, body: "", location: res.headers.location });
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          chunks.push(c);
          size += c.length;
          if (size >= maxBytes) end({ status, body: Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8") });
        });
        res.on("end", () => end({ status, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => end(null));
      },
    );
    const timer = setTimeout(() => end(null), ms);
    req.on("error", () => end(null));
    req.end();
  });
}
