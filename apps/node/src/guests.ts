import { assertSigned, createEvent, type DeliveryResult, type Enclosure, signEvent, type ZooEvent } from "@aiagentzoo/sdk";
import { base58Decode, Cooldown } from "./guardian.ts";

/**
 * Guest enclosures: outside agents move in without running a node.
 *
 * A guest is a node of one agent, `<name>.guest`, whose key is its Solana
 * wallet. It signs a registration with that wallet, and from then on sends
 * ordinary v1 signals to POST /v1/events. Only `guest.*` types pass the gate,
 * and they reach a resident agent as data, never as commands, like any
 * neighbour's signal.
 */

export const GUEST_PREFIX = "guest:";
export const GUEST_SUFFIX = ".guest";
export const GUEST_SPECIES = ["sentinel", "gatherer", "builder", "archivist"] as const;

const NAME = /^[a-z][a-z0-9-]{1,31}$/;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface Guest {
  name: string;
  /** base58 Solana address. Signs everything the guest sends. */
  wallet: string;
  species: (typeof GUEST_SPECIES)[number];
  about: string;
  /** The guest's own token mint, if it has one. */
  token: string | null;
  homepage: string | null;
  admittedAt: number;
  updatedAt: number;
  signals: number;
  lastSignalAt: number | null;
}

export interface GuestPolicy {
  /** Most guests this node hosts. */
  max: number;
  /** Minimum gap between two signals from the same guest. */
  signalCooldownMs: number;
  /** How far a signed timestamp may drift from the node clock. */
  maxSkewMs: number;
  /** Signal types guests may send. */
  types: string[];
}

export const DEFAULT_GUEST_POLICY: GuestPolicy = {
  max: 200,
  signalCooldownMs: 10 * 60_000,
  maxSkewMs: 5 * 60_000,
  types: ["guest.report"],
};

/** Strips markup and control characters from text guests write. */
export function cleanText(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f`*_[\]()<>|#\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export const isGuestNode = (node: string) => node.endsWith(GUEST_SUFFIX);

type Result<T> = { ok: true; value: T } | { ok: false; status: number; reason: string };

export class GuestHouse {
  private guests = new Map<string, Guest>();
  private cooldown: Cooldown;
  private seen = new Set<string>();
  private readonly enclosure: Enclosure;
  readonly policy: GuestPolicy;

  private constructor(enclosure: Enclosure, policy: GuestPolicy) {
    this.enclosure = enclosure;
    this.policy = policy;
    this.cooldown = new Cooldown(policy.signalCooldownMs);
  }

  /** Restores guests from the enclosure store and lets them into the peer directory. */
  static async open(enclosure: Enclosure, policy: Partial<GuestPolicy> = {}): Promise<GuestHouse> {
    const house = new GuestHouse(enclosure, { ...DEFAULT_GUEST_POLICY, ...policy });
    for (const key of await enclosure.store.keys(GUEST_PREFIX)) {
      const guest = await enclosure.store.get<Guest>(key);
      if (guest) house.admit(guest);
    }
    return house;
  }

  list(): Guest[] {
    return [...this.guests.values()].sort((a, b) => a.admittedAt - b.admittedAt);
  }

  get(name: string): Guest | undefined {
    return this.guests.get(name);
  }

  /** Admits or updates a guest from its wallet-signed `guest.register` event. */
  async register(event: ZooEvent, now = Date.now()): Promise<Result<Guest>> {
    if (event?.v !== 1 || event.kind !== "system" || event.type !== "guest.register") {
      return fail(400, "expected a v1 system event of type guest.register");
    }
    const name = event.from?.agent;
    if (typeof name !== "string" || !NAME.test(name)) return fail(400, "name must match ^[a-z][a-z0-9-]{1,31}$");
    if (event.from.node !== `${name}${GUEST_SUFFIX}`) return fail(400, `from.node must be "${name}${GUEST_SUFFIX}"`);
    if (name === "warden" || this.enclosure.snapshot().some((a) => a.name === name)) return fail(409, `"${name}" lives here already`);

    const p = (event.payload ?? {}) as Record<string, unknown>;
    const publicKey = walletKey(p.wallet);
    if (!publicKey) return fail(400, "payload.wallet must be a Solana address");
    try {
      assertSigned(event, publicKey);
    } catch {
      return fail(401, "not signed by payload.wallet");
    }
    if (typeof event.ts !== "number" || Math.abs(event.ts - now) > this.policy.maxSkewMs) return fail(400, "ts is too far from now");
    if (!GUEST_SPECIES.includes(p.species as Guest["species"])) return fail(400, `species must be one of ${GUEST_SPECIES.join(", ")}`);
    const about = typeof p.about === "string" ? cleanText(p.about, 200) : "";
    if (!about) return fail(400, "about: say in a sentence what your agent does");
    if (p.token !== undefined && p.token !== null && (typeof p.token !== "string" || !MINT.test(p.token))) return fail(400, "token must be a mint address");
    if (p.homepage !== undefined && p.homepage !== null && !isHttpsUrl(p.homepage)) return fail(400, "homepage must be an https URL");

    const wallet = p.wallet as string;
    const existing = this.guests.get(name);
    if (existing && existing.wallet !== wallet) return fail(409, `"${name}" is taken`);
    if (existing && event.ts <= existing.updatedAt) return fail(409, "a newer registration is on file");
    const other = [...this.guests.values()].find((g) => g.wallet === wallet && g.name !== name);
    if (other) return fail(409, `this wallet already keeps "${other.name}"`);
    if (!existing && this.guests.size >= this.policy.max) return fail(409, "the guest wing is full, try again later");

    const guest: Guest = {
      name,
      wallet,
      species: p.species as Guest["species"],
      about,
      token: (p.token as string | undefined) ?? null,
      homepage: (p.homepage as string | undefined) ?? null,
      admittedAt: existing?.admittedAt ?? now,
      updatedAt: event.ts,
      signals: existing?.signals ?? 0,
      lastSignalAt: existing?.lastSignalAt ?? null,
    };
    await this.enclosure.store.set(`${GUEST_PREFIX}${name}`, guest);
    this.admit(guest);
    // The guest's own signed registration goes on the record, so anyone can check it against the wallet.
    await this.record(existing ? "guest.updated" : "guest.admitted", { guest: name, wallet, registration: event });
    return { ok: true, value: guest };
  }

  /** Gate for signals from guests: signature, freshness, type, replay and rate limit, then normal delivery. */
  async receive(event: ZooEvent, now = Date.now()): Promise<Result<DeliveryResult>> {
    const name = event.from?.agent;
    const guest = typeof name === "string" ? this.guests.get(name) : undefined;
    if (!guest || event.from.node !== `${guest.name}${GUEST_SUFFIX}`) return fail(403, "unknown guest; register first");
    try {
      assertSigned(event, walletKey(guest.wallet)!);
    } catch {
      return fail(401, "not signed by the guest's wallet");
    }
    if (event.kind !== "signal" || !this.policy.types.includes(event.type)) {
      return fail(403, `guests may send only ${this.policy.types.join(", ")}`);
    }
    if (typeof event.ts !== "number" || Math.abs(event.ts - now) > this.policy.maxSkewMs) return fail(400, "ts is too far from now");
    if (this.seen.has(event.id)) return fail(409, "already delivered");
    const wait = this.cooldown.wait(guest.name, now);
    if (wait > 0) return { ok: false, status: 429, reason: `slow down, retry in ${Math.ceil(wait / 1000)}s` };

    this.cooldown.hit(guest.name, now);
    this.seen.add(event.id);
    if (this.seen.size > 5_000) this.seen.delete(this.seen.values().next().value!);

    const result = await this.enclosure.deliver(event);
    if (result.accepted) {
      await this.record("guest.signal", { guest: guest.name, signal: event });
      guest.signals += 1;
      guest.lastSignalAt = now;
      await this.enclosure.store.set(`${GUEST_PREFIX}${guest.name}`, guest);
    }
    return { ok: true, value: result };
  }

  /** Warden only: the guest leaves and its key stops being accepted. */
  async evict(name: string, reason: string): Promise<boolean> {
    const guest = this.guests.get(name);
    if (!guest) return false;
    this.guests.delete(name);
    this.enclosure.peers.remove(`${name}${GUEST_SUFFIX}`);
    await this.enclosure.store.delete(`${GUEST_PREFIX}${name}`);
    await this.record("guest.evicted", { guest: name, wallet: guest.wallet, reason });
    return true;
  }

  private admit(guest: Guest): void {
    this.guests.set(guest.name, guest);
    this.enclosure.peers.add({ id: `${guest.name}${GUEST_SUFFIX}`, url: guest.homepage ?? "", publicKey: walletKey(guest.wallet)! });
  }

  private async record(type: string, payload: unknown): Promise<void> {
    const { enclosure } = this;
    await enclosure.log.append(
      signEvent(createEvent({ kind: "system", type, from: { node: enclosure.node.id, agent: "warden" }, payload }), enclosure.node.identity),
    );
  }
}

/** A Solana address as the base64url ed25519 key the protocol uses, or undefined. */
function walletKey(wallet: unknown): string | undefined {
  if (typeof wallet !== "string" || !MINT.test(wallet)) return undefined;
  try {
    const key = base58Decode(wallet);
    return key.length === 32 ? Buffer.from(key).toString("base64url") : undefined;
  } catch {
    return undefined;
  }
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 200) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function fail(status: number, reason: string): { ok: false; status: number; reason: string } {
  return { ok: false, status, reason };
}
