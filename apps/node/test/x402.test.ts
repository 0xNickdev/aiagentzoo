import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { type Facilitator, NETWORKS, type Produced, verdictOf, X402Lane } from "../src/x402.ts";

const MINT = "So11111111111111111111111111111111111111112";
const PAY_TO = "AgUFH8RuBf1fx1v4jy8VG6TWChVzGHbzMhesaK7yDWMU";
const FEE_PAYER = "46At56F1xG5dWAzAPazQcJVTDTwobBnUi79z9PNYxQJr";

/** A facilitator that answers what the test tells it to, and remembers what it was asked. */
function fakeFacilitator(o: { valid?: boolean; settles?: boolean } = {}) {
  const calls = { verify: 0, settle: 0, requirements: [] as PaymentRequirements[] };
  const f: Facilitator = {
    async verify(_p, r) {
      calls.verify += 1;
      calls.requirements.push(r);
      return o.valid === false ? { isValid: false, invalidReason: "insufficient_funds" } : { isValid: true, payer: "AGENT" };
    },
    async settle(_p, r) {
      calls.settle += 1;
      return o.settles === false
        ? { success: false, errorReason: "transaction_failed", transaction: "", network: r.network }
        : { success: true, transaction: "SIG123", network: r.network, payer: "AGENT" };
    },
  };
  return { f, calls };
}

/** An in-memory store and log, the two things the lane writes to. */
function fakeEnclosure() {
  const kv = new Map<string, unknown>();
  const logged: unknown[] = [];
  return {
    logged,
    kv,
    enclosure: {
      store: { get: async (k: string) => kv.get(k), set: async (k: string, v: unknown) => void kv.set(k, v), delete: async (k: string) => void kv.delete(k) },
      log: { append: async (e: unknown) => void logged.push(e) },
      node: { id: "north.zoo", identity: { sign: () => "sig", publicKey: "pk" } },
    },
  };
}

async function serve(lane: X402Lane, produce: () => Promise<Produced>): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => void lane.handle(req, res, "xray", MINT, produce));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const at = server.address() as { port: number };
  return { url: `http://127.0.0.1:${at.port}/v1/x402/xray/${MINT}`, server };
}

const payment = (lane: X402Lane): string => {
  const accepted = lane.requirements(lane.routes.xray!);
  const p: PaymentPayload = { x402Version: 2, accepted, payload: { transaction: "base64tx" } };
  return encodePaymentSignatureHeader(p);
};

const REPORT = JSON.stringify({ mint: MINT, check: { verdict: "avoid", reasons: ["dev dumped 12 of 13"] } });

function laneWith(f: Facilitator, enclosure?: ReturnType<typeof fakeEnclosure>["enclosure"]) {
  // The fakes cover only what the lane touches.
  return new X402Lane({ network: "devnet", payTo: PAY_TO, feePayer: FEE_PAYER, facilitator: f, publicUrl: "https://north.example", ...(enclosure ? { enclosure: enclosure as never } : {}) });
}

test("without a payment the route answers 402 with what to pay, in the header and the body", async () => {
  const { f, calls } = fakeFacilitator();
  let built = 0;
  const { url, server } = await serve(laneWith(f), async () => (built++, { status: 200, body: REPORT }));
  try {
    const r = await fetch(url);
    assert.equal(r.status, 402);
    const required = decodePaymentRequiredHeader(r.headers.get("payment-required")!);
    assert.equal(required.x402Version, 2);
    const [req] = required.accepts;
    assert.equal(req!.network, NETWORKS.devnet.caip2);
    assert.equal(req!.asset, NETWORKS.devnet.usdc);
    assert.equal(req!.amount, "10000");
    assert.equal(req!.payTo, PAY_TO);
    assert.equal(req!.extra.feePayer, FEE_PAYER);
    assert.equal(required.resource.url, `https://north.example/v1/x402/xray/${MINT}`);
    assert.equal(built, 0, "no report is built for an unpaid request");
    assert.equal(calls.verify, 0);
  } finally {
    server.close();
  }
});

test("a payment that does not verify gets 402 with the reason, no report and no settlement", async () => {
  const { f, calls } = fakeFacilitator({ valid: false });
  let built = 0;
  const { url, server } = await serve(laneWith(f), async () => (built++, { status: 200, body: REPORT }));
  try {
    const r = await fetch(url, { headers: { "payment-signature": payment(laneWith(f)) } });
    assert.equal(r.status, 402);
    assert.match(decodePaymentRequiredHeader(r.headers.get("payment-required")!).error!, /insufficient_funds/);
    assert.equal(built, 0);
    assert.equal(calls.settle, 0);
  } finally {
    server.close();
  }
});

test("the client cannot name its own price: verification always runs against the route's requirements", async () => {
  const { f, calls } = fakeFacilitator();
  const lane = laneWith(f);
  const cheap: PaymentPayload = { x402Version: 2, accepted: { ...lane.requirements(lane.routes.xray!), amount: "1" }, payload: { transaction: "x" } };
  const { url, server } = await serve(lane, async () => ({ status: 200, body: REPORT }));
  try {
    await fetch(url, { headers: { "payment-signature": encodePaymentSignatureHeader(cheap) } });
    assert.equal(calls.requirements[0]!.amount, "10000");
  } finally {
    server.close();
  }
});

test("nothing to sell, nothing charged: a 404 report never settles the verified payment", async () => {
  const { f, calls } = fakeFacilitator();
  const { enclosure, kv } = fakeEnclosure();
  const { url, server } = await serve(laneWith(f, enclosure), async () => ({ status: 404, body: JSON.stringify({ error: "not on the stream" }) }));
  try {
    const r = await fetch(url, { headers: { "payment-signature": payment(laneWith(f)) } });
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("x402-charged"), "false");
    const body = (await r.json()) as { error: string; x402: string };
    assert.equal(body.error, "not on the stream");
    assert.match(body.x402, /not charged/);
    assert.equal(calls.verify, 1);
    assert.equal(calls.settle, 0);
    assert.equal((kv.get("x402:totals") as { refusedBeforeSettle: number }).refusedBeforeSettle, 1);
  } finally {
    server.close();
  }
});

test("a node error while building the report is not charged either", async () => {
  const { f, calls } = fakeFacilitator();
  const { url, server } = await serve(laneWith(f), async () => {
    throw new Error("rpc down");
  });
  try {
    const r = await fetch(url, { headers: { "payment-signature": payment(laneWith(f)) } });
    assert.equal(r.status, 502);
    assert.equal(r.headers.get("x402-charged"), "false");
    assert.equal(calls.settle, 0);
  } finally {
    server.close();
  }
});

test("a settlement that fails withholds the report and says why", async () => {
  const { f } = fakeFacilitator({ settles: false });
  const { url, server } = await serve(laneWith(f), async () => ({ status: 200, body: REPORT }));
  try {
    const r = await fetch(url, { headers: { "payment-signature": payment(laneWith(f)) } });
    assert.equal(r.status, 402);
    const text = await r.text();
    assert.ok(!text.includes("dev dumped"), "the report is not leaked when payment did not land");
    assert.match(decodePaymentRequiredHeader(r.headers.get("payment-required")!).error!, /transaction_failed/);
    assert.equal(decodePaymentResponseHeader(r.headers.get("payment-response")!).success, false);
  } finally {
    server.close();
  }
});

test("a paid request gets the report, the transaction, and a receipt hashed into the public log", async () => {
  const { f, calls } = fakeFacilitator();
  const { enclosure, logged } = fakeEnclosure();
  const lane = laneWith(f, enclosure);
  const { url, server } = await serve(lane, async () => ({ status: 200, body: REPORT }));
  try {
    const r = await fetch(url, { headers: { "payment-signature": payment(lane) } });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), REPORT);
    assert.equal(decodePaymentResponseHeader(r.headers.get("payment-response")!).transaction, "SIG123");
    const sha = createHash("sha256").update(REPORT).digest("hex");
    assert.equal(r.headers.get("x-report-sha256"), sha);
    assert.equal(calls.settle, 1);
    const { totals, receipts } = await lane.receipts();
    assert.equal(totals.paid, 1);
    assert.equal(totals.usdc, 0.01);
    assert.deepEqual({ ...receipts[0], at: 0 }, { at: 0, route: "xray", mint: MINT, amount: "10000", asset: NETWORKS.devnet.usdc, network: NETWORKS.devnet.caip2, payer: "AGENT", transaction: "SIG123", reportSha256: sha, verdict: "avoid" });
    assert.equal(logged.length, 1);
  } finally {
    server.close();
  }
});

test("the verdict is read from an x-ray and from a plain check", () => {
  assert.equal(verdictOf(REPORT), "avoid");
  assert.equal(verdictOf(JSON.stringify({ verdict: "caution" })), "caution");
  assert.equal(verdictOf("not json"), null);
});
