import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import {
  AccountAddress,
  AccountTransactionType,
  buildBasicAccountSigner,
  CcdAmount,
  ContractAddress,
  DataBlob,
  Energy,
  Parameter,
  ReceiveName,
  signTransaction,
  TransactionExpiry,
  TransactionHash,
  type AccountTransaction,
} from "@concordium/web-sdk";

/**
 * Concordium testnet, where ZOOAI's agents are made accountable: registered in the Agent Registry (CIS-8004) with
 * the "Verified by Concordium" badge, their signed log anchored once a day, and their checks sold over x402.
 * One account signs for the node; its key never leaves the server's environment.
 */

export const TESTNET = { caip2: "ccd:4221332d34e1694168c2a0c0b3fd0f27", host: "grpc.testnet.concordium.com", port: 20000, explorer: "https://ccdexplorer.io/testnet" };
export const AGENT_REGISTRY = ContractAddress.create(12802n, 0n);
const MCP = "https://agent-registry-mcp.concordium.com/mcp";

export interface Account {
  address: string;
  key: string;
}

export function accountFromEnv(env = process.env): Account | null {
  const address = env.CCD_ACCOUNT?.trim();
  const key = env.CCD_SIGN_KEY?.trim();
  return address && key && /^[0-9a-f]{64}$/i.test(key) ? { address, key } : null;
}

let client: ConcordiumGRPCNodeClient | null = null;
export function ccd(): ConcordiumGRPCNodeClient {
  client ??= new ConcordiumGRPCNodeClient(TESTNET.host, TESTNET.port, credentials.createSsl(), { timeout: 20_000 });
  return client;
}

export const txLink = (hash: string) => `${TESTNET.explorer}/transaction/${hash}`;

/** Calls a tool on Concordium's hosted Agent Registry MCP server, which builds registry transactions for us to sign. */
export async function registryTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { network: "testnet", ...args } } }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  // The server answers plain JSON or a one-event stream: take the JSON either way.
  const json = JSON.parse(text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5) : text) as { result?: { content?: Array<{ text: string }>; isError?: boolean }; error?: { message: string } };
  if (json.error || json.result?.isError) throw new Error(`registry ${name}: ${json.error?.message ?? json.result?.content?.[0]?.text}`);
  return JSON.parse(json.result!.content![0]!.text) as T;
}

/** Signs and sends one account transaction, waits for finalization, and returns its hash. */
async function send(account: Account, type: AccountTransactionType, payload: AccountTransaction["payload"]): Promise<string> {
  const sender = AccountAddress.fromBase58(account.address);
  const { nonce } = await ccd().getNextAccountNonce(sender);
  const tx = { type, header: { sender, nonce, expiry: TransactionExpiry.futureMinutes(5) }, payload } as AccountTransaction;
  const signature = await signTransaction(tx, buildBasicAccountSigner(account.key));
  const hash = await ccd().sendAccountTransaction(tx, signature);
  const outcome = await ccd().waitForTransactionFinalization(hash);
  const summary = outcome.summary as { type?: string; transactionType?: string; rejectReason?: { tag: string } };
  if (summary.transactionType === "failed" || summary.rejectReason) throw new Error(`rejected: ${summary.rejectReason?.tag ?? "unknown"} (${TransactionHash.toHexString(hash)})`);
  return TransactionHash.toHexString(hash);
}

/** Puts up to 256 bytes on chain with a RegisterData transaction. */
export function registerData(account: Account, bytes: Uint8Array): Promise<string> {
  if (bytes.length > 256) throw new Error("RegisterData takes at most 256 bytes");
  return send(account, AccountTransactionType.RegisterData, { data: new DataBlob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) } as AccountTransaction["payload"]);
}

/** Sends a contract update the registry's MCP server built. */
export function sendBuilt(account: Account, built: { contract_address: { index: number | string; subindex: number | string }; receive_name: string; parameter_hex: string; suggested_energy: number }): Promise<string> {
  return send(account, AccountTransactionType.Update, {
    amount: CcdAmount.zero(),
    address: ContractAddress.create(BigInt(built.contract_address.index), BigInt(built.contract_address.subindex)),
    receiveName: ReceiveName.fromString(built.receive_name),
    message: Parameter.fromHexString(built.parameter_hex),
    maxContractExecutionEnergy: Energy.create(built.suggested_energy),
  } as AccountTransaction["payload"]);
}

export async function balanceOf(address: string): Promise<number> {
  const info = await ccd().getAccountInfo(AccountAddress.fromBase58(address));
  return Number(info.accountAmount.microCcdAmount) / 1e6;
}
