import type { ZooEvent } from "./events.js";

export interface Peer {
  /** Node id, e.g. `node-b.zoo`. */
  id: string;
  /** Base URL of the node API, e.g. `https://node-b.example.com`. */
  url: string;
  /** base64url ed25519 public key of the node. */
  publicKey: string;
}

export interface DeliveryResult {
  accepted: boolean;
  reason?: string;
}

/** Carries signed events between nodes. */
export interface Transport {
  send(peer: Peer, event: ZooEvent): Promise<DeliveryResult>;
}

export class PeerDirectory {
  private peers = new Map<string, Peer>();

  constructor(peers: Peer[] = []) {
    for (const peer of peers) this.add(peer);
  }

  add(peer: Peer): void {
    this.peers.set(peer.id, peer);
  }

  remove(id: string): boolean {
    return this.peers.delete(id);
  }

  get(id: string): Peer | undefined {
    return this.peers.get(id);
  }

  list(): Peer[] {
    return [...this.peers.values()];
  }
}

/** `POST {peer.url}/v1/events` with the signed event as JSON. */
export class HttpTransport implements Transport {
  constructor(private readonly timeoutMs = 10_000) {}

  async send(peer: Peer, event: ZooEvent): Promise<DeliveryResult> {
    try {
      const res = await fetch(new URL("/v1/events", peer.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<DeliveryResult>;
      if (!res.ok) return { accepted: false, reason: body.reason ?? `HTTP ${res.status}` };
      return { accepted: body.accepted === true, ...(body.reason ? { reason: body.reason } : {}) };
    } catch (error) {
      return { accepted: false, reason: `unreachable: ${(error as Error).message}` };
    }
  }
}
