import { useState, useEffect, useRef } from 'react'
import {
  connectWallet, createProposal, castVote, finaliseProposal,
  getProposal, hasVoted, getRecentIds, getProposalCount,
  ledgersToTime, xlm, short, CONTRACT_ID,
} from './lib/stellar'

// ── Live countdown hook ────────────────────────────────────────────────────
function useCountdown(deadline, currentLedger) {
  const [left, setLeft] = useState(Math.max(0, deadline - currentLedger))
  useEffect(() => {
    const id = setInterval(() => {
      setLeft(prev => Math.max(0, prev - 1))
    }, 5000) // update every 5s (1 ledger)
    return () => clearInterval(id)
  }, [])
  return left
}

// ── Outcome badge ──────────────────────────────────────────────────────────
function OutcomeBadge({ outcome, pending }) {
  if (pending) return <span className="outcome-badge badge-live">LIVE</span>
  if (outcome === 'Yes') return <span className="outcome-badge badge-yes">PASSED</span>
  if (outcome === 'No')  return <span className="outcome-badge badge-no">REJECTED</span>
  if (outcome === 'Tie') return <span className="outcome-badge badge-tie">TIE</span>
  return null
}

// ── Vote split bar ─────────────────────────────────────────────────────────
function VoteSplit({ yes, no, total }) {
  const yesPct = total > 0 ? (Number(yes) / Number(total)) * 100 : 50
  const noPct  = 100 - yesPct
  return (
    <div className="vote-split">
      <div className="split-bar">
        <div className="split-yes" style={{ width: `${yesPct}%` }} />
        <div className="split-no"  style={{ width: `${noPct}%` }} />
      </div>
      <div className="split-labels">
        <span className="sl-yes">YES {yesPct.toFixed(1)}% · {xlm(yes)} XLM</span>
        <span className="sl-no">{xlm(no)} XLM · {noPct.toFixed(1)}% NO</span>
      </div>
    </div>
  )
}

// ── Proposal card ──────────────────────────────────────────────────────────
function ProposalCard({ proposal, currentLedger, wallet, onAction }) {
  const [stakeAmt,  setStakeAmt]  = useState('1')
  const [showVote,  setShowVote]  = useState(false)
  const [voted,     setVoted]     = useState(false)
  const [busy,      setBusy]      = useState(false)

  const ledgersLeft = Math.max(0, Number(proposal.deadline) - currentLedger)
  const isLive      = proposal.outcome === 'Pending' && ledgersLeft > 0
  const canFinalise = proposal.outcome === 'Pending' && ledgersLeft === 0

  useEffect(() => {
    if (wallet) hasVoted(proposal.id, wallet).then(setVoted)
  }, [wallet, proposal.id])

  const handle = async (fn, msg) => {
    setBusy(true)
    try {
      const hash = await fn()
      onAction({ ok: true, msg, hash, refresh: true })
      setShowVote(false)
    } catch (e) { onAction({ ok: false, msg: e.message }) }
    finally { setBusy(false) }
  }

  const totalVoters = Number(proposal.yes_count) + Number(proposal.no_count)

  return (
    <div className={`proposal-card ${!isLive ? 'card-ended' : ''} ${proposal.outcome === 'Yes' ? 'card-passed' : proposal.outcome === 'No' ? 'card-rejected' : ''}`}>
      <div className="pc-top">
        <div className="pc-left">
          <span className="pc-id">#{proposal.id?.toString().padStart(3, '0')}</span>
          <OutcomeBadge
            outcome={proposal.outcome}
            pending={proposal.outcome === 'Pending'}
          />
        </div>
        <div className="pc-right">
          <span className="pc-timer">{ledgersToTime(ledgersLeft)}</span>
          <span className="pc-voters">{totalVoters} voters</span>
        </div>
      </div>

      <p className="pc-question">{proposal.question}</p>

      <VoteSplit yes={proposal.yes_weight} no={proposal.no_weight} total={proposal.total_staked} />

      <div className="pc-meta">
        <span className="pc-meta-item">
          <span className="pm-icon">◈</span>
          {xlm(proposal.total_staked)} XLM staked
        </span>
        <span className="pc-meta-item">
          <span className="pm-icon">◉</span>
          by {short(proposal.creator)}
        </span>
        <span className="pc-meta-item">
          <span className="pm-icon">◷</span>
          ledger {proposal.deadline?.toString()}
        </span>
      </div>

      {/* Actions */}
      {wallet && isLive && !voted && (
        <div className="pc-actions">
          <button
            className={`btn-vote-toggle ${showVote ? 'vt-active' : ''}`}
            onClick={() => setShowVote(v => !v)}
          >
            CAST VOTE
          </button>
        </div>
      )}

      {wallet && voted && isLive && (
        <div className="voted-tag">✓ You voted on this proposal</div>
      )}

      {wallet && canFinalise && (
        <div className="pc-actions">
          <button className="btn-finalise" disabled={busy}
            onClick={() => handle(() => finaliseProposal(wallet, proposal.id), 'Proposal finalised!')}>
            {busy ? 'Signing…' : 'FINALISE RESULT'}
          </button>
        </div>
      )}

      {showVote && isLive && !voted && (
        <div className="vote-panel">
          <div className="vp-label">Stake XLM to signal conviction</div>
          <div className="vp-presets">
            {['0.5','1','2','5','10'].map(v => (
              <button key={v}
                className={`vp-preset ${stakeAmt === v ? 'vp-active' : ''}`}
                onClick={() => setStakeAmt(v)}>
                {v} XLM
              </button>
            ))}
            <input
              className="vp-custom"
              type="number" min="0.1" step="0.1"
              value={stakeAmt}
              onChange={e => setStakeAmt(e.target.value)}
            />
          </div>
          <div className="vp-btns">
            <button className="btn-yes" disabled={busy}
              onClick={() => handle(
                () => castVote(wallet, proposal.id, true, parseFloat(stakeAmt)),
                `Voted YES with ${stakeAmt} XLM`
              )}>
              {busy ? '…' : `✓ YES — ${stakeAmt} XLM`}
            </button>
            <button className="btn-no" disabled={busy}
              onClick={() => handle(
                () => castVote(wallet, proposal.id, false, parseFloat(stakeAmt)),
                `Voted NO with ${stakeAmt} XLM`
              )}>
              {busy ? '…' : `✗ NO — ${stakeAmt} XLM`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Create proposal form ───────────────────────────────────────────────────
function CreateForm({ wallet, onCreated }) {
  const [question, setQuestion] = useState('')
  const [days,     setDays]     = useState('3')
  const [busy,     setBusy]     = useState(false)
  const [err,      setErr]      = useState('')

  // 1 day ≈ 17,280 ledgers
  const ledgers = Math.round(parseFloat(days || 1) * 17_280)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!wallet) return
    setBusy(true); setErr('')
    try {
      const hash = await createProposal(wallet, question, ledgers)
      onCreated(hash)
      setQuestion('')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <form className="create-form" onSubmit={handleSubmit}>
      <div className="cf-header">
        <div className="cf-number">NEW</div>
        <div className="cf-title">CREATE PROPOSAL</div>
      </div>

      <div className="cf-field">
        <label>THE QUESTION</label>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Should the community…? Will this proposal…? Do you agree that…?"
          maxLength={200}
          rows={3}
          required
          disabled={!wallet || busy}
        />
        <span className="cf-chars">{question.length}/200</span>
      </div>

      <div className="cf-field">
        <label>VOTING PERIOD (DAYS)</label>
        <div className="cf-duration-row">
          {['1','3','7','14'].map(d => (
            <button key={d} type="button"
              className={`cf-dur-btn ${days === d ? 'dur-active' : ''}`}
              onClick={() => setDays(d)}>
              {d}d
            </button>
          ))}
          <input
            type="number" min="1" max="31" step="1"
            value={days}
            onChange={e => setDays(e.target.value)}
            className="cf-dur-custom"
            disabled={busy}
          />
        </div>
        <span className="cf-ledgers">≈ {ledgers.toLocaleString()} ledgers</span>
      </div>

      {err && <p className="cf-err">{err}</p>}

      <button type="submit" className="btn-create-proposal"
        disabled={!wallet || busy || !question.trim()}>
        {!wallet ? 'CONNECT WALLET FIRST' : busy ? 'DEPLOYING…' : 'DEPLOY PROPOSAL'}
      </button>
    </form>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function App() {
  const [wallet,         setWallet]         = useState(null)
  const [proposals,      setProposals]      = useState([])
  const [proposalCount,  setProposalCount]  = useState(0)
  const [currentLedger,  setCurrentLedger]  = useState(0)
  const [loading,        setLoading]        = useState(true)
  const [tab,            setTab]            = useState('proposals')
  const [toast,          setToast]          = useState(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const [ids, count] = await Promise.all([getRecentIds(), getProposalCount()])
      setProposalCount(count)

      // Estimate current ledger from first proposal deadline
      const loaded = await Promise.allSettled(ids.map(id => getProposal(id)))
      const valid = loaded.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value)
      setProposals(valid)

      // Use RPC to get current ledger sequence
      try {
        const ledger = await fetch('https://soroban-testnet.stellar.org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLedgers', params: { limit: 1 } }),
        }).then(r => r.json()).then(d => d.result?.ledgers?.[0]?.sequence || 0)
        if (ledger) setCurrentLedger(ledger)
      } catch {}
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const handleConnect = async () => {
    try { setWallet(await connectWallet()) }
    catch (e) { showToast(false, e.message) }
  }

  const showToast = (ok, msg, hash) => {
    setToast({ ok, msg, hash })
    setTimeout(() => setToast(null), 6000)
  }

  const handleAction = ({ ok, msg, hash, refresh }) => {
    showToast(ok, msg, hash)
    if (ok && refresh) loadData()
  }

  const handleCreated = (hash) => {
    showToast(true, 'Proposal deployed on-chain!', hash)
    setTab('proposals')
    loadData()
  }

  const liveCount    = proposals.filter(p => p.outcome === 'Pending').length
  const totalStaked  = proposals.reduce((s, p) => s + Number(p.total_staked), 0)

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="brand">
          <div className="brand-q">Q</div>
          <div className="brand-text">
            <span className="brand-name">QUORUM</span>
            <span className="brand-sub">VOTE</span>
          </div>
        </div>

        <div className="header-stats">
          <div className="hstat">
            <span className="hs-n">{proposalCount}</span>
            <span className="hs-l">PROPOSALS</span>
          </div>
          <div className="hstat-div" />
          <div className="hstat">
            <span className="hs-n">{liveCount}</span>
            <span className="hs-l">LIVE NOW</span>
          </div>
          <div className="hstat-div" />
          <div className="hstat">
            <span className="hs-n">{(totalStaked / 10_000_000).toFixed(0)}</span>
            <span className="hs-l">XLM STAKED</span>
          </div>
        </div>

        <div className="header-right">
          {wallet
            ? <div className="wallet-pill"><span className="wdot" />{short(wallet)}</div>
            : <button className="btn-connect" onClick={handleConnect}>CONNECT WALLET</button>
          }
        </div>
      </header>

      {/* ── Tab bar ── */}
      <div className="tab-bar">
        <button className={`tbar-btn ${tab === 'proposals' ? 'tbar-active' : ''}`}
          onClick={() => setTab('proposals')}>
          All Proposals
        </button>
        <button className={`tbar-btn ${tab === 'create' ? 'tbar-active' : ''}`}
          onClick={() => setTab('create')}>
          + New Proposal
        </button>
        <button className="tbar-btn tbar-refresh" onClick={loadData}>↻</button>
        <a className="tbar-contract"
          href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
          target="_blank" rel="noreferrer">
          Contract ↗
        </a>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>
          <span>{toast.msg}</span>
          {toast.hash && (
            <a href={`https://stellar.expert/explorer/testnet/tx/${toast.hash}`}
              target="_blank" rel="noreferrer" className="toast-link">TX ↗</a>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <main className="main">
        {tab === 'create' && (
          <div className="create-wrap">
            <CreateForm wallet={wallet} onCreated={handleCreated} />
          </div>
        )}

        {tab === 'proposals' && (
          loading ? (
            <div className="loading-grid">
              {[1,2,3].map(i => <div key={i} className="proposal-skeleton" />)}
            </div>
          ) : proposals.length === 0 ? (
            <div className="empty">
              <div className="empty-q">?</div>
              <div className="empty-title">No proposals yet.</div>
              <p className="empty-sub">Be the first to put a question on-chain.</p>
              <button className="btn-first" onClick={() => setTab('create')}>
                CREATE FIRST PROPOSAL
              </button>
            </div>
          ) : (
            <div className="proposals-grid">
              {proposals.map(p => (
                <ProposalCard
                  key={p.id?.toString()}
                  proposal={p}
                  currentLedger={currentLedger}
                  wallet={wallet}
                  onAction={handleAction}
                />
              ))}
            </div>
          )
        )}
      </main>

      <footer className="footer">
        <span>QuorumVote · Stellar Testnet · Soroban</span>
        <a href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
          target="_blank" rel="noreferrer">Contract ↗</a>
      </footer>
    </div>
  )
}
