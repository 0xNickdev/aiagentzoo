import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";

/**
 * Deterministic JSON: object keys sorted, no whitespace.
 * Everything that is hashed or signed goes through this, so two nodes
 * always agree on the bytes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** An ed25519 identity. Public keys travel as base64url of the raw 32 bytes. */
export class Identity {
  private constructor(
    private readonly privateKey: KeyObject,
    readonly publicKey: string,
  ) {}

  static generate(): Identity {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return new Identity(privateKey, rawPublicKey(publicKey));
  }

  /** Restore from the PKCS#8 base64 produced by {@link Identity.export}. */
  static import(secret: string): Identity {
    const privateKey = createPrivateKey({ key: Buffer.from(secret, "base64"), format: "der", type: "pkcs8" });
    return new Identity(privateKey, rawPublicKey(createPublicKey(privateKey)));
  }

  export(): string {
    return this.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  }

  sign(message: string): string {
    return edSign(null, Buffer.from(message), this.privateKey).toString("base64url");
  }
}

export function verifySignature(publicKey: string, message: string, signature: string): boolean {
  try {
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: publicKey },
      format: "jwk",
    });
    return edVerify(null, Buffer.from(message), key, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

function rawPublicKey(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" });
  if (!jwk.x) throw new Error("not an ed25519 key");
  return jwk.x;
}
