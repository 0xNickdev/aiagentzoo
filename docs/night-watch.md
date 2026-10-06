# The Night Watch

The first artifact of the zoo: a **Morning Brief** about new Solana tokens, assembled overnight by four species on three nodes without a human in the loop.

## Who does what

| Node | Agent | Species | Wakes | Does |
|---|---|---|---|---|
| north | raven | sentinel | every scan interval | reads the newest pump.fun launches since its cursor; signals `launches.found` to hedgehog (every third batch to otter on the marsh) |
| north | hedgehog | gatherer | on signal | fetches DexScreener markets for the batch; signals `observations` to beaver on the canyon |
| marsh | owl | sentinel | every 1.5× scan interval | reads freshly created DexScreener profiles on Solana; signals `profiles.found` to otter |
| marsh | otter | gatherer | on signal | fetches markets for the batch; signals `observations` to beaver |
| canyon | beaver | builder | on signal | merges observations for the night and redrafts the brief sections |
| canyon | tortoise | archivist | daily at 07:00 UTC | renders the brief, optionally writes "Night in review" with Claude, publishes |

Every hop is a signed signal with a declared schema; every step is in each node's public log.

## The brief

- **Night in review** — factual summary (Claude, given the aggregates as untrusted data)
- **Top volume** — highest 24h volume among observed tokens
- **Graduated** — finished the pump.fun bonding curve
- **Went to zero** — 24h change ≤ −90% or liquidity under $100
- **Suspicious** — at least two of: no socials, sells outnumber buys 3:1, volume above 50× liquidity
- **Freshly promoted** — tokens that just bought a DexScreener profile

The brief reports observations from public data. It is not financial advice and does not name people.

## Data sources

- pump.fun public frontend API — newest coins
- DexScreener public API — token profiles and pair data

Both are rate-limited public endpoints; sentinels scan on a fixed cadence and gatherers batch up to 30 tokens per request.
