/**
 * End-to-end run against a deployed zoo_feed: opens the three Night Watch
 * enclosures (if missing), feeds them, settles a cycle and a signal.
 *
 *   MINT=<mint> ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json npx ts-node scripts/demo.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import { ZooFeed } from "../target/types/zoo_feed";

const nodeId = (id: string) => [...createHash("sha256").update(id).digest()];

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.ZooFeed as Program<ZooFeed>;
  const me = provider.wallet.publicKey;
  const mint = new PublicKey(process.env.MINT!);
  const tokenProgram = (await provider.connection.getAccountInfo(mint))!.owner;
  const decimals = (await getMint(provider.connection, mint, undefined, tokenProgram)).decimals;
  const myTokens = getAssociatedTokenAddressSync(mint, me, false, tokenProgram);
  const pda = (id: string) => PublicKey.findProgramAddressSync([Buffer.from("enclosure"), Buffer.from(nodeId(id))], program.programId)[0];

  for (const id of ["north.zoo", "marsh.zoo", "canyon.zoo"]) {
    if (!(await provider.connection.getAccountInfo(pda(id)))) {
      await program.methods.openEnclosure(nodeId(id), me).accountsPartial({ keeper: me, mint, keeperTokens: myTokens, tokenProgram }).rpc();
      console.log("opened", id, pda(id).toBase58());
    }
    await program.methods.depositFeed(new BN(500 * 10 ** decimals)).accountsPartial({ funder: me, enclosure: pda(id), mint, funderTokens: myTokens, tokenProgram }).rpc();
  }

  const cycle = await program.methods.settleCycles(6, new BN(4000)).accountsPartial({ operator: me, enclosure: pda("north.zoo"), mint, tokenProgram }).rpc();
  const signal = await program.methods
    .settleSignal(true)
    .accountsPartial({ operator: me, sender: pda("north.zoo"), receiver: pda("canyon.zoo"), receiverKeeper: me, mint, tokenProgram })
    .rpc();

  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const c = await program.account.config.fetch(config);
  for (const id of ["north.zoo", "marsh.zoo", "canyon.zoo"]) {
    const e = await program.account.enclosure.fetch(pda(id));
    console.log(id, { stake: e.stake.toNumber() / 10 ** decimals, feed: e.feed.toNumber() / 10 ** decimals, cycles: e.cycles.toNumber() });
  }
  console.log({ totalBurned: c.totalBurned.toNumber() / 10 ** decimals, cycleTx: cycle, signalTx: signal });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
