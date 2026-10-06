import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { createHash } from "crypto";
import { ZooFeed } from "../target/types/zoo_feed";

/** pump.fun launches Token-2022 mints, so the whole suite runs on Token-2022. */
const TOKEN = TOKEN_2022_PROGRAM_ID;
const UNIT = 1_000_000; // 6 decimals

const params = {
  cyclePrice: new BN(1 * UNIT),
  modelPricePerThousand: new BN(UNIT / 2),
  operatorShareBps: 8000,
  signalFee: new BN(UNIT / 5),
  receiverShareBps: 5000,
  enclosureStake: new BN(100 * UNIT),
  slashBps: 1000,
  spamRejectBps: 5000,
  spamMinSignals: 4,
};

const nodeId = (id: string) => [...createHash("sha256").update(id).digest()];

describe("zoo_feed", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.ZooFeed as Program<ZooFeed>;
  const conn = provider.connection;
  const authority = (provider.wallet as anchor.Wallet).payer;

  const keeperA = Keypair.generate();
  const keeperB = Keypair.generate();
  const operatorA = Keypair.generate();
  const patron = Keypair.generate();
  const stranger = Keypair.generate();
  let mint: PublicKey;

  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);
  const enclosurePda = (id: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("enclosure"), Buffer.from(nodeId(id))], program.programId)[0];
  const encA = enclosurePda("north.zoo");
  const encB = enclosurePda("canyon.zoo");

  const ata = async (owner: PublicKey) => (await getOrCreateAssociatedTokenAccount(conn, authority, mint, owner, false, undefined, undefined, TOKEN)).address;
  const balance = async (owner: PublicKey) => Number((await getAccount(conn, await ata(owner), undefined, TOKEN)).amount);
  const supply = async () => Number((await getMint(conn, mint, undefined, TOKEN)).supply);

  before(async () => {
    for (const kp of [keeperA, keeperB, operatorA, patron, stranger]) {
      const sig = await conn.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
    }
    mint = await createMint(conn, authority, authority.publicKey, null, 6, undefined, undefined, TOKEN);
    for (const owner of [keeperA.publicKey, keeperB.publicKey, patron.publicKey]) {
      await mintTo(conn, authority, mint, await ata(owner), authority, 1_000 * UNIT, [], undefined, TOKEN);
    }
  });

  it("initializes config and vault", async () => {
    await program.methods.initialize(params).accounts({ authority: authority.publicKey, mint, tokenProgram: TOKEN }).rpc();
    const c = await program.account.config.fetch(config);
    expect(c.mint.toBase58()).to.equal(mint.toBase58());
    expect(c.params.operatorShareBps).to.equal(8000);
  });

  it("rejects parameter changes from anyone but the authority", async () => {
    try {
      await program.methods.updateParams(params).accounts({ authority: stranger.publicKey }).signers([stranger]).rpc();
      expect.fail("should have failed");
    } catch (e) {
      expect(String(e)).to.match(/Unauthorized|ConstraintHasOne|2001/);
    }
  });

  it("opens enclosures and locks the stake", async () => {
    await program.methods
      .openEnclosure(nodeId("north.zoo"), operatorA.publicKey)
      .accounts({ keeper: keeperA.publicKey, mint, keeperTokens: await ata(keeperA.publicKey), tokenProgram: TOKEN })
      .signers([keeperA])
      .rpc();
    await program.methods
      .openEnclosure(nodeId("canyon.zoo"), keeperB.publicKey)
      .accounts({ keeper: keeperB.publicKey, mint, keeperTokens: await ata(keeperB.publicKey), tokenProgram: TOKEN })
      .signers([keeperB])
      .rpc();
    expect((await program.account.enclosure.fetch(encA)).stake.toNumber()).to.equal(100 * UNIT);
    expect(await balance(keeperA.publicKey)).to.equal(900 * UNIT);
  });

  it("lets a patron feed someone else's enclosure", async () => {
    await program.methods
      .depositFeed(new BN(50 * UNIT))
      .accounts({ funder: patron.publicKey, enclosure: encA, mint, funderTokens: await ata(patron.publicKey), tokenProgram: TOKEN })
      .signers([patron])
      .rpc();
    expect((await program.account.enclosure.fetch(encA)).feed.toNumber()).to.equal(50 * UNIT);
  });

  it("settles cycles: operator paid, the rest burned", async () => {
    const before = await supply();
    // 3 cycles + 2,000 model tokens = 3 + 1 = 4 tokens
    await program.methods
      .settleCycles(3, new BN(2000))
      .accounts({ operator: operatorA.publicKey, enclosure: encA, mint, tokenProgram: TOKEN })
      .signers([operatorA])
      .rpc();
    expect(await balance(operatorA.publicKey)).to.equal(3.2 * UNIT);
    expect(before - (await supply())).to.equal(0.8 * UNIT);
    const e = await program.account.enclosure.fetch(encA);
    expect(e.feed.toNumber()).to.equal(46 * UNIT);
    expect(e.cycles.toNumber()).to.equal(3);
  });

  it("refuses cycle settlement from anyone but the enclosure's operator", async () => {
    try {
      await program.methods
        .settleCycles(1, new BN(0))
        .accounts({ operator: stranger.publicKey, enclosure: encA, mint, tokenProgram: TOKEN })
        .signers([stranger])
        .rpc();
      expect.fail("should have failed");
    } catch (e) {
      expect(String(e)).to.match(/Unauthorized/);
    }
  });

  it("pays the receiving keeper only for accepted signals", async () => {
    const before = await balance(keeperB.publicKey);
    await program.methods
      .settleSignal(true)
      .accounts({ operator: operatorA.publicKey, sender: encA, receiver: encB, receiverKeeper: keeperB.publicKey, mint, tokenProgram: TOKEN })
      .signers([operatorA])
      .rpc();
    expect((await balance(keeperB.publicKey)) - before).to.equal(0.1 * UNIT);

    const mid = await balance(keeperB.publicKey);
    await program.methods
      .settleSignal(false)
      .accounts({ operator: operatorA.publicKey, sender: encA, receiver: encB, receiverKeeper: keeperB.publicKey, mint, tokenProgram: TOKEN })
      .signers([operatorA])
      .rpc();
    expect(await balance(keeperB.publicKey)).to.equal(mid);
  });

  it("slashes the sender's stake when the spam rule trips", async () => {
    // 2 sent so far (1 rejected). Two more rejections: 3/4 rejected > 50% over 4 signals.
    for (let i = 0; i < 2; i++) {
      await program.methods
        .settleSignal(false)
        .accounts({ operator: operatorA.publicKey, sender: encA, receiver: encB, receiverKeeper: keeperB.publicKey, mint, tokenProgram: TOKEN })
        .signers([operatorA])
        .rpc();
    }
    const e = await program.account.enclosure.fetch(encA);
    expect(e.stake.toNumber()).to.equal(90 * UNIT);
    expect(e.signalsSent).to.equal(0);
  });

  it("refuses to spend feed the enclosure does not have", async () => {
    try {
      await program.methods
        .settleCycles(1000, new BN(0))
        .accounts({ operator: operatorA.publicKey, enclosure: encA, mint, tokenProgram: TOKEN })
        .signers([operatorA])
        .rpc();
      expect.fail("should have failed");
    } catch (e) {
      expect(String(e)).to.match(/InsufficientFeed/);
    }
  });

  it("lets the warden retire an enclosure and returns stake and feed to the keeper", async () => {
    const e = await program.account.enclosure.fetch(encA);
    const owed = e.stake.toNumber() + e.feed.toNumber();
    const before = await balance(keeperA.publicKey);
    await program.methods
      .retire()
      .accounts({ signer: authority.publicKey, enclosure: encA, keeper: keeperA.publicKey, mint, tokenProgram: TOKEN })
      .rpc();
    expect((await balance(keeperA.publicKey)) - before).to.equal(owed);
    expect((await program.account.enclosure.fetch(encA)).retired).to.equal(true);
  });

  it("refuses feed and a second retire after retirement, and strangers cannot retire", async () => {
    for (const attempt of [
      async () =>
        program.methods
          .depositFeed(new BN(UNIT))
          .accounts({ funder: patron.publicKey, enclosure: encA, mint, funderTokens: await ata(patron.publicKey), tokenProgram: TOKEN })
          .signers([patron])
          .rpc(),
      () =>
        program.methods.retire().accounts({ signer: authority.publicKey, enclosure: encA, keeper: keeperA.publicKey, mint, tokenProgram: TOKEN }).rpc(),
      () =>
        program.methods
          .retire()
          .accounts({ signer: stranger.publicKey, enclosure: encB, keeper: keeperB.publicKey, mint, tokenProgram: TOKEN })
          .signers([stranger])
          .rpc(),
    ]) {
      try {
        await attempt();
        expect.fail("should have failed");
      } catch (e) {
        expect(String(e)).to.not.match(/should have failed/);
      }
    }
  });

  it("keeps the vault exactly equal to stakes plus feed", async () => {
    const a = await program.account.enclosure.fetch(encA);
    const b = await program.account.enclosure.fetch(encB);
    const vaultBalance = Number((await getAccount(conn, vault, undefined, TOKEN)).amount);
    expect(vaultBalance).to.equal(a.stake.toNumber() + a.feed.toNumber() + b.stake.toNumber() + b.feed.toNumber());
  });
});
