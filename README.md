# QuorumVote

On-chain governance for any question. Post a proposal, set a deadline, and let the community vote with staked XLM. The side with more XLM weight wins. Every vote is a signed Soroban transaction.
## Live Links

| | |
|---|---|
| **Frontend** | `https://quorumvote.vercel.app` |
| **Contract** | `https://stellar.expert/explorer/testnet/contract/CBFFLLBV3Q26MAN5BHPRGA43C7OAB3XD6HCZEOXBUZTW4ZJR4ANRFX25` |

## How It Works

1. **Create** a proposal with a question and voting duration (1–31 days)
2. **Vote** YES or NO — stake XLM to signal conviction
3. One vote per wallet per proposal — can't vote twice
4. After deadline, anyone calls **finalise** to lock in the result
5. Side with higher total XLM weight wins

## Contract Functions

```rust
create_proposal(creator, question, duration_ledgers) -> u64
vote(voter, proposal_id, vote_yes: bool, stake: i128, xlm_token)
finalise(proposal_id)                   // permissionless, post-deadline
get_proposal(id) -> Proposal
has_voted(proposal_id, voter) -> bool
get_recent() -> Vec<u64>
count() -> u64
```

## Stack

| Layer | Tech |
|---|---|
| Contract | Rust + Soroban SDK v22 |
| Network | Stellar Testnet |
| Frontend | React 18 + Vite |
| Wallet | Freighter v1.7.1 |
| Hosting | Vercel |

## Run Locally

```bash
chmod +x scripts/deploy.sh && ./scripts/deploy.sh
cd frontend && npm install && npm run dev
```
