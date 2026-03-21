#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, String, Vec, token,
};

// ── Constants ──────────────────────────────────────────────────────────────
const MIN_STAKE:       i128 = 1_000_000;   // 0.1 XLM minimum vote weight
const MAX_QUESTION:    u32  = 200;
const MAX_PROPOSALS:   u32  = 100;

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum VoteOutcome {
    Pending,
    Yes,
    No,
    Tie,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id:            u64,
    pub creator:       Address,
    pub question:      String,
    pub yes_weight:    i128,   // total XLM staked YES
    pub no_weight:     i128,   // total XLM staked NO
    pub yes_count:     u32,    // number of yes voters
    pub no_count:      u32,    // number of no voters
    pub deadline:      u32,    // ledger sequence deadline
    pub created_at:    u32,
    pub outcome:       VoteOutcome,
    pub total_staked:  i128,
}

#[contracttype]
pub enum DataKey {
    Proposal(u64),
    Count,
    Recent,               // Vec<u64> last 20
    Voted(u64, Address),  // has this address voted on proposal N?
}

#[contract]
pub struct QuorumVoteContract;

#[contractimpl]
impl QuorumVoteContract {
    /// Create a proposal — anyone can post
    pub fn create_proposal(
        env: Env,
        creator: Address,
        question: String,
        duration_ledgers: u32,  // how many ledgers until voting ends
    ) -> u64 {
        creator.require_auth();
        assert!(question.len() > 0 && question.len() <= MAX_QUESTION, "Question 1–200 chars");
        assert!(duration_ledgers >= 100,   "Min duration 100 ledgers (~8 min)");
        assert!(duration_ledgers <= 535_680, "Max duration 535,680 ledgers (~31 days)");

        let count: u64 = env.storage().instance()
            .get(&DataKey::Count).unwrap_or(0u64);
        assert!(count < MAX_PROPOSALS as u64, "Proposal limit reached");

        let id = count + 1;
        let deadline = env.ledger().sequence() + duration_ledgers;

        let proposal = Proposal {
            id,
            creator: creator.clone(),
            question,
            yes_weight: 0,
            no_weight: 0,
            yes_count: 0,
            no_count: 0,
            deadline,
            created_at: env.ledger().sequence(),
            outcome: VoteOutcome::Pending,
            total_staked: 0,
        };

        env.storage().persistent().set(&DataKey::Proposal(id), &proposal);
        env.storage().instance().set(&DataKey::Count, &id);

        let mut recent: Vec<u64> = env.storage().instance()
            .get(&DataKey::Recent).unwrap_or(Vec::new(&env));
        recent.push_back(id);
        while recent.len() > 20 { recent.remove(0); }
        env.storage().instance().set(&DataKey::Recent, &recent);

        env.events().publish((symbol_short!("created"),), (id, creator, deadline));
        id
    }

    /// Cast a stake-weighted vote — XLM is locked in contract
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        vote_yes: bool,
        stake: i128,
        xlm_token: Address,
    ) {
        voter.require_auth();
        assert!(stake >= MIN_STAKE, "Stake too low, min 0.1 XLM");

        let vote_key = DataKey::Voted(proposal_id, voter.clone());
        assert!(
            !env.storage().persistent().has(&vote_key),
            "Already voted on this proposal"
        );

        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).expect("Proposal not found");

        assert!(proposal.outcome == VoteOutcome::Pending, "Voting has ended");
        assert!(
            env.ledger().sequence() <= proposal.deadline,
            "Voting deadline passed"
        );

        // Transfer stake to contract
        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&voter, &env.current_contract_address(), &stake);

        if vote_yes {
            proposal.yes_weight += stake;
            proposal.yes_count  += 1;
        } else {
            proposal.no_weight += stake;
            proposal.no_count  += 1;
        }
        proposal.total_staked += stake;

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().persistent().set(&vote_key, &stake);

        env.events().publish(
            (symbol_short!("voted"),),
            (proposal_id, voter, vote_yes, stake),
        );
    }

    /// Finalise a proposal after deadline — anyone can call
    pub fn finalise(env: Env, proposal_id: u64) {
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).expect("Proposal not found");

        assert!(proposal.outcome == VoteOutcome::Pending, "Already finalised");
        assert!(
            env.ledger().sequence() > proposal.deadline,
            "Deadline not reached yet"
        );

        proposal.outcome = if proposal.yes_weight > proposal.no_weight {
            VoteOutcome::Yes
        } else if proposal.no_weight > proposal.yes_weight {
            VoteOutcome::No
        } else {
            VoteOutcome::Tie
        };

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.events().publish((symbol_short!("finalsd"),), (proposal_id,));
    }

    // ── Reads ──────────────────────────────────────────────────────────────
    pub fn get_proposal(env: Env, id: u64) -> Proposal {
        env.storage().persistent()
            .get(&DataKey::Proposal(id)).expect("Proposal not found")
    }

    pub fn has_voted(env: Env, proposal_id: u64, voter: Address) -> bool {
        env.storage().persistent()
            .has(&DataKey::Voted(proposal_id, voter))
    }

    pub fn get_vote_weight(env: Env, proposal_id: u64, voter: Address) -> i128 {
        env.storage().persistent()
            .get(&DataKey::Voted(proposal_id, voter))
            .unwrap_or(0i128)
    }

    pub fn get_recent(env: Env) -> Vec<u64> {
        env.storage().instance()
            .get(&DataKey::Recent).unwrap_or(Vec::new(&env))
    }

    pub fn count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }
}
