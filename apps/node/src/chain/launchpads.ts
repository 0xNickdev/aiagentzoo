import { base58, type PumpEvent, Reader, type Venue, WSOL } from "./pump.ts";

/**
 * The other launchpads on Solana, read the same way as pump.fun: Raydium LaunchLab (bonk.fun and the platforms built
 * on it) and Meteora's Dynamic Bonding Curve (Believe, bags and others). Both write their events through a call to
 * themselves (Anchor's emit_cpi), not into the logs, and their trade events do not name the trader, nor in
 * LaunchLab's case the token. So each event is paired with the instruction that caused it, and the trader and the
 * token are read from that instruction's accounts. Layouts and discriminators are from the programs' published IDLs:
 * github.com/raydium-io/raydium-idl (raydium_launchpad) and MeteoraAg/dynamic-bonding-curve-sdk.
 */

export const LAUNCHLAB_PROGRAM = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
export const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";

/** Anchor's prefix on an event written by a program calling itself. */
const EVENT_CPI = Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);

/** Platforms built on LaunchLab, by their platform config account (the instruction's fourth account). */
export const LAUNCHLAB_PLATFORMS: Record<string, string> = {
  "6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt": "stonk",
};

const disc = (...b: number[]) => Buffer.from(b).toString("hex");

/** Instruction discriminator -> what it is and where its accounts are. */
type Role =
  | { kind: "create"; creator: number; mint: number; quote: number; vault: number; payer: number; named?: boolean }
  /** buyTo / sellFrom: the trader's token account for the token; its owner is the trader, whoever paid the fee. */
  | { kind: "trade"; user: number; mint: number; quote: number; buyTo: number; sellFrom: number; vault: number }
  | { kind: "migrate"; mint: number };

const LAUNCHLAB_IX: Record<string, Role> = {
  [disc(250, 234, 13, 123, 213, 156, 19, 236)]: { kind: "trade", user: 0, mint: 9, quote: 10, buyTo: 5, sellFrom: 5, vault: 7 }, // buy_exact_in
  [disc(24, 211, 116, 40, 105, 3, 153, 56)]: { kind: "trade", user: 0, mint: 9, quote: 10, buyTo: 5, sellFrom: 5, vault: 7 }, // buy_exact_out
  [disc(149, 39, 222, 155, 211, 124, 152, 26)]: { kind: "trade", user: 0, mint: 9, quote: 10, buyTo: 5, sellFrom: 5, vault: 7 }, // sell_exact_in
  [disc(95, 200, 71, 34, 8, 9, 11, 166)]: { kind: "trade", user: 0, mint: 9, quote: 10, buyTo: 5, sellFrom: 5, vault: 7 }, // sell_exact_out
  [disc(175, 175, 109, 31, 13, 152, 155, 237)]: { kind: "create", payer: 0, creator: 1, mint: 6, quote: 7, vault: 8 }, // initialize
  [disc(67, 153, 175, 39, 218, 16, 38, 32)]: { kind: "create", payer: 0, creator: 1, mint: 6, quote: 7, vault: 8 }, // initialize_v2
  [disc(37, 190, 126, 222, 44, 154, 171, 17)]: { kind: "create", payer: 0, creator: 1, mint: 6, quote: 7, vault: 8 }, // initialize_with_token_2022
  [disc(207, 82, 192, 145, 254, 207, 145, 223)]: { kind: "migrate", mint: 1 }, // migrate_to_amm
  [disc(136, 92, 200, 103, 28, 218, 144, 140)]: { kind: "migrate", mint: 1 }, // migrate_to_cpswap
};

const DBC_IX: Record<string, Role> = {
  [disc(248, 198, 158, 145, 225, 117, 135, 200)]: { kind: "trade", user: 9, mint: 7, quote: 8, buyTo: 4, sellFrom: 3, vault: 5 }, // swap
  [disc(65, 75, 63, 76, 235, 91, 91, 136)]: { kind: "trade", user: 9, mint: 7, quote: 8, buyTo: 4, sellFrom: 3, vault: 5 }, // swap2
  [disc(183, 93, 153, 40, 24, 230, 194, 151)]: { kind: "trade", user: 9, mint: 7, quote: 8, buyTo: 4, sellFrom: 3, vault: 5 }, // swap2_with_transfer_hook
  // The name and symbol are the instruction's own arguments here; the event leaves them out.
  [disc(140, 85, 215, 176, 102, 54, 104, 79)]: { kind: "create", payer: 10, creator: 2, mint: 3, quote: 4, vault: 6, named: true }, // with_spl_token
  [disc(169, 118, 51, 78, 145, 110, 220, 155)]: { kind: "create", payer: 8, creator: 2, mint: 3, quote: 4, vault: 6, named: true }, // with_token2022
  [disc(182, 13, 233, 177, 42, 145, 135, 2)]: { kind: "create", payer: 9, creator: 2, mint: 3, quote: 4, vault: 6, named: true }, // with_token2022_transfer_hook
  [disc(156, 169, 230, 103, 53, 228, 80, 64)]: { kind: "migrate", mint: 13 }, // migration_damm_v2
};

const LL_POOL_CREATE = disc(151, 215, 226, 9, 118, 161, 115, 174);
const LL_TRADE = disc(189, 219, 127, 211, 78, 230, 97, 238);
const DBC_INIT = new Set([disc(228, 50, 246, 85, 203, 66, 134, 37), disc(213, 137, 164, 53, 193, 74, 15, 110)]);
// One swap writes EvtSwap, EvtSwap2 and EvtSwap3: only EvtSwap2 is read, so a trade counts once.
const DBC_SWAP2 = new Set([disc(189, 66, 51, 168, 38, 80, 117, 153), disc(134, 59, 168, 120, 94, 51, 114, 231)]);
const DBC_COMPLETE = new Set([disc(229, 231, 86, 84, 156, 134, 75, 24), disc(59, 47, 109, 205, 13, 31, 44, 159)]);

/** One instruction as it ran, top level or inner, with its accounts already resolved to addresses. */
export interface RanIx {
  program: string;
  accounts: string[];
  data: Buffer;
}

/** A transaction reduced to what the launchpads need: instructions in the order they ran, and token decimals and balances. */
export interface LaunchpadTx {
  ixs: RanIx[];
  /** Decimals of every mint the transaction moved. */
  decimals: Map<string, number>;
  /** Token balance after the transaction, by token account address (whole tokens). */
  after: Map<string, number>;
  /** Who owns each token account the transaction moved. */
  owners: Map<string, string>;
  /** Token balance before the transaction, by token account address. */
  before: Map<string, number>;
  /** Which token each token account holds. */
  mints: Map<string, string>;
}

interface RawIx {
  programIdIndex: number;
  accounts: ArrayLike<number>;
  data: Uint8Array;
}

/** Builds a LaunchpadTx from the parts every source has: account keys, top-level and inner instructions, token balances. */
function assemble(
  keys: string[],
  top: RawIx[],
  inner: Array<{ index: number; instructions: RawIx[] }>,
  balances: Array<{ accountIndex: number; mint: string; owner?: string; decimals?: number; ui?: number; pre?: number; }>,
): LaunchpadTx {
  const byIndex = new Map<number, RawIx[]>();
  for (const g of inner) byIndex.set(g.index, [...(byIndex.get(g.index) ?? []), ...g.instructions]);
  const ran = (ix: RawIx): RanIx => ({
    program: keys[ix.programIdIndex] ?? "",
    accounts: Array.from(ix.accounts, (a) => keys[a] ?? ""),
    data: Buffer.from(ix.data),
  });
  const ixs: RanIx[] = [];
  top.forEach((ix, i) => {
    ixs.push(ran(ix));
    for (const j of byIndex.get(i) ?? []) ixs.push(ran(j));
  });
  const decimals = new Map<string, number>();
  const after = new Map<string, number>();
  const owners = new Map<string, string>();
  const before = new Map<string, number>();
  const mints = new Map<string, string>();
  for (const b of balances) {
    if (keys[b.accountIndex]) mints.set(keys[b.accountIndex]!, b.mint);
    if (b.pre !== undefined && keys[b.accountIndex]) before.set(keys[b.accountIndex]!, b.pre);
    if (b.decimals !== undefined) decimals.set(b.mint, b.decimals);
    if (b.owner && keys[b.accountIndex]) owners.set(keys[b.accountIndex]!, b.owner);
    if (b.ui !== undefined && keys[b.accountIndex]) after.set(keys[b.accountIndex]!, b.ui);
  }
  return { ixs, decimals, after, owners, before, mints };
}

type YsIx = { programIdIndex: number; accounts: Uint8Array; data: Uint8Array };
type YsBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount?: { decimals: number; uiAmount: number }; };
export interface YellowstoneTx {
  transaction?: {
    message?: { accountKeys?: Uint8Array[]; instructions?: YsIx[] };
  };
  meta?: {
    innerInstructions?: Array<{ index: number; instructions: YsIx[] }>;
    loadedWritableAddresses?: Uint8Array[];
    loadedReadonlyAddresses?: Uint8Array[];
    preTokenBalances?: YsBalance[];
    postTokenBalances?: YsBalance[];
  };
}

/** From a Yellowstone gRPC transaction update. Address-table accounts come after the static keys, writable first. */
export function fromYellowstone(tx: YellowstoneTx): LaunchpadTx | null {
  const m = tx.transaction?.message;
  if (!m?.accountKeys || !m.instructions || !tx.meta) return null;
  const keys = [...m.accountKeys, ...(tx.meta.loadedWritableAddresses ?? []), ...(tx.meta.loadedReadonlyAddresses ?? [])].map((k) => base58(k));
  const pre = (tx.meta.preTokenBalances ?? []).map((b) => ({
    accountIndex: b.accountIndex,
    mint: b.mint,
    owner: b.owner,
    decimals: b.uiTokenAmount?.decimals,
    pre: b.uiTokenAmount?.uiAmount ?? 0,
  }));
  const post = (tx.meta.postTokenBalances ?? []).map((b) => ({
    accountIndex: b.accountIndex,
    mint: b.mint,
    owner: b.owner,
    decimals: b.uiTokenAmount?.decimals,
    ui: b.uiTokenAmount?.uiAmount ?? 0,
  }));
  return assemble(keys, m.instructions, tx.meta.innerInstructions ?? [], [...pre, ...post]);
}

type RpcIx = { programIdIndex: number; accounts: number[]; data: string };
type RpcBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { decimals: number; uiAmount: number | null };
};
export interface RpcTx {
  transaction: { message: { accountKeys: string[]; instructions: RpcIx[] } };
  meta: {
    innerInstructions?: Array<{ index: number; instructions: RpcIx[] }> | null;
    loadedAddresses?: { writable: string[]; readonly: string[] };
    preTokenBalances?: RpcBalance[];
    postTokenBalances?: RpcBalance[];
  };
}

/** From a getTransaction answer (encoding "json"): the same transaction as an RPC returns it, for tests and backfills. */
export function fromRpc(tx: RpcTx, fromB58: (s: string) => Buffer): LaunchpadTx {
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
  const ix = (i: RpcIx): RawIx => ({
    programIdIndex: i.programIdIndex,
    accounts: i.accounts,
    data: fromB58(i.data),
  });
  const bal = (b: RpcBalance, after: boolean) => ({
    accountIndex: b.accountIndex,
    mint: b.mint,
    owner: b.owner,
    decimals: b.uiTokenAmount.decimals,
    ...(after ? { ui: b.uiTokenAmount.uiAmount ?? 0 } : { pre: b.uiTokenAmount.uiAmount ?? 0 }),
  });
  return assemble(
    keys,
    tx.transaction.message.instructions.map(ix),
    (tx.meta.innerInstructions ?? []).map((g) => ({
      index: g.index,
      instructions: g.instructions.map(ix),
    })),
    [...(tx.meta.preTokenBalances ?? []).map((b) => bal(b, false)), ...(tx.meta.postTokenBalances ?? []).map((b) => bal(b, true))],
  );
}

/** True when any instruction of the transaction runs one of the launchpads. */
export const touchesLaunchpads = (tx: LaunchpadTx) => tx.ixs.some((i) => i.program === LAUNCHLAB_PROGRAM || i.program === DBC_PROGRAM);

/**
 * The launch, trade and graduation events in a transaction, as the tape takes them. `ts` is when it happened:
 * these events carry no time of their own, so the stream passes the moment it saw them.
 */
export function parseLaunchpads(tx: LaunchpadTx, ts: number): PumpEvent[] {
  const out: PumpEvent[] = [];
  // The last instruction each launchpad ran: the next event it writes belongs to it.
  const last: Record<string, { role: Role; accounts: string[]; data: Buffer } | undefined> = {};
  const dec = (mint: string, fallback: number) => tx.decimals.get(mint) ?? fallback;
  /**
   * The trader's side of a trade: the token account the tokens moved in or out of, and its owner, who is the trader
   * whoever paid the fee. A router can use a temporary account it closes in the same transaction; then the account of
   * this token that grew (a buy) or shrank (a sell) the most, the curve's own vault left out, is the trader's.
   */
  const sideOf = (role: Extract<Role, { kind: "trade" }>, accounts: string[], isBuy: boolean) => {
    const direct = accounts[isBuy ? role.buyTo : role.sellFrom] ?? "";
    if (tx.owners.has(direct)) return { account: direct, owner: tx.owners.get(direct)! };
    const mint = accounts[role.mint];
    const vault = accounts[role.vault];
    let best: { account: string; owner: string; delta: number } | null = null;
    for (const [account, m] of tx.mints) {
      if (m !== mint || account === vault || !tx.owners.has(account)) continue;
      const delta = (tx.after.get(account) ?? 0) - (tx.before.get(account) ?? 0);
      const signed = isBuy ? delta : -delta;
      if (signed > 0 && (!best || signed > best.delta)) best = { account, owner: tx.owners.get(account)!, delta: signed };
    }
    return best ? { account: best.account, owner: best.owner } : { account: direct, owner: accounts[role.user]! };
  };
  // What actually reached or left the trader's account: with a transfer fee a buyer gets less and a seller pays more
  // than the curve counts. Far off (another leg of the same transaction) and the event's own amount stands.
  const moved = (account: string, fromEvent: number) => {
    const delta = Math.abs((tx.after.get(account) ?? 0) - (tx.before.get(account) ?? 0));
    return tx.after.has(account) && delta > 0 && delta <= fromEvent * 2 && delta >= fromEvent * 0.5 ? delta : fromEvent;
  };

  for (const ix of tx.ixs) {
    const venue: Venue | null = ix.program === LAUNCHLAB_PROGRAM ? "launchlab" : ix.program === DBC_PROGRAM ? "dbc" : null;
    if (!venue || ix.data.length < 8) continue;
    try {
      if (!ix.data.subarray(0, 8).equals(EVENT_CPI)) {
        const role = (venue === "launchlab" ? LAUNCHLAB_IX : DBC_IX)[ix.data.subarray(0, 8).toString("hex")];
        if (!role) continue;
        last[venue] = { role, accounts: ix.accounts, data: ix.data };
        if (role.kind === "migrate" && ix.accounts[role.mint]) out.push({ kind: "complete", mint: ix.accounts[role.mint]! });
        continue;
      }
      const ev = ix.data.subarray(8, 16).toString("hex");
      const body = new Reader(ix.data.subarray(16));
      const ctx = last[venue];
      if (venue === "launchlab") {
        if (ev === LL_POOL_CREATE && ctx?.role.kind === "create") {
          body.key(); // pool_state
          const creator = base58(body.key());
          body.key(); // config
          body.b8(); // decimals: the transaction's token balances say it too
          const name = body.str();
          const symbol = body.str();
          const created = createOf(venue, ctx.role, ctx.accounts, { name, symbol, creator, ts }, tx);
          const platform = LAUNCHLAB_PLATFORMS[ctx.accounts[3] ?? ""];
          out.push(platform && created.kind === "create" ? { ...created, platform } : created);
        } else if (ev === LL_TRADE && ctx?.role.kind === "trade") {
          body.key(); // pool_state
          body.u64(); // total_base_sell
          body.u64(); // virtual_base
          body.u64(); // virtual_quote
          body.u64(); // real_base_before
          body.u64(); // real_quote_before
          body.u64(); // real_base_after
          const quoteAfter = body.u64();
          const amountIn = body.u64();
          const amountOut = body.u64();
          body.skip(4 * 8); // protocol, platform, creator and share fees
          const isBuy = body.b8() === 0;
          const status = body.b8();
          const mint = ctx.accounts[ctx.role.mint]!;
          const quote = ctx.accounts[ctx.role.quote]!;
          const side = sideOf(ctx.role, ctx.accounts, isBuy);
          const q = 10 ** dec(quote, 9);
          const b = 10 ** dec(mint, 6);
          out.push({
            kind: "trade",
            mint,
            user: side.owner,
            isBuy,
            sol: Number(isBuy ? amountIn : amountOut) / q,
            tokens: moved(side.account, Number(isBuy ? amountOut : amountIn) / b),
            ts,
            curveSol: quote === WSOL ? Number(quoteAfter) / q : null,
          });
          // Migrate: the curve filled and the pool moves to Raydium.
          if (status === 1) out.push({ kind: "complete", mint });
        }
      } else {
        if (DBC_INIT.has(ev) && ctx?.role.kind === "create") {
          body.key(); // pool
          body.key(); // config
          const creator = base58(body.key());
          // initialize_virtual_pool_*: 8-byte discriminator, then name, symbol, uri.
          const args = new Reader(ctx.data.subarray(8));
          const name = args.str();
          const symbol = args.str();
          out.push(createOf(venue, ctx.role, ctx.accounts, { name, symbol, creator, ts }, tx));
        } else if (DBC_SWAP2.has(ev) && ctx?.role.kind === "trade") {
          body.key(); // pool
          body.key(); // config
          const direction = body.b8();
          body.skip(1); // has_referral
          body.skip(8 + 8 + 1); // swap parameters: amount_0, amount_1, swap_mode
          const inIncludingFee = body.u64();
          body.u64(); // excluded_fee_input_amount
          body.u64(); // amount_left
          const output = body.u64();
          body.skip(16 + 8 * 3); // next_sqrt_price, trading, protocol and referral fees
          const quoteReserve = body.u64();
          // QuoteToBase (1) is a buy, BaseToQuote (0) a sell: checked against the buyer's token balance on mainnet.
          const isBuy = direction === 1;
          const mint = ctx.accounts[ctx.role.mint]!;
          const quote = ctx.accounts[ctx.role.quote]!;
          const side = sideOf(ctx.role, ctx.accounts, isBuy);
          const q = 10 ** dec(quote, 9);
          const b = 10 ** dec(mint, 6);
          out.push({
            kind: "trade",
            mint,
            user: side.owner,
            isBuy,
            sol: Number(isBuy ? inIncludingFee : output) / q,
            tokens: moved(side.account, Number(isBuy ? output : inIncludingFee) / b),
            ts,
            curveSol: quote === WSOL ? Number(quoteReserve) / q : null,
          });
        } else if (DBC_COMPLETE.has(ev) && ctx?.role.kind === "trade") {
          out.push({ kind: "complete", mint: ctx.accounts[ctx.role.mint]! });
        }
      }
    } catch {
      // A truncated or unfamiliar event: skip it.
    }
  }
  return out;
}

function createOf(
  venue: Venue,
  role: Extract<Role, { kind: "create" }>,
  accounts: string[],
  ev: { name: string; symbol: string; creator: string; ts: number },
  tx: LaunchpadTx,
): PumpEvent {
  const mint = accounts[role.mint]!;
  const quote = accounts[role.quote]!;
  // The whole supply sits in the curve's vault right after the launch.
  const supply = tx.after.get(accounts[role.vault]!);
  return {
    kind: "create",
    venue,
    name: ev.name.slice(0, 64),
    symbol: ev.symbol.slice(0, 32),
    mint,
    creator: ev.creator,
    ts: ev.ts,
    ...(quote !== WSOL ? { quote } : {}),
    ...(supply && supply > 0 ? { supply } : {}),
  };
}
