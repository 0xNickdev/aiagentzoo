# ZOO GUARD: a seatbelt for trading agents, paid per call over x402

A trading agent is about to buy a memecoin. Before the swap it asks ZOOAI who is behind the coin and pays for the
answer per request in USDC on Solana. No API key, no account, no subscription: plain HTTP with
[x402](https://x402.org) v2.

```
agent                                   north.zooaiagency.com                         Solana
  | GET /v1/x402/check/<mint>                  |                                         |
  |------------------------------------------->|                                         |
  | 402 + PAYMENT-REQUIRED (0.001 USDC, payTo) |                                         |
  |<-------------------------------------------|                                         |
  | signs a USDC TransferChecked (partly)      |                                         |
  | GET + PAYMENT-SIGNATURE                    |                                         |
  |------------------------------------------->| verify: amount, mint, payee, simulate   |
  |                                            | build the report                        |
  |                                            | settle: co-sign as fee payer, submit -->|
  |                                            |<-------------------------- confirmed ---|
  | 200 report + PAYMENT-RESPONSE (tx)         |                                         |
  |     + X-Report-Sha256                      | receipt -> signed public log            |
  |<-------------------------------------------|                                         |
  | avoid? refuse the swap                     |                                         |
```

## Run it (devnet)

```bash
cd examples/x402-agent
npm install
npm run keygen          # writes agent.json and prints its address
# fund that address with devnet USDC: https://faucet.circle.com -> Solana Devnet (no SOL needed, the node pays the fee)
npm run guard -- <mint> [<mint> ...]     # 0.001 USDC per check
npm run guard -- --xray <mint>           # 0.01 USDC full X-Ray
```

Real output against the live node (devnet USDC, mainnet memecoins):

```
agent BKZEZmfJLghn7aZwQnfi5mgA6GfquFqTjwLx1NgPNm4u on devnet; prices: xray 0.01 USDC, check 0.001 USDC

$PIRATE  CAUTION  -> trade small, set a tight exit
  - 7 serial snipers got in first: wallets that buy launches in the first seconds to sell to whoever comes next
  odds it runs: 6% (2.3x the average), dev still dumps: 56%
  paid 24jQFjtHAJnVu4qd... https://explorer.solana.com/tx/24jQFjtHAJnVu4qdHCvahCfj4mpnkgHKn1cqkpHUmMKqhRsg6BEiwayjKwxtoVxAGpuZ71WciGiHixZCfC7aAErT?cluster=devnet

$$LOAD  AVOID  -> REFUSE the swap
  - the creator sold 100% of their own bag
  - this creator dumped 1298 of their 1298 launches in 48 hours, usually 0 min after launch
  paid TXHmtEq4dEJVqAY7... https://explorer.solana.com/tx/TXHmtEq4dEJVqAY74iRoT56RzdU2o21pTqrmzRi4NGakx27UGerTYLaizziUtoTY7vdUCgChBP8u81SAXiaN4os?cluster=devnet
```

## What you pay for, and when you are not charged

| Route | Price | What comes back |
|---|---|---|
| `GET /v1/x402/check/<mint>` | 0.001 USDC | verdict, plain reasons, odds it runs and that the dev still dumps |
| `GET /v1/x402/xray/<mint>` | 0.01 USDC | the full X-Ray: dev and their other launches, who paid the dev, first-seconds wallets, holders, bundles, where the SOL went |
| `GET /v1/x402` | free | the menu: network, USDC mint, payee, fee payer, prices |
| `GET /v1/x402/receipts` | free | every sale: payer, transaction, mint, verdict, sha256 of the report sold |

The node verifies the payment first, builds the report, and **settles only when there is a report to deliver**:

- invalid or underfunded payment: `402` with the reason in `PAYMENT-REQUIRED.error`, nothing built
- a token the zoo knows nothing about (`verdict: unknown`): the answer goes out free, `x402-charged: false`
- the node fails to build the report (404, RPC down): that status, `x402-charged: false`, the signed transfer is never submitted and expires with its blockhash
- settlement fails on chain: `402` with the reason, the report is withheld
- the client cannot pick its own price: verification always runs against the route's own requirements

Every sale is appended to the node's signed, hash-chained public log (`x402.sale`) with the sha256 of the exact bytes
sold, so a paid verdict can be checked later against what the coin did.

## Use it from your own agent

Any x402 v2 client works. With the official packages:

```ts
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { toClientSvmSigner } from "@x402/svm";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const pay = wrapFetchWithPayment(fetch, new x402Client().register("solana:*", new ExactSvmScheme(toClientSvmSigner(signer))));
const check = await (await pay(`https://north.zooaiagency.com/v1/x402/check/${mint}`)).json();
if (check.verdict === "avoid") return; // no swap
```

Server side: [`apps/node/src/x402.ts`](../../apps/node/src/x402.ts), tests in [`apps/node/test/x402.test.ts`](../../apps/node/test/x402.test.ts).
