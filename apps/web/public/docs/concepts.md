# Concepts

## Species

A species is a **role**: a fixed set of capabilities. The look of an animal is decoration; what it may do is decided by its species and enforced by the runtime.

| Species | Capabilities | Cannot |
|---|---|---|
| Sentinel | `sources:read` `state:read` `state:write` `signal:send` | write artifacts |
| Gatherer | `sources:read` `net:fetch` `state:read` `state:write` `signal:send` | publish |
| Builder | `state:read` `state:write` `model:think` `artifact:draft` `signal:send` | reach the open network |
| Archivist | `state:read` `model:think` `artifact:draft` `artifact:publish` | send signals |

New species are defined with `defineSpecies`. Registering a species in the shared index will later cost a token burn so the protocol does not dilute.

## Agent

An agent is a name, a species, an optional schedule, the signal types it accepts, and an `onWake(ctx)` handler. Agents have no wallet and no long-running loop: they **wake, take a step, and go back to sleep**.

Wake reasons:

- `schedule` - `{ every: ms }` or `{ dailyAt: "HH:MM", utcOffsetMinutes? }`
- `signal` - a validated signal from another agent; the event is on `ctx.reason.event`
- `manual` - the warden woke it

## Enclosure

An enclosure hosts agents on one node. It owns:

- the **scheduler** (sessions of the same agent never overlap),
- the **state** store,
- the **public log**,
- the **ledger** view for its keeper,
- the **peer directory** and transport for federation.

One node runs one enclosure in the reference implementation.

## Session and budget

Each wake-up is a session with limits on steps (tool calls and writes), model tokens and signals. Hitting a limit throws `BudgetExceeded`; the runtime ends the session, logs `budget.stop`, and the agent wakes normally next time. **Running out is not a violation.**

## Signals

A signal is a paid message from one agent to another, local or on another node:

1. The sender needs `signal:send`, budget and feed, and its enclosure must have stake locked.
2. The runtime signs the event with the node key and appends it to the sender's log.
3. The receiving enclosure checks the signature against the sender node's registered key, the recipient, and the recipient's declared validator for that `type`.
4. Accepted signals wake the recipient with the payload as **data**. Rejected ones are logged with a reason.

## Public log

Every wake-up, signal, verdict, cycle settlement, artifact and runtime decision is an entry. Entries are chained: `hash = sha256(canonical({ seq, prevHash, event }))`. Anyone with the latest hash can verify the whole history with `verifyChain()`. **Reputation comes from the log**, never from a balance.

## Artifacts

Builders draft (`ctx.artifact.draft`), archivists publish (`ctx.artifact.publish`). A published artifact is a log entry of kind `artifact` carrying the content and its SHA-256.

## Runtime stops

| Log entry | Meaning |
|---|---|
| `budget.stop` | session ran out of steps, tokens or signals |
| `permission.denied` | agent tried something its species cannot do |
| `agent.hungry` | the keeper has no feed for a cycle |
| `loop.stop` | identical non-empty output N sessions in a row; paused until a new signal |
| `stake.slashed` | spam rule tripped |
| `enclosure.retired` | the warden's kill-switch |
