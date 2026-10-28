import { useCallback, useEffect, useState } from "react";
import { NODE_URLS } from "./sim/live";

/* ---------- node directory ---------- */

export interface NodeInfo {
  id: string;
  name: string;
  url: string;
  visitorAgents: string[];
  agents: string[];
}

let directory: Promise<NodeInfo[]> | null = null;

/** Which node hosts which agent, discovered from the nodes themselves. */
export function loadDirectory(): Promise<NodeInfo[]> {
  directory ??= Promise.all(
    NODE_URLS.map(async (url) => {
      const [node, agents] = await Promise.all([
        fetch(`${url}/v1/node`).then((r) => r.json()),
        fetch(`${url}/v1/agents`).then((r) => r.json()),
      ]);
      return {
        id: node.id as string,
        name: node.name as string,
        url,
        visitorAgents: (node.visitorAgents ?? []) as string[],
        agents: (agents as Array<{ name: string }>).map((a) => a.name),
      };
    }),
  ).catch((error) => {
    directory = null;
    throw error;
  });
  return directory;
}

export async function nodeOf(agent: string): Promise<NodeInfo | undefined> {
  return (await loadDirectory()).find((n) => n.agents.includes(agent));
}

/* ---------- guardian wallet ---------- */

interface SolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect?(): Promise<void>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
  /** Signs and sends a (versioned) transaction; Phantom, Solflare and Backpack all have it. */
  signAndSendTransaction?(transaction: unknown, options?: unknown): Promise<{ signature: string } | string>;
}

declare global {
  interface Window {
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider;
    backpack?: { solana?: SolanaProvider };
    solana?: SolanaProvider;
  }
}

/**
 * Wallets that announce themselves through the Wallet Standard instead of a window global: Jupiter Wallet and most new
 * Solana wallets. The page asks them to register once it loads; any wallet that loads later registers on its own.
 */
interface StandardAccount {
  address: string;
}
interface StandardWallet {
  name: string;
  chains: readonly string[];
  accounts: readonly StandardAccount[];
  features: Record<string, unknown>;
}
const standardWallets: StandardWallet[] = [];
if (typeof window !== "undefined") {
  const api = {
    register: (...wallets: StandardWallet[]) => {
      for (const w of wallets) if (!standardWallets.includes(w)) standardWallets.push(w);
      return () => {};
    },
  };
  window.addEventListener("wallet-standard:register-wallet", (e) => {
    try {
      ((e as CustomEvent).detail as (a: typeof api) => void)(api);
    } catch {
      /* a wallet that registers badly is skipped */
    }
  });
  try {
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
  } catch {
    /* no CustomEvent: no standard wallets */
  }
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** A Wallet Standard wallet, shaped like the injected providers the rest of the site already speaks to. */
function fromStandard(w: StandardWallet): SolanaProvider {
  type Feature<T> = Record<string, T> | undefined;
  const f = w.features;
  let account: StandardAccount | undefined = w.accounts[0];
  const connect = (f["standard:connect"] as Feature<(input?: unknown) => Promise<{ accounts: readonly StandardAccount[] }>>)?.connect;
  const disconnect = (f["standard:disconnect"] as Feature<() => Promise<void>>)?.disconnect;
  const signMessage = (f["solana:signMessage"] as Feature<(...inputs: Array<{ account: StandardAccount; message: Uint8Array }>) => Promise<Array<{ signature: Uint8Array }>>>)?.signMessage;
  const signAndSend = (f["solana:signAndSendTransaction"] as Feature<(...inputs: Array<{ account: StandardAccount; transaction: Uint8Array; chain: string }>) => Promise<Array<{ signature: Uint8Array }>>>)?.signAndSendTransaction;
  const key = () => ({ toString: () => account!.address });
  return {
    get publicKey() {
      return account ? key() : null;
    },
    async connect(opts?: { onlyIfTrusted?: boolean }) {
      // A silent reconnect (Phantom's onlyIfTrusted) is the standard's `silent`: no window if the site is not trusted yet.
      const r = connect ? await connect(opts?.onlyIfTrusted ? { silent: true } : undefined) : { accounts: w.accounts };
      account = r.accounts[0] ?? w.accounts[0];
      if (!account) throw new Error(`${w.name} gave no account`);
      return { publicKey: key() };
    },
    async disconnect() {
      await disconnect?.();
      account = undefined;
    },
    async signMessage(message: Uint8Array) {
      if (!signMessage || !account) throw new Error(`${w.name} cannot sign messages`);
      const [out] = await signMessage({ account, message });
      return { signature: out!.signature };
    },
    ...(signAndSend
      ? {
          async signAndSendTransaction(transaction: unknown) {
            if (!account) throw new Error("connect the wallet first");
            const bytes = (transaction as { serialize(): Uint8Array }).serialize();
            const [out] = await signAndSend({ account, transaction: bytes, chain: "solana:mainnet" });
            return { signature: base58(out!.signature) };
          },
        }
      : {}),
  };
}

/** The first Solana wallet in the standard list that can connect and sign a message. */
function standardProvider(): SolanaProvider | undefined {
  const w = standardWallets.find((x) => x.chains.some((c) => c.startsWith("solana:")) && x.features["standard:connect"] && x.features["solana:signMessage"]);
  return w ? fromStandard(w) : undefined;
}

let standardCached: { wallet: StandardWallet; provider: SolanaProvider } | null = null;
function provider(): SolanaProvider | undefined {
  const injected = window.phantom?.solana ?? window.solflare ?? window.backpack?.solana;
  if (injected) return injected;
  // The same standard wallet keeps one adapter, so a connect and the signature after it share the account.
  const first = standardWallets.find((x) => x.chains.some((c) => c.startsWith("solana:")) && x.features["standard:connect"] && x.features["solana:signMessage"]);
  if (first) {
    if (standardCached?.wallet !== first) standardCached = { wallet: first, provider: fromStandard(first) };
    return standardCached.provider;
  }
  return window.solana ?? standardProvider();
}
/** The injected wallet, for the swap: connect, sign and send, no session needed. */
export const walletProvider = provider;

export interface GuardianSession {
  publicKey: string;
  message: string;
  signature: string;
  expiresAt: number;
}

/** Must match `sessionMessage` in apps/node/src/guardian.ts byte for byte. */
function sessionMessage(publicKey: string, issuedAt: string, expiresAt: string): string {
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

const STORAGE_KEY = "aiagentzoo:guardian";
const SESSION_MS = 12 * 60 * 60 * 1000;

function readSession(): GuardianSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const session = raw ? (JSON.parse(raw) as GuardianSession) : null;
    return session && session.expiresAt > Date.now() + 60_000 ? session : null;
  } catch {
    return null;
  }
}

function writeSession(session: GuardianSession | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the session lives for this page only.
  }
}

const listeners = new Set<(s: GuardianSession | null) => void>();
let current: GuardianSession | null = readSession();

function publish(session: GuardianSession | null) {
  current = session;
  writeSession(session);
  for (const l of listeners) l(session);
}

export function useGuardian() {
  const [session, setSession] = useState<GuardianSession | null>(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listeners.add(setSession);
    return () => void listeners.delete(setSession);
  }, []);

  const signIn = useCallback(async () => {
    const wallet = provider();
    if (!wallet) {
      window.open("https://phantom.com/download", "_blank", "noopener");
      setError("Install a Solana wallet such as Phantom, Jupiter or Solflare, then try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { publicKey } = await wallet.connect();
      const address = publicKey.toString();
      const issued = new Date();
      const expires = new Date(issued.getTime() + SESSION_MS);
      const message = sessionMessage(address, issued.toISOString(), expires.toISOString());
      const signed = await wallet.signMessage(new TextEncoder().encode(message), "utf8");
      const bytes = signed instanceof Uint8Array ? signed : signed.signature;
      publish({ publicKey: address, message, signature: btoa(String.fromCharCode(...bytes)), expiresAt: expires.getTime() });
    } catch (e) {
      setError((e as Error).message || "Signing was cancelled.");
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(() => {
    void provider()?.disconnect?.();
    publish(null);
  }, []);

  return { session, signIn, signOut, error, busy };
}

export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/* ---------- waking ---------- */

export type WakeResult = { ok: true; by: string } | { ok: false; error: string; retryAfterMs?: number };

export async function wakeAgent(agent: string, session: GuardianSession | null): Promise<WakeResult> {
  const node = await nodeOf(agent);
  if (!node) return { ok: false, error: "node unreachable" };
  const res = await fetch(`${node.url}/v1/visitor/wake/${agent}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      session ? { guardian: { publicKey: session.publicKey, message: session.message, signature: session.signature } } : {},
    ),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, by: body.by };
  return { ok: false, error: body.error ?? `HTTP ${res.status}`, retryAfterMs: body.retryAfterMs };
}

/* ---------- passports ---------- */

export interface Passport {
  name: string;
  node: string;
  species: string;
  status: string;
  nextRunAt: number | null;
  firstSeen: number | null;
  wakes: number;
  wokenBy: Record<"schedule" | "signal" | "visitor" | "guardian" | "warden", number>;
  cycles: number;
  feedSpent: number;
  signalsSent: number;
  signalsAccepted: number;
  signalsRejected: number;
  signalsReceived: number;
  artifacts: number;
  stops: number;
  lastSteps: Array<{ seq: number; ts: number; kind: string; type: string; summary: string }>;
}

export async function loadPassport(agent: string): Promise<Passport> {
  const node = await nodeOf(agent);
  if (!node) throw new Error("node unreachable");
  const res = await fetch(`${node.url}/v1/agents/${agent}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
