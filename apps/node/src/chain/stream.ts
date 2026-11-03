/**
 * The chain's live feed into the tape: Yellowstone gRPC subscriptions to pump.fun, LaunchLab, Meteora's curve and
 * PumpSwap, or a relay that reads them where the stream runs at full speed.
 */
import { DBC_PROGRAM, fromYellowstone, LAUNCHLAB_PROGRAM, parseLaunchpads, type YellowstoneTx } from "./launchpads.ts";
import { type PrintableTx, signersOf, toolPrintOf } from "./fingerprint.ts";
import { base58, parsePumpLogs, PUMP_AMM_PROGRAM, PUMP_PROGRAM, type PumpEvent } from "./pumpParse.ts";
import type { PumpTape } from "./pump.ts";

export interface StreamOptions {
  url: string;
  token: string;
  log?: (message: string) => void;
  /** Every PumpSwap transaction instead of the tape's pools: for the relay, which has no tape to ask. */
  allPools?: boolean;
}

/** Where the stream's events go: the tape, or the relay's buffer. */
export type StreamSink = Pick<PumpTape, "apply" | "poolAddresses" | "prune"> & { connected: boolean };

const STREAM_STALL_MS = 90_000;
// North runs in California and the stream comes from Europe: with the default HTTP/2 window a connection carries only
// what fits in one window per round trip, far less than pump.fun writes. Big windows that grow with the link fix that.
const CHANNEL = { grpcHttp2AdaptiveWindow: true, grpcInitialStreamWindowSize: 16 << 20, grpcInitialConnectionWindowSize: 32 << 20, grpcMaxDecodingMessageSize: 64 << 20 };

type StreamUpdate = { filters?: string[]; transaction?: { slot?: string | number; transaction?: YellowstoneTx & { signature?: Uint8Array; meta?: { logMessages?: string[] } } }; ping?: unknown };

/**
 * Keeps Yellowstone subscriptions open, reconnecting with backoff, feeding the tape. Two connections: launches and the
 * curves (pump.fun, LaunchLab, Meteora) on one, PumpSwap on the other, and that one only for the pools of tokens on the
 * tape. All of PumpSwap on one connection was more than the stream could carry: it fell minutes behind the chain and
 * took the launches down with it.
 */
export async function startPumpStream(t: StreamSink, { url, token, log = console.log, allPools = false }: StreamOptions): Promise<() => void> {
  type Yellowstone = typeof import("@triton-one/yellowstone-grpc");
  // Cast kept: the package's types describe its ESM shape, but Node hands its CommonJS exports over wrapped in default.
  const mod = (await import("@triton-one/yellowstone-grpc")) as unknown as Yellowstone & { default: Yellowstone["default"] | { default: Yellowstone["default"] } };
  // A CommonJS package seen from ESM: the class is the default export, possibly wrapped once more.
  const Client = ("default" in mod.default ? mod.default.default : mod.default) as Yellowstone["default"];
  // Cast kept: the enum sits on the wrapped default when the named export is missing, which its types cannot say.
  const CommitmentLevel = mod.CommitmentLevel ?? (mod.default as unknown as Yellowstone).CommitmentLevel;
  let stopped = false;
  const open = new Set<{ end(): void }>();
  const filter = (accounts: string[]) => ({ vote: false, failed: false, accountInclude: accounts, accountExclude: [], accountRequired: [] });
  const request = (transactions: Record<string, ReturnType<typeof filter>>) => ({ accounts: {}, slots: {}, transactions, transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {}, accountsDataSlice: [], commitment: CommitmentLevel.CONFIRMED });

  const onData = (update: StreamUpdate) => {
    const logs = update.transaction?.transaction?.meta?.logMessages;
    if (!logs) return;
    const sig = update.transaction?.transaction?.signature;
    const tx = sig && sig.length ? base58(sig) : undefined;
    const slot = update.transaction?.slot !== undefined ? Number(update.transaction.slot) : undefined;
    const at = Number.isFinite(slot) ? slot : undefined;
    // Wallets that signed together share an owner. The event's "user" is not always a signer (a program can trade for
    // an account), so only the transaction's own signatures count; a new mint's keypair signs its create and is no wallet.
    let signers = signersOf(update.transaction!.transaction! as PrintableTx);
    let cosigned = false;
    const mark = (ev: PumpEvent) => {
      if (ev.kind === "create") signers = signers.filter((s) => s !== ev.mint);
      if (cosigned || signers.length < 2 || (ev.kind !== "create" && ev.kind !== "trade" && ev.kind !== "swap")) return;
      ev.signers = signers;
      cosigned = true;
    };
    for (const ev of parsePumpLogs(logs)) {
      mark(ev);
      // A launch carries its tool print, read from the whole transaction; the relay passes it on with the event.
      if (ev.kind === "create") {
        const print = toolPrintOf(update.transaction!.transaction! as PrintableTx, ev.uri);
        if (print) ev.print = print;
      }
      t.apply(ev, Date.now(), tx, at);
    }
    // LaunchLab and Meteora's curve write their events into inner instructions: read the whole transaction.
    if (update.filters?.some((f) => f === "launchlab" || f === "dbc")) {
      const raw = fromYellowstone(update.transaction!.transaction!);
      if (raw)
        for (const ev of parseLaunchpads(raw, Date.now())) {
          mark(ev);
          if (ev.kind === "create") {
            const print = toolPrintOf(update.transaction!.transaction! as PrintableTx, ev.uri);
            if (print) ev.print = print;
          }
          t.apply(ev, Date.now(), tx, at);
        }
    }
  };

  /**
   * One connection, reopened whenever it ends, errors or goes quiet for `stallMs`. `filters` is read again on every
   * open and every `refreshMs`; when it changes the new request goes down the same stream. No filters, no connection.
   */
  const lane = async (name: string, filters: () => Record<string, ReturnType<typeof filter>> | null, opts: { stallMs: number; refreshMs?: number; core?: boolean }) => {
    let delay = 1_000;
    while (!stopped) {
      let wanted = filters();
      if (!wanted) {
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
      try {
        const client = new Client(url, token, CHANNEL);
        await client.connect();
        const stream = await client.subscribe();
        open.add(stream);
        let heard = Date.now();
        let timer: ReturnType<typeof setInterval> | undefined;
        let sentAt = Date.now();
        let pings = 0;
        await new Promise<void>((resolve, reject) => {
          timer = setInterval(() => {
            // A stream can go quiet without ending: silence on a busy program means reconnect.
            if (Date.now() - heard >= opts.stallMs) {
              reject(new Error(`no transactions for ${Math.round((Date.now() - heard) / 1000)} s, reconnecting`));
              try {
                stream.end();
              } catch {
                /* already closed */
              }
              return;
            }
            if (opts.refreshMs && Date.now() - sentAt >= opts.refreshMs) {
              sentAt = Date.now();
              const next = filters();
              if (next && JSON.stringify(next) !== JSON.stringify(wanted)) {
                wanted = next;
                stream.write(request(next), (error: unknown) => error && reject(error));
              }
            }
          }, 15_000);
          stream.on("data", (update: StreamUpdate) => {
            // The server asks if we are still here; a request with only a ping answers it and leaves the filters alone.
            if (update.ping) {
              pings += 1;
              stream.write({ ...request({}), transactions: {}, ping: { id: pings } }, () => {});
              return;
            }
            if (!update.transaction?.transaction?.meta?.logMessages) return;
            heard = Date.now();
            if (opts.core && !t.connected) {
              t.connected = true;
              delay = 1_000;
              log("[chain] pump.fun, LaunchLab and Meteora stream live");
            } else if (!opts.core && delay > 1_000) delay = 1_000;
            onData(update);
          });
          stream.on("error", reject);
          stream.on("end", resolve);
          stream.on("close", resolve);
          stream.write(request(wanted!), (error: unknown) => error && reject(error));
        }).finally(() => {
          clearInterval(timer);
          open.delete(stream);
        });
      } catch (error) {
        log(`[chain] ${name} stream error: ${(error as Error).message?.slice(0, 200)}`);
      }
      if (opts.core) t.connected = false;
      if (stopped) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60_000);
    }
  };

  void lane("launches", () => ({ pump: filter([PUMP_PROGRAM]), launchlab: filter([LAUNCHLAB_PROGRAM]), dbc: filter([DBC_PROGRAM]) }), { stallMs: STREAM_STALL_MS, core: true });
  // Only the pools we follow: an empty list would mean every PumpSwap transaction, so no pools means no connection.
  void lane(
    "pools",
    () => {
      if (allPools) return { amm: filter([PUMP_AMM_PROGRAM]) };
      const pools = t.poolAddresses();
      return pools.length ? { amm: filter(pools) } : null;
    },
    { stallMs: 15 * 60_000, refreshMs: 60_000 },
  );
  const pruner = setInterval(() => t.prune(), 10 * 60_000);
  return () => {
    stopped = true;
    clearInterval(pruner);
    for (const s of open) s.end();
  };
}

/**
 * The same events, read from a relay instead of the stream: a small reader on a server the stream reaches at full
 * speed (it gave a cloud container a tenth of pump.fun), sending north the parsed events as lines of JSON. Picks up after the
 * last event it applied when the connection drops; a relay that restarted says so and is read from its start.
 */
export function startRelayFeed(t: PumpTape, { url, token, log = console.log }: Omit<StreamOptions, "allPools">): () => void {
  let stopped = false;
  let ctl: AbortController | null = null;
  let after = 0;
  let epoch = "";
  const run = async () => {
    let delay = 1_000;
    while (!stopped) {
      ctl = new AbortController();
      const c = ctl;
      let heard = Date.now();
      const stall = setInterval(() => Date.now() - heard > STREAM_STALL_MS && c.abort(new Error("relay quiet")), 15_000);
      try {
        const res = await fetch(`${url}/events?after=${after}`, { headers: { authorization: `Bearer ${token}` }, signal: c.signal });
        if (!res.ok || !res.body) throw new Error(`relay responded ${res.status}`);
        const dec = new TextDecoder();
        let buf = "";
        for await (const chunk of res.body) {
          heard = Date.now();
          buf += dec.decode(chunk, { stream: true });
          for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (!line) continue;
            const msg = JSON.parse(line) as [number, PumpEvent, string | null, number | null] | { hello: string };
            if (!Array.isArray(msg)) {
              if (msg.hello !== epoch) ((epoch = msg.hello), (after = 0));
              continue;
            }
            const [seq, ev, tx, slot] = msg;
            if (seq <= after) continue;
            after = seq;
            if (!t.connected) {
              t.connected = true;
              delay = 1_000;
              log("[chain] relay live: pump.fun, LaunchLab and Meteora");
            }
            t.apply(ev, Date.now(), tx ?? undefined, slot ?? undefined);
          }
        }
      } catch (error) {
        if (!stopped) log(`[chain] relay error: ${(error as Error).message?.slice(0, 200)}`);
      } finally {
        clearInterval(stall);
      }
      t.connected = false;
      if (stopped) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60_000);
    }
  };
  void run();
  const pruner = setInterval(() => t.prune(), 10 * 60_000);
  return () => {
    stopped = true;
    clearInterval(pruner);
    ctl?.abort();
  };
}
