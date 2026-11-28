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

declare global {
  interface Window {
    okxwallet?: { solana?: SolanaProvider };
    coinbaseSolana?: SolanaProvider;
    trustwallet?: { solana?: SolanaProvider };
    jupiter?: { solana?: SolanaProvider };
  }
}

export interface WalletOption {
  id: string;
  name: string;
  provider: SolanaProvider;
}

const standardAdapters = new Map<StandardWallet, SolanaProvider>();
const isStandardSolana = (x: StandardWallet) => x.chains.some((c) => c.startsWith("solana:")) && !!x.features["standard:connect"] && !!x.features["solana:signMessage"];
const norm = (n: string) => n.toLowerCase().replace(/[^a-z]/g, "").replace(/wallet$/, "");

/** Every Solana wallet on the page: injected globals first, then Wallet Standard wallets not already listed. */
export function listWallets(): WalletOption[] {
  if (typeof window === "undefined") return [];
  const out: WalletOption[] = [];
  const seen = new Set<unknown>();
  const add = (id: string, name: string, p: SolanaProvider | undefined) => {
    if (!p || seen.has(p) || typeof p.connect !== "function" || typeof p.signMessage !== "function") return;
    seen.add(p);
    out.push({ id, name, provider: p });
  };
  const w = window;
  add("phantom", "Phantom", w.phantom?.solana);
  add("okx", "OKX Wallet", w.okxwallet?.solana);
  add("backpack", "Backpack", w.backpack?.solana);
  add("solflare", "Solflare", w.solflare);
  add("jupiter", "Jupiter", w.jupiter?.solana);
  add("coinbase", "Coinbase Wallet", w.coinbaseSolana);
  add("trust", "Trust Wallet", w.trustwallet?.solana);
  for (const sw of standardWallets.filter(isStandardSolana)) {
    if (out.some((o) => norm(o.name) === norm(sw.name))) continue;
    let p = standardAdapters.get(sw);
    if (!p) standardAdapters.set(sw, (p = fromStandard(sw)));
    add(`std:${sw.name}`, sw.name, p);
  }
  const generic = w.solana;
  if (generic && !seen.has(generic)) {
    const g = generic as SolanaProvider & Record<string, unknown>;
    const name = g.isOkxWallet || g.isOKExWallet ? "OKX Wallet" : g.isTrust || g.isTrustWallet ? "Trust Wallet" : g.isCoinbaseWallet ? "Coinbase Wallet" : g.isBackpack ? "Backpack" : "Solana wallet";
    if (!out.some((o) => o.name === name)) add("solana", name, generic);
  }
  return out;
}

const WALLET_KEY = "aiagentzoo:wallet";
let chosenId: string | null = (() => {
  try {
    return localStorage.getItem(WALLET_KEY);
  } catch {
    return null;
  }
})();
function choose(id: string | null) {
  chosenId = id;
  try {
    if (id) localStorage.setItem(WALLET_KEY, id);
    else localStorage.removeItem(WALLET_KEY);
  } catch {
    /* storage blocked */
  }
}

function provider(): SolanaProvider | undefined {
  const all = listWallets();
  return (all.find((o) => o.id === chosenId) ?? all[0])?.provider;
}
/** The injected wallet, for the swap: connect, sign and send, no session needed. */
export const walletProvider = provider;

const B58MAP = new Map([...B58].map((c, i) => [c, i]));
function fromBase58(str: string): Uint8Array | null {
  let n = 0n;
  for (const c of str) {
    const v = B58MAP.get(c);
    if (v === undefined) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const c of str) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

/** Wallets hand the signature back in different shapes: bytes, {signature}, number arrays, base58, hex or base64 strings. */
export function signatureBytes(out: unknown): Uint8Array {
  let v: unknown = out;
  if (v && typeof v === "object" && !(v instanceof Uint8Array) && !Array.isArray(v) && "signature" in v) v = (v as { signature: unknown }).signature;
  if (v && typeof v === "object" && !(v instanceof Uint8Array) && !Array.isArray(v) && "data" in v) v = (v as { data: unknown }).data;
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  if (typeof v === "string") {
    const s = v.trim();
    if (/^(0x)?[0-9a-fA-F]{128}$/.test(s)) return Uint8Array.from(s.replace(/^0x/, "").match(/../g)!.map((h) => parseInt(h, 16)));
    const b58 = fromBase58(s);
    if (b58 && b58.length === 64) return b58;
    try {
      const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
      if (bin.length === 64) return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch {
      /* not base64 */
    }
  }
  throw new Error("The wallet returned a signature this site cannot read.");
}

/* ---------- wallet picker ---------- */

export type PickerState = { mode: "pick"; wallets: WalletOption[] } | { mode: "none" } | null;
let picker: PickerState = null;
let pickerResolve: ((w: WalletOption | null) => void) | null = null;
const pickerListeners = new Set<(p: PickerState) => void>();
function setPicker(p: PickerState) {
  picker = p;
  for (const l of pickerListeners) l(p);
}
/** Called by the picker UI: a wallet, or null for cancel. */
export function resolvePicker(w: WalletOption | null) {
  const r = pickerResolve;
  pickerResolve = null;
  setPicker(null);
  r?.(w);
}
export function usePicker(): PickerState {
  const [p, setP] = useState<PickerState>(picker);
  useEffect(() => {
    pickerListeners.add(setP);
    return () => void pickerListeners.delete(setP);
  }, []);
  return p;
}
function askWallet(wallets: WalletOption[]): Promise<WalletOption | null> {
  pickerResolve?.(null);
  return new Promise((res) => {
    pickerResolve = res;
    setPicker(wallets.length ? { mode: "pick", wallets } : { mode: "none" });
  });
}

/** Links that reopen this page inside a wallet app's browser, for phones without an injected wallet. */
export function walletAppLinks(): Array<{ name: string; href: string }> {
  const url = window.location.href;
  return [
    { name: "Phantom", href: `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(window.location.origin)}` },
    { name: "OKX Wallet", href: `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(url)}` },
    { name: "Solflare", href: `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(window.location.origin)}` },
  ];
}
export const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

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

  const signIn = useCallback(async (opts?: { switching?: boolean }) => {
    setError(null);
    const wallets = listWallets();
    let option: WalletOption | null | undefined = opts?.switching ? undefined : wallets.find((o) => o.id === chosenId);
    if (!option && wallets.length === 1 && !opts?.switching) option = wallets[0];
    if (!option) option = await askWallet(wallets);
    if (!option) return;
    choose(option.id);
    const wallet = option.provider;
    setBusy(true);
    try {
      const connected = await (wallet.connect as (o?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toString(): string } } | undefined>)({ onlyIfTrusted: false });
      const key = connected?.publicKey ?? wallet.publicKey;
      if (!key) throw new Error("The wallet gave no account.");
      const address = key.toString();
      const issued = new Date();
      const expires = new Date(issued.getTime() + SESSION_MS);
      const message = sessionMessage(address, issued.toISOString(), expires.toISOString());
      const bytes = signatureBytes(await wallet.signMessage(new TextEncoder().encode(message), "utf8"));
      publish({ publicKey: address, message, signature: btoa(String.fromCharCode(...bytes)), expiresAt: expires.getTime() });
    } catch (e) {
      setError((e as Error).message || "Signing was cancelled.");
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    publish(null);
    try {
      await provider()?.disconnect?.();
    } catch {
      /* some wallets throw on disconnect */
    }
  }, []);

  /** Sign out, then sign in again with a wallet and account picked fresh. */
  const switchWallet = useCallback(async () => {
    await signOut();
    await signIn({ switching: true });
  }, [signOut, signIn]);

  return { session, signIn: () => signIn(), signOut, switchWallet, error, busy };
}

export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
