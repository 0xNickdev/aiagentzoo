//! ZOOAI AGENCY on-chain settlement.
//!
//! The zoo token is a budget and a stake, not zoo money:
//! - **Feed** pays for cycles. The operator who ran the cycle is paid
//!   `operator_share_bps`; the rest is burned.
//! - **Enclosure stake** is locked before an enclosure may write to the
//!   network. The spam rule slashes it automatically, in code.
//! - **Signal fees** pay for delivering an event into someone else's
//!   enclosure. The receiving keeper earns `receiver_share_bps` only when
//!   they accept the work; the rest is burned.
//! - **Retiring** an enclosure (the keeper, or the warden's kill-switch)
//!   returns the remaining stake and feed to the keeper.
//!
//! Works with both SPL Token and Token-2022 mints.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("BETwmWnijzhfa8NDEBZ6g2T9nPyWbqKwo6Wd2GT9W7Jr");

const BPS: u64 = 10_000;

#[program]
pub mod zoo_feed {
    use super::*;

    /// Creates the protocol config and the vault that holds every stake and all feed.
    pub fn initialize(ctx: Context<Initialize>, params: Params) -> Result<()> {
        params.validate()?;
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.mint = ctx.accounts.mint.key();
        config.vault = ctx.accounts.vault.key();
        config.params = params;
        config.total_burned = 0;
        config.bump = ctx.bumps.config;
        config.vault_bump = ctx.bumps.vault;
        emit!(ParamsUpdated { params });
        Ok(())
    }

    /// Governance may change parameters, and nothing else.
    pub fn update_params(ctx: Context<UpdateParams>, params: Params) -> Result<()> {
        params.validate()?;
        ctx.accounts.config.params = params;
        emit!(ParamsUpdated { params });
        Ok(())
    }

    /// Hands the authority (warden) role to another key, e.g. a multisig.
    pub fn set_authority(ctx: Context<UpdateParams>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.config.authority = new_authority;
        Ok(())
    }

    /// A keeper opens an enclosure for a node and locks the stake.
    pub fn open_enclosure(ctx: Context<OpenEnclosure>, node_id: [u8; 32], operator: Pubkey) -> Result<()> {
        let stake = ctx.accounts.config.params.enclosure_stake;
        let enclosure = &mut ctx.accounts.enclosure;
        enclosure.keeper = ctx.accounts.keeper.key();
        enclosure.operator = operator;
        enclosure.node_id = node_id;
        enclosure.stake = stake;
        enclosure.feed = 0;
        enclosure.cycles = 0;
        enclosure.signals_sent = 0;
        enclosure.signals_rejected = 0;
        enclosure.retired = false;
        enclosure.bump = ctx.bumps.enclosure;

        transfer_in(
            &ctx.accounts.token_program,
            &ctx.accounts.keeper_tokens,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.keeper,
            stake,
        )?;
        emit!(EnclosureOpened { enclosure: enclosure.key(), keeper: enclosure.keeper, operator, node_id, stake });
        Ok(())
    }

    /// Anyone may feed an enclosure: its keeper, or a patron.
    pub fn deposit_feed(ctx: Context<DepositFeed>, amount: u64) -> Result<()> {
        require!(amount > 0, ZooError::InvalidAmount);
        require!(!ctx.accounts.enclosure.retired, ZooError::Retired);
        transfer_in(
            &ctx.accounts.token_program,
            &ctx.accounts.funder_tokens,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.funder,
            amount,
        )?;
        let enclosure = &mut ctx.accounts.enclosure;
        enclosure.feed = enclosure.feed.checked_add(amount).ok_or(ZooError::MathOverflow)?;
        emit!(FeedDeposited { enclosure: enclosure.key(), funder: ctx.accounts.funder.key(), amount, feed: enclosure.feed });
        Ok(())
    }

    /// The node operator settles cycles it ran. Operator share is paid out, the rest burns.
    pub fn settle_cycles(ctx: Context<SettleCycles>, cycles: u32, model_tokens: u64) -> Result<()> {
        require!(cycles > 0, ZooError::InvalidAmount);
        let params = ctx.accounts.config.params;
        let cost = (cycles as u64)
            .checked_mul(params.cycle_price)
            .and_then(|c| c.checked_add(model_tokens.checked_mul(params.model_price_per_thousand)? / 1000))
            .ok_or(ZooError::MathOverflow)?;
        let to_operator = share(cost, params.operator_share_bps)?;
        let burned = cost - to_operator;

        let enclosure = &mut ctx.accounts.enclosure;
        require!(!enclosure.retired, ZooError::Retired);
        require!(enclosure.feed >= cost, ZooError::InsufficientFeed);
        enclosure.feed -= cost;
        enclosure.cycles = enclosure.cycles.checked_add(cycles as u64).ok_or(ZooError::MathOverflow)?;

        let config = &ctx.accounts.config;
        let seeds: &[&[u8]] = &[b"config", &[config.bump]];
        transfer_out(&ctx.accounts.token_program, &ctx.accounts.vault, &ctx.accounts.operator_tokens, &ctx.accounts.mint, config, seeds, to_operator)?;
        burn_from_vault(&ctx.accounts.token_program, &ctx.accounts.vault, &ctx.accounts.mint, config, seeds, burned)?;
        ctx.accounts.config.total_burned = ctx.accounts.config.total_burned.checked_add(burned).ok_or(ZooError::MathOverflow)?;

        emit!(CyclesSettled { enclosure: ctx.accounts.enclosure.key(), cycles, model_tokens, cost, to_operator, burned });
        Ok(())
    }

    /// The sender's operator settles a signal once the receiver has ruled on it.
    /// Accepted: the receiving keeper earns a share. Rejected: the whole fee burns
    /// and counts toward the spam rule, which slashes the sender's stake in code.
    pub fn settle_signal(ctx: Context<SettleSignal>, accepted: bool) -> Result<()> {
        let params = ctx.accounts.config.params;
        let fee = params.signal_fee;
        let to_receiver = if accepted { share(fee, params.receiver_share_bps)? } else { 0 };
        let mut burned = fee - to_receiver;

        let sender = &mut ctx.accounts.sender;
        require!(!sender.retired, ZooError::Retired);
        require!(sender.feed >= fee, ZooError::InsufficientFeed);
        sender.feed -= fee;
        sender.signals_sent = sender.signals_sent.saturating_add(1);
        if !accepted {
            sender.signals_rejected = sender.signals_rejected.saturating_add(1);
        }

        // Spam rule: too many rejected signals over enough volume slashes the stake.
        let mut slashed = 0;
        if sender.signals_sent >= params.spam_min_signals
            && (sender.signals_rejected as u64) * BPS > (sender.signals_sent as u64) * (params.spam_reject_bps as u64)
        {
            slashed = share(sender.stake, params.slash_bps)?;
            sender.stake -= slashed;
            sender.signals_sent = 0;
            sender.signals_rejected = 0;
            burned = burned.checked_add(slashed).ok_or(ZooError::MathOverflow)?;
        }

        let config = &ctx.accounts.config;
        let seeds: &[&[u8]] = &[b"config", &[config.bump]];
        transfer_out(&ctx.accounts.token_program, &ctx.accounts.vault, &ctx.accounts.receiver_keeper_tokens, &ctx.accounts.mint, config, seeds, to_receiver)?;
        burn_from_vault(&ctx.accounts.token_program, &ctx.accounts.vault, &ctx.accounts.mint, config, seeds, burned)?;
        ctx.accounts.config.total_burned = ctx.accounts.config.total_burned.checked_add(burned).ok_or(ZooError::MathOverflow)?;

        emit!(SignalSettled {
            sender: ctx.accounts.sender.key(),
            receiver: ctx.accounts.receiver.key(),
            accepted,
            fee,
            to_receiver,
            burned: burned - slashed,
        });
        if slashed > 0 {
            emit!(StakeSlashed { enclosure: ctx.accounts.sender.key(), amount: slashed, remaining: ctx.accounts.sender.stake });
        }
        Ok(())
    }

    /// Retires an enclosure and returns its stake and feed to the keeper.
    /// The keeper may do it, and so may the warden: the kill-switch is free.
    pub fn retire(ctx: Context<Retire>) -> Result<()> {
        let signer = ctx.accounts.signer.key();
        let enclosure = &ctx.accounts.enclosure;
        require!(signer == enclosure.keeper || signer == ctx.accounts.config.authority, ZooError::Unauthorized);
        require!(!enclosure.retired, ZooError::Retired);
        let amount = enclosure.stake.checked_add(enclosure.feed).ok_or(ZooError::MathOverflow)?;

        let config = &ctx.accounts.config;
        let seeds: &[&[u8]] = &[b"config", &[config.bump]];
        transfer_out(&ctx.accounts.token_program, &ctx.accounts.vault, &ctx.accounts.keeper_tokens, &ctx.accounts.mint, config, seeds, amount)?;

        let enclosure = &mut ctx.accounts.enclosure;
        enclosure.stake = 0;
        enclosure.feed = 0;
        enclosure.retired = true;
        emit!(EnclosureRetired { enclosure: enclosure.key(), by: signer, returned: amount });
        Ok(())
    }
}

/* ---------- helpers ---------- */

fn share(amount: u64, bps: u16) -> Result<u64> {
    Ok(((amount as u128) * (bps as u128) / (BPS as u128)) as u64)
}

fn transfer_in<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new(
            token_program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: vault.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    )
}

fn transfer_out<'info>(
    token_program: &Interface<'info, TokenInterface>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    config: &Account<'info, Config>,
    seeds: &[&[u8]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: config.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

fn burn_from_vault<'info>(
    token_program: &Interface<'info, TokenInterface>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    config: &Account<'info, Config>,
    seeds: &[&[u8]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::burn(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Burn { mint: mint.to_account_info(), from: vault.to_account_info(), authority: config.to_account_info() },
            &[seeds],
        ),
        amount,
    )
}

/* ---------- state ---------- */

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Debug, PartialEq, Eq)]
pub struct Params {
    /// Flat price of one cycle, in token base units.
    pub cycle_price: u64,
    /// Price per 1,000 model tokens, in token base units.
    pub model_price_per_thousand: u64,
    /// Share of cycle spend paid to the operator, basis points. The rest burns.
    pub operator_share_bps: u16,
    /// Fee per signal, in token base units.
    pub signal_fee: u64,
    /// Share of an accepted signal fee paid to the receiving keeper, basis points.
    pub receiver_share_bps: u16,
    /// Stake required to open an enclosure, in token base units.
    pub enclosure_stake: u64,
    /// Fraction of stake slashed when the spam rule trips, basis points.
    pub slash_bps: u16,
    /// Spam rule: rejected / sent above this, basis points...
    pub spam_reject_bps: u16,
    /// ...over at least this many signals.
    pub spam_min_signals: u32,
}

impl Params {
    fn validate(&self) -> Result<()> {
        let bps = [self.operator_share_bps, self.receiver_share_bps, self.slash_bps, self.spam_reject_bps];
        require!(bps.iter().all(|b| (*b as u64) <= BPS), ZooError::InvalidParams);
        require!(self.cycle_price > 0 && self.enclosure_stake > 0 && self.spam_min_signals > 0, ZooError::InvalidParams);
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub params: Params,
    pub total_burned: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Enclosure {
    pub keeper: Pubkey,
    pub operator: Pubkey,
    /// sha256 of the node id string, e.g. sha256("canyon.zoo").
    pub node_id: [u8; 32],
    pub stake: u64,
    pub feed: u64,
    pub cycles: u64,
    pub signals_sent: u32,
    pub signals_rejected: u32,
    pub retired: bool,
    pub bump: u8,
}

/* ---------- accounts ---------- */

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [b"vault"],
        bump,
        token::mint = mint,
        token::authority = config,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateParams<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority @ ZooError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(node_id: [u8; 32])]
pub struct OpenEnclosure<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(init, payer = keeper, space = 8 + Enclosure::INIT_SPACE, seeds = [b"enclosure", node_id.as_ref()], bump)]
    pub enclosure: Account<'info, Enclosure>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = keeper, token::token_program = token_program)]
    pub keeper_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositFeed<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"enclosure", enclosure.node_id.as_ref()], bump = enclosure.bump)]
    pub enclosure: Account<'info, Enclosure>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = funder, token::token_program = token_program)]
    pub funder_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SettleCycles<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"enclosure", enclosure.node_id.as_ref()],
        bump = enclosure.bump,
        has_one = operator @ ZooError::Unauthorized,
    )]
    pub enclosure: Account<'info, Enclosure>,
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = operator,
        associated_token::token_program = token_program,
    )]
    pub operator_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleSignal<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"enclosure", sender.node_id.as_ref()],
        bump = sender.bump,
        constraint = sender.operator == operator.key() @ ZooError::Unauthorized,
    )]
    pub sender: Account<'info, Enclosure>,
    #[account(
        seeds = [b"enclosure", receiver.node_id.as_ref()],
        bump = receiver.bump,
        constraint = receiver.key() != sender.key() @ ZooError::InvalidParams,
    )]
    pub receiver: Account<'info, Enclosure>,
    /// CHECK: only used as the owner of the receiver keeper's token account.
    #[account(address = receiver.keeper)]
    pub receiver_keeper: UncheckedAccount<'info>,
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = receiver_keeper,
        associated_token::token_program = token_program,
    )]
    pub receiver_keeper_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Retire<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"enclosure", enclosure.node_id.as_ref()], bump = enclosure.bump)]
    pub enclosure: Account<'info, Enclosure>,
    /// CHECK: only used as the owner of the keeper's token account.
    #[account(address = enclosure.keeper)]
    pub keeper: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = mint,
        associated_token::authority = keeper,
        associated_token::token_program = token_program,
    )]
    pub keeper_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/* ---------- events and errors ---------- */

#[event]
pub struct ParamsUpdated {
    pub params: Params,
}

#[event]
pub struct EnclosureOpened {
    pub enclosure: Pubkey,
    pub keeper: Pubkey,
    pub operator: Pubkey,
    pub node_id: [u8; 32],
    pub stake: u64,
}

#[event]
pub struct FeedDeposited {
    pub enclosure: Pubkey,
    pub funder: Pubkey,
    pub amount: u64,
    pub feed: u64,
}

#[event]
pub struct CyclesSettled {
    pub enclosure: Pubkey,
    pub cycles: u32,
    pub model_tokens: u64,
    pub cost: u64,
    pub to_operator: u64,
    pub burned: u64,
}

#[event]
pub struct SignalSettled {
    pub sender: Pubkey,
    pub receiver: Pubkey,
    pub accepted: bool,
    pub fee: u64,
    pub to_receiver: u64,
    pub burned: u64,
}

#[event]
pub struct StakeSlashed {
    pub enclosure: Pubkey,
    pub amount: u64,
    pub remaining: u64,
}

#[event]
pub struct EnclosureRetired {
    pub enclosure: Pubkey,
    pub by: Pubkey,
    pub returned: u64,
}

#[error_code]
pub enum ZooError {
    #[msg("signer is not allowed to do this")]
    Unauthorized,
    #[msg("not enough feed in the enclosure")]
    InsufficientFeed,
    #[msg("the enclosure is retired")]
    Retired,
    #[msg("invalid protocol parameters")]
    InvalidParams,
    #[msg("amount must be positive")]
    InvalidAmount,
    #[msg("arithmetic overflow")]
    MathOverflow,
}
