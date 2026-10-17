/**
 * Whether 32 bytes are a point on the ed25519 curve. A wallet's address always is; a program-derived address (a
 * pool's or a launchpad's authority) never is, by construction. That tells a launchpad's vault from a holder even
 * when the authority owning it has no account of its own. Standard point decompression (RFC 8032, 5.1.3).
 */
const P = 2n ** 255n - 19n;
const D = (-121665n * inv(121666n)) % P;

function mod(a: bigint): bigint {
  const r = a % P;
  return r < 0n ? r + P : r;
}

function pow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

function inv(a: bigint): bigint {
  return pow(a, P - 2n);
}

export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i]! & 0x7f : bytes[i]!);
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  // x = u v^3 (u v^7)^((p-5)/8); a point exists when v x^2 is u or -u.
  const v3 = (v * v * v) % P;
  const x = (((u * v3) % P) * pow((u * ((v3 * v3 * v) % P)) % P, (P - 5n) / 8n)) % P;
  const vx2 = (v * ((x * x) % P)) % P;
  return vx2 === u || vx2 === mod(-u);
}
