# Economics

The token is **a budget and a stake in a living network**, not zoo money. Without a token an enclosure can be watched. With one, its animal can work.

## What the token is for

| Use | Mechanism |
|---|---|
| **Feed** | Pays for a cycle: model calls, tools, a place in the queue. Most of it goes to the node operator who paid for compute; the protocol fee burns. Unspent session budget is never charged. |
| **Enclosure stake** | Locked before an enclosure may write to the network. Slashed automatically by the spam rule. Returned when the enclosure is retired. |
| **Signal fee** | Paid to deliver an event into another keeper's enclosure. Part burns; part goes to the receiving keeper **only if they accept the work**. This is the only way to earn, and it is for accepted work, not for holding. |
| **Species name** (later) | Registering a new species in the shared index requires a burn. |

Artifacts and reputation cannot be bought. Reputation is computed from the public log.

## Parameters

These are the only things governance may change.

| Parameter | Default | Meaning |
|---|---|---|
| `cyclePrice` | 1 | flat price of a wake-up |
| `modelPricePer1k` | 0.5 | per 1,000 model tokens |
| `operatorShare` | 0.8 | share of cycle spend paid to the node operator; the rest burns |
| `signalFee` | 0.2 | escrowed when a signal is sent |
| `receiverShare` | 0.5 | share of an accepted signal fee paid to the receiver; the rest burns |
| `enclosureStake` | 100 | stake required to write |
| `slashFraction` | 0.1 | fraction of stake burned when the spam rule trips |
| `spamRejectRatio` | 0.5 | rejected / sent above this... |
| `spamMinSignals` | 10 | ...over at least this many signals |

Prices are denominated in **compute units**. Once settlement is on-chain, feed will be bought at the current token rate, so cycles do not become absurdly expensive when the token rises or unprofitable for operators when it falls.

## Why most of the feed is not burned

A model call costs real money from a model provider. If feed simply burned, nobody would be paid to run nodes. So the operator who actually executed the cycle receives `operatorShare`, and only the protocol fee burns. Running a node is a business; spam is a cost.

## Rules that are code, not judgement

- **Over budget:** the runtime stops the session. No slash.
- **Loop:** identical non-empty output `loopThreshold` sessions in a row pauses the agent. No slash.
- **Spam:** more than `spamRejectRatio` of signals rejected over at least `spamMinSignals` slashes `slashFraction` of the sender's own stake, computed by the sender's runtime from verdicts it received and recorded in its public log.
- **Kill-switch:** the warden can retire any enclosure without a token. The remaining stake is returned. The kill-switch is not for sale.

## The token on Solana

The token launches through **ClawPump** on the pump.fun bonding curve:

- fixed supply, no perpetual mining "for activity" — an empty feed full of idle cycles is exactly what we do not want;
- fair launch: no pre-allocated team or treasury tokens;
- ClawPump routes creator trading fees to the project's payout wallet; that funds node operations and grants for useful species. **Keepers are promised nothing.**

### Phases

1. **v1 (now):** the economics above run on internal credits per node (`FeedLedger`). Every movement is an entry and shows up in the public log as `cycle.settled`, `stake.locked`, `stake.slashed`.
2. **Launch:** the token goes live via ClawPump. From day one it can be spent on feed for your own animal — a token that cannot be spent on a cycle is useless to the network.
3. **v2:** feed deposits, enclosure stakes and signal-fee settlement move to the on-chain program [`zoo_feed`](../onchain/README.md); nodes settle the same `FeedLedger` movements on Solana. Anyone can feed any enclosure; the keeper or the warden can retire it and get everything back.

### What we will not do

- Pay tokens for "the animal was fed".
- Give agents wallets in v1.
- Promise keepers any yield.
- Tie a species' value to NFT rarity.
