import { programAddress } from "./poolMeta.ts";
import { fromBase58, PUMP_AMM_PROGRAM, PUMP_PROGRAM, WSOL } from "./pumpParse.ts";

/**
 * Creator fees not yet claimed, read from the two vaults pump.fun pays a creator into. Both are per creator, not per
 * coin: what sits there is from all of this creator's coins together.
 *
 * - pump.fun's curve: a system account, PDA ["creator-vault", creator] under pump.fun (the pump IDL's creator_vault);
 *   its SOL above the rent-exempt minimum is unclaimed.
 * - PumpSwap: a WSOL token account, the associated account of PDA ["creator_vault", coin_creator] under pump-amm (the
 *   pump_amm IDL's coin_creator_vault_authority and coin_creator_vault_ata); its token amount is unclaimed.
 */

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export const curveCreatorVaultOf = (creator: string) => programAddress([Buffer.from("creator-vault"), fromBase58(creator)], PUMP_PROGRAM);
export const poolCreatorVaultAuthorityOf = (creator: string) => programAddress([Buffer.from("creator_vault"), fromBase58(creator)], PUMP_AMM_PROGRAM);
export const poolCreatorVaultOf = (creator: string) => programAddress([fromBase58(poolCreatorVaultAuthorityOf(creator)), fromBase58(TOKEN_PROGRAM), fromBase58(WSOL)], ATA_PROGRAM);

/**
 * The rent-exempt minimum for an empty account, as the cluster says: it is lower than the old (128 + space) x 6,960
 * formula (650,240 lamports on mainnet in November 2026, not 890,880). Asked once and kept.
 */
let rentEmpty: number | null = null;

export interface UnclaimedFees {
  /** SOL in all, curve and pool vaults together, across this creator's coins. */
  sol: number;
  curve: number;
  pool: number;
}

type Rpc = <T>(method: string, params: unknown[]) => Promise<T | null>;
type Account = { lamports: number; space?: number; data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } | [string, string] } | null;

/** Both vaults in one getMultipleAccounts; null when the RPC did not answer. A vault never paid into is zero. */
export async function unclaimedCreatorFees(creator: string, rpc: Rpc): Promise<UnclaimedFees | null> {
  const curveVault = curveCreatorVaultOf(creator);
  const poolVault = poolCreatorVaultOf(creator);
  const [r, rent] = await Promise.all([
    rpc<{ value: Account[] }>("getMultipleAccounts", [[curveVault, poolVault], { encoding: "jsonParsed" }]),
    rentEmpty ?? rpc<number>("getMinimumBalanceForRentExemption", [0]),
  ]);
  if (!r || !Array.isArray(r.value) || typeof rent !== "number") return null;
  rentEmpty = rent;
  const [c, p] = r.value;
  // The curve vault is a plain system account with no data: what is above the rent kept in it is the creator's.
  const curveLamports = c ? Math.max(0, c.lamports - rent) : 0;
  const amount = p && !Array.isArray(p.data) ? Number(p.data?.parsed?.info?.tokenAmount?.amount ?? 0) : 0;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const curve = round(curveLamports / 1e9);
  const pool = round((Number.isFinite(amount) ? amount : 0) / 1e9);
  return { sol: round(curve + pool), curve, pool };
}
