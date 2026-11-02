import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import bs58 from "bs58";
import { createEvent, type Enclosure, signEvent } from "@aiagentzoo/sdk";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";

/**
 * x402 on Solana: an agent pays per X-Ray in USDC over plain HTTP, no account, no key, no subscription.
 *
 * The flow on a paid route:
 *   1. no payment header           -> 402 with PAYMENT-REQUIRED (what to pay, to whom, in which token, on which network)
 *   2. PAYMENT-SIGNATURE arrives   -> the facilitator verifies the partly signed USDC transfer (amount, mint, payee, simulation)
 *   3. the report is built         -> if there is nothing to sell (unknown token, node error) the payment is never settled
 *   4. the facilitator settles     -> co-signs as fee payer, submits, waits for confirmation
 *   5. 200 with the report         -> PAYMENT-RESPONSE carries the transaction; X-Report-Sha256 the hash of what was sold
 *
 * The node is its own facilitator: its fee payer wallet pays the network fee, so the agent needs USDC and nothing else.
 * Every sale leaves a receipt in the node's signed, hash-chained public log with the hash of the exact report sold,
 * so what the zoo said for money can be checked later against what the coin did.
 */

export const NETWORKS = {
  devnet: { caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", rpc: "https://api.devnet.solana.com", cluster: "devnet" },
  mainnet: { caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", usdc: "EPjFWdd5AufqSSqeM2qJ6CNvzWBaCnGkjjXxkz6sVhvQ", rpc: "https://api.mainnet-beta.solana.com", cluster: "mainnet-beta" },
} as const;
export type NetworkName = keyof typeof NETWORKS;

/** What the lane needs from a facilitator: the two calls of the x402 facilitator interface. */
export interface Facilitator {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
}

export interface PaidRoute {
  id: string;
  /** Price in USDC atomic units (6 decimals): "10000" is 0.01 USDC. */
  amount: string;
  description: string;
}

export const PAID_ROUTES: Record<string, PaidRoute> = {
  xray: { id: "xray", amount: "10000", description: "Full X-Ray of a memecoin: the dev and their other launches, who paid the dev, the first-seconds wallets, holders, bundles, where the SOL went, and the odds minute five gives." },
  check: { id: "check", amount: "1000", description: "Pre-trade check of a memecoin: verdict, plain reasons and odds, in milliseconds. Call it before every swap." },
};

export interface Receipt {
  at: number;
  route: string;
  mint: string;
  amount: string;
  asset: string;
  network: string;
  payer: string;
  transaction: string;
  /** sha256 of the exact JSON body delivered for this payment. */
  reportSha256: string;
  verdict: string | null;
}

/** What the lane got back from the node for a paid route: the body is what gets sold, byte for byte. */
export interface Produced {
  status: number;
  body: string;
}

export interface LaneOptions {
  network: NetworkName;
  payTo: string;
  feePayer: string;
  facilitator: Facilitator;
  enclosure?: Pick<Enclosure, "store" | "log" | "node">;
  /** Public base URL the 402 names as the resource (e.g. https://north.zooaiagency.com). */
  publicUrl: string;
  routes?: Record<string, PaidRoute>;
  now?: () => number;
}

const RECEIPTS = "x402:receipts";
const TOTALS = "x402:totals";
const KEEP = 1000;

const atomicToUsdc = (a: string | number) => Number(a) / 1e6;

export class X402Lane {
  readonly network: NetworkName;
  readonly payTo: string;
  readonly feePayer: string;
  private readonly facilitator: Facilitator;
  private readonly enclosure: LaneOptions["enclosure"];
  private readonly publicUrl: string;
  readonly routes: Record<string, PaidRoute>;
  private readonly now: () => number;
  /** Receipts kept in memory too, so a burst of sales does not race the store. */
  private recent: Receipt[] | null = null;
  private totals: { paid: number; usdc: number; refusedBeforeSettle: number; settleFailed: number } | null = null;

  constructor(o: LaneOptions) {
    this.network = o.network;
    this.payTo = o.payTo;
    this.feePayer = o.feePayer;
    this.facilitator = o.facilitator;
    this.enclosure = o.enclosure;
    this.publicUrl = o.publicUrl.replace(/\/$/, "");
    this.routes = o.routes ?? PAID_ROUTES;
    this.now = o.now ?? Date.now;
  }

  requirements(route: PaidRoute): PaymentRequirements {
    const net = NETWORKS[this.network];
    return { scheme: "exact", network: net.caip2, asset: net.usdc, amount: route.amount, payTo: this.payTo, maxTimeoutSeconds: 60, extra: { feePayer: this.feePayer } };
  }

  paymentRequired(route: PaidRoute, mint: string, error?: string): PaymentRequired {
    return {
      x402Version: 2,
      ...(error ? { error } : {}),
      resource: { url: `${this.publicUrl}/v1/x402/${route.id}/${mint}`, description: route.description, mimeType: "application/json" },
      accepts: [this.requirements(route)],
    };
  }

  /** The machine-readable menu: what is for sale, at what price, paid how. */
  info() {
    const net = NETWORKS[this.network];
    return {
      x402Version: 2,
      network: net.caip2,
      cluster: net.cluster,
      asset: { symbol: "USDC", mint: net.usdc, decimals: 6 },
      payTo: this.payTo,
      feePayer: this.feePayer,
      facilitator: "built in: the node verifies, co-signs as fee payer and settles itself",
      resources: Object.values(this.routes).map((r) => ({
        url: `${this.publicUrl}/v1/x402/${r.id}/{mint}`,
        method: "GET",
        price: { amount: r.amount, usdc: atomicToUsdc(r.amount) },
        description: r.description,
      })),
      guarantees: [
        "you are charged only when a report is delivered: a token the zoo knows nothing about, or a node error, never settles your payment",
        "every sale is a receipt in the node's signed public log, with the sha256 of the exact report you got",
      ],
      receipts: `${this.publicUrl}/v1/x402/receipts`,
      docs: "https://zooaiagency.com/x402",
    };
  }

  private async load(): Promise<void> {
    if (this.recent && this.totals) return;
    this.recent = (await this.enclosure?.store.get<Receipt[]>(RECEIPTS)) ?? [];
    this.totals = (await this.enclosure?.store.get<NonNullable<X402Lane["totals"]>>(TOTALS)) ?? { paid: 0, usdc: 0, refusedBeforeSettle: 0, settleFailed: 0 };
  }

  async receipts(limit = 50) {
    await this.load();
    return { totals: this.totals!, receipts: this.recent!.slice(0, limit) };
  }

  private async count(field: "refusedBeforeSettle" | "settleFailed"): Promise<void> {
    await this.load();
    this.totals![field] += 1;
    await this.enclosure?.store.set(TOTALS, this.totals);
  }

  private async record(r: Receipt): Promise<void> {
    await this.load();
    this.recent!.unshift(r);
    if (this.recent!.length > KEEP) this.recent!.length = KEEP;
    this.totals!.paid += 1;
    this.totals!.usdc = Math.round((this.totals!.usdc + atomicToUsdc(r.amount)) * 1e6) / 1e6;
    await this.enclosure?.store.set(RECEIPTS, this.recent);
    await this.enclosure?.store.set(TOTALS, this.totals);
    const e = this.enclosure;
    if (e) await e.log.append(signEvent(createEvent({ kind: "system", type: "x402.sale", from: { node: e.node.id, agent: "raven" }, payload: r }), e.node.identity));
  }

  /**
   * Serves one paid request. `produce` builds the report only after the payment verified; it is settled only when
   * the report came back 200, and the bytes sold are exactly the bytes hashed into the receipt.
   */
  async handle(req: IncomingMessage, res: ServerResponse, routeId: string, mint: string, produce: () => Promise<Produced>): Promise<void> {
    const route = this.routes[routeId];
    if (!route) return send(res, 404, { error: "no such paid route" });
    const header = req.headers["payment-signature"] ?? req.headers["x-payment"];
    if (!header) return this.ask(res, route, mint);
    if (req.headers["x-payment"] && !req.headers["payment-signature"]) return this.ask(res, route, mint, "x402 v1 headers are not accepted here: send PAYMENT-SIGNATURE (x402 v2)");

    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(String(header));
    } catch {
      return this.ask(res, route, mint, "invalid_payload: PAYMENT-SIGNATURE is not a base64 x402 payment payload");
    }
    // The requirements are always ours: whatever the client says it accepted, it pays what this route costs.
    const requirements = this.requirements(route);
    const verified = await this.facilitator.verify(payload, requirements).catch((e: unknown) => ({ isValid: false, invalidReason: "verify_error", invalidMessage: String((e as Error)?.message ?? e) }) as VerifyResponse);
    if (!verified.isValid) return this.ask(res, route, mint, [verified.invalidReason, verified.invalidMessage].filter(Boolean).join(": ") || "invalid payment");

    // Nothing to sell, nothing charged: the signed transfer is simply never submitted and expires with its blockhash.
    const produced = await produce().catch((e: unknown) => ({ status: 502, body: JSON.stringify({ error: String((e as Error)?.message ?? e) }) }));
    if (produced.status !== 200) {
      await this.count("refusedBeforeSettle");
      res.writeHead(produced.status, { "content-type": "application/json", "x402-charged": "false" });
      return void res.end(withNote(produced.body, "not charged: your payment was verified but never settled, because there was no report to deliver"));
    }
    // A token the zoo knows nothing about is an answer, not a report: it goes out free and the payment never lands.
    if (verdictOf(produced.body) === "unknown") {
      await this.count("refusedBeforeSettle");
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x402-charged": "false" });
      return void res.end(withNote(produced.body, "not charged: the zoo has nothing on this token yet, so your payment was never settled"));
    }

    const settled = await this.facilitator.settle(payload, requirements).catch((e: unknown) => ({ success: false, errorReason: "settle_error", errorMessage: String((e as Error)?.message ?? e), transaction: "", network: requirements.network }) as SettleResponse);
    if (!settled.success) {
      await this.count("settleFailed");
      return this.ask(res, route, mint, [settled.errorReason, settled.errorMessage].filter(Boolean).join(": ") || "settlement failed", settled);
    }

    const reportSha256 = createHash("sha256").update(produced.body).digest("hex");
    await this.record({
      at: this.now(),
      route: route.id,
      mint,
      amount: route.amount,
      asset: requirements.asset,
      network: requirements.network,
      payer: settled.payer ?? verified.payer ?? "",
      transaction: settled.transaction,
      reportSha256,
      verdict: verdictOf(produced.body),
    }).catch(() => undefined);
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "payment-response": encodePaymentResponseHeader(settled),
      "x-report-sha256": reportSha256,
      "x402-charged": "true",
    });
    res.end(produced.body);
  }

  private ask(res: ServerResponse, route: PaidRoute, mint: string, error?: string, settle?: SettleResponse): void {
    const body = this.paymentRequired(route, mint, error);
    const headers: Record<string, string> = { "content-type": "application/json", "payment-required": encodePaymentRequiredHeader(body), "cache-control": "no-store" };
    if (settle) headers["payment-response"] = encodePaymentResponseHeader(settle);
    res.writeHead(402, headers);
    res.end(JSON.stringify({ ...body, how: "pay with any x402 v2 client (e.g. @x402/fetch with @x402/svm): it reads PAYMENT-REQUIRED, signs a USDC transfer and retries with PAYMENT-SIGNATURE", menu: `${this.publicUrl}/v1/x402` }));
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function withNote(body: string, note: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return JSON.stringify({ ...parsed, x402: note });
  } catch {
    /* not JSON: wrap it */
  }
  return JSON.stringify({ error: body, x402: note });
}

/** The verdict the sold report carried: an X-Ray holds it under check, a plain check at the top. */
export function verdictOf(body: string): string | null {
  try {
    const r = JSON.parse(body) as { verdict?: unknown; check?: { verdict?: unknown } };
    const v = r.check?.verdict ?? r.verdict;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** A secret key from the environment: a JSON byte array (solana-keygen's file format) or base58. */
export function secretKeyBytes(raw: string): Uint8Array {
  const s = raw.trim();
  const bytes = s.startsWith("[") ? Uint8Array.from(JSON.parse(s) as number[]) : Uint8Array.from(bs58.decode(s));
  if (bytes.length !== 64) throw new Error("X402_FACILITATOR_KEY must be a 64-byte Solana secret key");
  return bytes;
}

/**
 * The lane from the environment, or null when x402 is off. X402_FACILITATOR_KEY (the fee payer's secret key) and
 * X402_PAY_TO (the wallet that receives USDC) turn it on; X402_NETWORK picks devnet (default) or mainnet.
 */
export async function laneFromEnv(enclosure: LaneOptions["enclosure"], env = process.env): Promise<X402Lane | null> {
  const key = env.X402_FACILITATOR_KEY;
  const payTo = env.X402_PAY_TO;
  if (!key || !payTo) return null;
  const network: NetworkName = env.X402_NETWORK === "mainnet" ? "mainnet" : "devnet";
  const [{ createKeyPairSignerFromBytes }, { x402Facilitator }, { toFacilitatorSvmSigner }, { registerExactSvmScheme }] = await Promise.all([
    import("@solana/kit"),
    import("@x402/core/facilitator"),
    import("@x402/svm"),
    import("@x402/svm/exact/facilitator"),
  ]);
  const signer = await createKeyPairSignerFromBytes(secretKeyBytes(key));
  const facilitator = new x402Facilitator();
  registerExactSvmScheme(facilitator, { signer: toFacilitatorSvmSigner(signer, { defaultRpcUrl: env.X402_RPC_URL || NETWORKS[network].rpc }), networks: NETWORKS[network].caip2 });
  return new X402Lane({ network, payTo, feePayer: signer.address, facilitator, enclosure, publicUrl: env.X402_PUBLIC_URL || "https://north.zooaiagency.com" });
}
