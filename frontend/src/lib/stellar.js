import * as StellarSdk from '@stellar/stellar-sdk'
import { isConnected, requestAccess, getAddress, signTransaction } from '@stellar/freighter-api'

const CONTRACT_ID = (import.meta.env.VITE_CONTRACT_ID || '').trim()
const XLM_TOKEN   = (import.meta.env.VITE_XLM_TOKEN || '').trim()
const NET         = (import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015').trim()
const RPC_URL     = (import.meta.env.VITE_SOROBAN_RPC_URL    || 'https://soroban-testnet.stellar.org').trim()
const DUMMY       = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'

export const rpc = new StellarSdk.rpc.Server(RPC_URL)

export async function connectWallet() {
  const { isConnected: connected } = await isConnected()
  if (!connected) throw new Error('Freighter not installed.')
  const { address, error } = await requestAccess()
  if (error) throw new Error(error)
  return address
}

async function sendTx(publicKey, op) {
  const account = await rpc.getAccount(publicKey)
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE, networkPassphrase: NET,
  }).addOperation(op).setTimeout(60).build()

  const sim = await rpc.simulateTransaction(tx)
  if (StellarSdk.rpc.Api.isSimulationError(sim)) throw new Error(sim.error)

  const prepared = StellarSdk.rpc.assembleTransaction(tx, sim).build()
  const result = await signTransaction(prepared.toXDR(), { networkPassphrase: NET })
  if (result.error) throw new Error(result.error)
  const signed = StellarSdk.TransactionBuilder.fromXDR(result.signedTxXdr, NET)
  const sent = await rpc.sendTransaction(signed)
  return pollTx(sent.hash)
}

async function pollTx(hash) {
  for (let i = 0; i < 30; i++) {
    const r = await rpc.getTransaction(hash)
    if (r.status === 'SUCCESS') return hash
    if (r.status === 'FAILED')  throw new Error('Transaction failed on-chain')
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('Transaction timed out')
}

async function readContract(op) {
  const dummy = new StellarSdk.Account(DUMMY, '0')
  const tx = new StellarSdk.TransactionBuilder(dummy, {
    fee: StellarSdk.BASE_FEE, networkPassphrase: NET,
  }).addOperation(op).setTimeout(30).build()
  const sim = await rpc.simulateTransaction(tx)
  return StellarSdk.scValToNative(sim.result.retval)
}

async function approveXlm(publicKey, stroops) {
  const xlm = new StellarSdk.Contract(XLM_TOKEN)
  return sendTx(publicKey, xlm.call(
    'approve',
    StellarSdk.Address.fromString(publicKey).toScVal(),
    StellarSdk.Address.fromString(CONTRACT_ID).toScVal(),
    new StellarSdk.XdrLargeInt('i128', BigInt(stroops)).toI128(),
    StellarSdk.xdr.ScVal.scvU32(3_110_400),
  ))
}

const tc = () => new StellarSdk.Contract(CONTRACT_ID)

export async function createProposal(creator, question, durationLedgers) {
  return sendTx(creator, tc().call(
    'create_proposal',
    StellarSdk.Address.fromString(creator).toScVal(),
    StellarSdk.xdr.ScVal.scvString(question),
    StellarSdk.xdr.ScVal.scvU32(durationLedgers),
  ))
}

export async function castVote(voter, proposalId, voteYes, stakeXlm) {
  const stroops = Math.ceil(stakeXlm * 10_000_000)
  await approveXlm(voter, stroops)
  return sendTx(voter, tc().call(
    'vote',
    StellarSdk.Address.fromString(voter).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(proposalId))),
    StellarSdk.xdr.ScVal.scvBool(voteYes),
    new StellarSdk.XdrLargeInt('i128', BigInt(stroops)).toI128(),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

export async function finaliseProposal(caller, proposalId) {
  return sendTx(caller, tc().call(
    'finalise',
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(proposalId))),
  ))
}

export async function getProposal(id) {
  try {
    return await readContract(tc().call(
      'get_proposal',
      StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(id)))
    ))
  } catch { return null }
}

export async function hasVoted(proposalId, voter) {
  try {
    return await readContract(tc().call(
      'has_voted',
      StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(proposalId))),
      StellarSdk.Address.fromString(voter).toScVal(),
    ))
  } catch { return false }
}

export async function getRecentIds() {
  try {
    const ids = await readContract(tc().call('get_recent'))
    return Array.isArray(ids) ? [...ids].map(Number).reverse() : []
  } catch { return [] }
}

export async function getProposalCount() {
  try { return Number(await readContract(tc().call('count'))) }
  catch { return 0 }
}

// ledgers remaining to seconds (5s/ledger)
export function ledgersToTime(ledgersLeft) {
  const secs = ledgersLeft * 5
  if (secs <= 0) return 'Ended'
  if (secs < 3600) return `${Math.floor(secs / 60)}m left`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h left`
  return `${Math.floor(secs / 86400)}d left`
}

export const xlm   = s => (Number(s) / 10_000_000).toFixed(1)
export const short = a => a ? `${a.toString().slice(0, 5)}…${a.toString().slice(-4)}` : '—'
export { CONTRACT_ID }


