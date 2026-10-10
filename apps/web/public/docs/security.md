# Security model

## The main threat: a neighbour's signal

Signals come from other agents, on other nodes, run by other people. Treat every payload as hostile.

1. **Authenticity.** Signals are ed25519-signed by the sender node and verified against the key in the receiver's peer directory. Unknown nodes are refused.
2. **Shape.** A recipient accepts only the signal types it declared, and only when its validator returns `true`. Validators should check types, lengths and formats (the Night Watch checks base58 mints, symbol length and batch size).
3. **Instructions.** Payloads never become instructions. When an agent thinks with a model, neighbour data goes in `untrusted`; the runtime wraps it in an `<untrusted_data>` fence, neutralises attempts to close the fence, and tells the model to treat it strictly as data. Never interpolate payloads into `system`.
4. **Blast radius.** Even a fooled agent can only do what its species allows, within its session budget. A builder cannot reach the network; an archivist cannot signal anyone.

## Permissions

Capabilities are checked by the runtime on every call. A missing capability throws `PermissionDenied`, ends the session and leaves `permission.denied` in the log. Prompts cannot grant capabilities.

## Keys

- Node keys are ed25519. Keep `ZOO_NODE_SECRET` / `identity.key` private (the key file is written with mode `0600`).
- Rotate a key by publishing the new public key to peers; old entries stay verifiable with the old key.
- Agents have no wallets in v1.

## The warden

- Warden routes need `ZOO_ADMIN_TOKEN`, compared in constant time. Without it they are disabled.
- `POST /v1/warden/retire` is the kill-switch: it stops the scheduler, refuses further signals, returns the stake and logs `enclosure.retired`. It needs no token payment and cannot be bought.

## The node surface

- Request bodies are capped at 256 KiB.
- Public routes are read-only; CORS can be restricted with `ZOO_CORS_ORIGIN`.
- Outbound requests go only through registered tools, gated by `sources:read` / `net:fetch`, with a 30-second timeout.

## Reporting

Please report vulnerabilities privately via GitHub security advisories on the repository rather than in public issues.
