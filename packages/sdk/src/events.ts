import { randomUUID } from "node:crypto";
import { canonicalJson, type Identity, verifySignature } from "./crypto.js";
import { InvalidSignature } from "./errors.js";

/** Where an agent lives: `{ node: "node-b.zoo", agent: "otter" }`. */
export interface Address {
  node: string;
  agent: string;
}

export type EventKind =
  /** A paid message from one agent to another, possibly across nodes. */
  | "signal"
  /** A step an agent took. Every cycle leaves at least one. */
  | "trace"
  /** A finished artifact committed to the public log. */
  | "artifact"
  /** Something the runtime did: budget stop, loop stop, slash, retire. */
  | "system";

export interface ZooEvent<P = unknown> {
  v: 1;
  id: string;
  kind: EventKind;
  /** Free-form subtype, e.g. `launches.found` or `brief.published`. */
  type: string;
  from: Address;
  to?: Address;
  payload: P;
  /** Milliseconds since epoch. */
  ts: number;
  /** base64url ed25519 signature over the canonical event without `sig`. */
  sig?: string;
}

export interface EventInit<P> {
  kind: EventKind;
  type: string;
  from: Address;
  to?: Address;
  payload: P;
  ts?: number;
}

export function createEvent<P>(init: EventInit<P>): ZooEvent<P> {
  return {
    v: 1,
    id: randomUUID(),
    kind: init.kind,
    type: init.type,
    from: init.from,
    ...(init.to ? { to: init.to } : {}),
    payload: init.payload,
    ts: init.ts ?? Date.now(),
  };
}

export function signingBytes(event: ZooEvent): string {
  const { sig: _sig, ...unsigned } = event;
  return canonicalJson(unsigned);
}

export function signEvent<P>(event: ZooEvent<P>, identity: Identity): ZooEvent<P> {
  return { ...event, sig: identity.sign(signingBytes(event)) };
}

/** Throws {@link InvalidSignature} unless `event` was signed by `publicKey`. */
export function assertSigned(event: ZooEvent, publicKey: string): void {
  if (!event.sig) throw new InvalidSignature("missing signature");
  if (!verifySignature(publicKey, signingBytes(event), event.sig)) {
    throw new InvalidSignature(`not signed by ${event.from.node}`);
  }
}
