# zoo_feed — on-chain settlement

Anchor program that settles the zoo economy on Solana. Works with SPL Token and Token-2022 mints (pump.fun launches Token-2022).

**Program id:** `BETwmWnijzhfa8NDEBZ6g2T9nPyWbqKwo6Wd2GT9W7Jr`

| Instruction | Signer | Effect |
|---|---|---|
| `initialize(params)` | authority | creates `config` and the `vault` (PDA token account) for the mint |
| `update_params(params)` | authority | the only thing governance may change |
| `set_authority(key)` | authority | hand the warden role to a multisig |
| `open_enclosure(node_id, operator)` | keeper | locks `enclosure_stake` in the vault |
| `deposit_feed(amount)` | anyone | feeds an enclosure — the keeper or a patron |
| `settle_cycles(cycles, model_tokens)` | enclosure operator | `operator_share_bps` to the operator, the rest is **burned** |
| `settle_signal(accepted)` | sender's operator | accepted: `receiver_share_bps` to the receiving keeper; the rest burns. The spam rule slashes stake in code |
| `retire()` | keeper **or** authority | returns stake + feed to the keeper. The kill-switch is free |

Accounts: `config` = PDA `["config"]`, `vault` = PDA `["vault"]` (authority: config), `enclosure` = PDA `["enclosure", sha256(node id)]`.

Invariant (tested): vault balance == Σ stake + Σ feed of all enclosures.

## Develop

```bash
npm install
anchor test        # builds, starts a local validator, runs 12 tests on Token-2022
```

## Launch checklist

1. **Token** — launch on ClawPump (pump.fun bonding curve, Token-2022, 6 decimals). Note the mint.
2. **Fund the deployer** — about 3 SOL on the target cluster (program rent ≈ 2.04 SOL plus fees).
3. **Deploy** — `anchor deploy --provider.cluster devnet` (or `mainnet`). Keep `target/deploy/zoo_feed-keypair.json` backed up: it is the upgrade key of the program id.
4. **Initialize** — edit `scripts/params.json` (whole tokens), then
   `MINT=<mint> ANCHOR_PROVIDER_URL=<rpc> ANCHOR_WALLET=~/.config/solana/id.json npx ts-node scripts/init.ts`
5. **Hand over** — `set_authority` to a multisig before any real value sits in the vault.
6. **Open enclosures** — each node's keeper calls `open_enclosure` with `sha256("<node>.zoo")` and its operator key.

Operators self-report cycles in v2.0; the node's public log is the audit trail for every settled cycle.
