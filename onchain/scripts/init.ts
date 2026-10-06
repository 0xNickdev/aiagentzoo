/**
 * Initializes zoo_feed for a launched token.
 *
 *   MINT=<token mint> ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json \
 *     npx ts-node scripts/init.ts
 *
 * Amounts in params.json are whole tokens; they are scaled by the mint's decimals.
 * The token program (SPL Token or Token-2022) is read from the mint's owner.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import params from "./params.json";
import { ZooFeed } from "../target/types/zoo_feed";

async function main() {
  const mintArg = process.env.MINT;
  if (!mintArg) throw new Error("set MINT to the token mint address");
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.ZooFeed as Program<ZooFeed>;
  const mint = new PublicKey(mintArg);

  const mintInfo = await provider.connection.getAccountInfo(mint);
  if (!mintInfo) throw new Error("mint not found on this cluster");
  const tokenProgram = mintInfo.owner;
  const scale = (whole: number) => new BN(Math.round(whole * 10 ** params.decimals));

  const sig = await program.methods
    .initialize({
      cyclePrice: scale(params.cyclePrice),
      modelPricePerThousand: scale(params.modelPricePerThousand),
      operatorShareBps: params.operatorShareBps,
      signalFee: scale(params.signalFee),
      receiverShareBps: params.receiverShareBps,
      enclosureStake: scale(params.enclosureStake),
      slashBps: params.slashBps,
      spamRejectBps: params.spamRejectBps,
      spamMinSignals: params.spamMinSignals,
    })
    .accounts({ authority: provider.wallet.publicKey, mint, tokenProgram })
    .rpc();
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  console.log("initialized", { program: program.programId.toBase58(), config: config.toBase58(), mint: mint.toBase58(), tokenProgram: tokenProgram.toBase58(), sig });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
