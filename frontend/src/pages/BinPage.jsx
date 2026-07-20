import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import Toast, { useToast } from '../components/Toast.jsx'

// Below this identification confidence, never auto-add — make the user pick.
const MIN_AUTO_ADD_SCORE = 0.5

function CandidateChip({ candidate, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-xl border text-left transition-colors ${
        active
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      <div className="w-9 h-9 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
        {candidate.img_url ? (
          <img src={candidate.img_url} alt={candidate.name} className="w-full h-full object-contain" />
        ) : (
          <span className="text-[10px] text-gray-400 px-0.5">{candidate.part_num}</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate max-w-[8rem]">{candidate.name}</p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          {candidate.part_num}{typeof candidate.score === 'number' && ` · ${Math.round(candidate.score * 100)}%`}
        </p>
      </div>
    </button>
  )
}

function MatchCard({ match, verified, onCreateProject, creating }) {
  return (
    <div className="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 shadow-sm">
      <div className="w-16 h-16 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center">
        {match.img_url ? (
          <img src={match.img_url} alt={match.name} className="w-full h-full object-contain p-1" />
        ) : (
          <span className="text-2xl">🧱</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">{match.name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {match.set_num}{match.year ? ` · ${match.year}` : ''}{match.theme ? ` · ${match.theme}` : ''}
        </p>
        {verified && (
          <>
            <p className="text-sm font-bold text-blue-600 dark:text-blue-400 mt-0.5">
              {Math.round(match.set_coverage * 100)}% of set present
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              explains {Math.round(match.bin_coverage * 100)}% of bin · {match.matched_pieces}/{match.set_pieces} pieces
            </p>
          </>
        )}
      </div>
      {verified && (
        <button
          onClick={onCreateProject}
          disabled={creating}
          className="flex-shrink-0 bg-blue-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {creating ? 'Creating…' : 'Sort this set'}
        </button>
      )}
    </div>
  )
}

export default function BinPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [bin, setBin] = useState(null)
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')

  const [identifying, setIdentifying] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [activeCandidate, setActiveCandidate] = useState(null)
  const lastAddRef = useRef(null) // { part_num, prevQty }

  const [matching, setMatching] = useState(false)
  const [matchResult, setMatchResult] = useState(null)
  const [creatingSet, setCreatingSet] = useState(null)

  const photoInputRef = useRef(null)
  const { toast, showToast, dismissToast } = useToast()

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await api.getBin(id)
        if (cancelled) return
        setBin(data)
        setParts(data.parts || [])
        setDraftName(data.name)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const pieceCount = useMemo(() => parts.reduce((a, p) => a + p.quantity, 0), [parts])

  const upsertRow = useCallback((row) => {
    setParts((prev) => {
      const i = prev.findIndex((p) => p.id === row.id)
      if (i === -1) return [row, ...prev]
      const next = [...prev]
      next[i] = row
      return next
    })
  }, [])

  const removeRow = useCallback((rowId) => {
    setParts((prev) => prev.filter((p) => p.id !== rowId))
  }, [])

  // --- capture flow ---------------------------------------------------------

  const addCandidate = useCallback(async (candidate, { silent = false } = {}) => {
    const existing = parts.find((p) => p.part_num === candidate.part_num)
    const prevQty = existing ? existing.quantity : 0
    const row = await api.addBinPart(id, {
      part_num: candidate.part_num,
      name: candidate.name || candidate.part_num,
      category: candidate.category,
      img_url: candidate.img_url,
      quantity: 1,
    })
    upsertRow(row)
    lastAddRef.current = { rowId: row.id, part_num: candidate.part_num, prevQty }
    if (!silent) {
      showToast(`+ ${row.name} — ${row.quantity} in bin`, {
        undo: async () => {
          const res = await api.updateBinPart(id, row.id, prevQty)
          if (res.deleted) removeRow(row.id)
          else upsertRow(res)
        },
      })
    }
    return row
  }, [id, parts, upsertRow, removeRow, showToast])

  async function handlePhoto(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setIdentifying(true)
    setCandidates([])
    setActiveCandidate(null)
    try {
      const data = await api.identifyPart(file)
      const found = data.candidates || []
      if (!found.length) {
        showToast('No part recognized — try a closer, well-lit photo', { isError: true })
        return
      }
      setCandidates(found)
      lastAddRef.current = null
      const top = found[0]
      if ((top.score ?? 0) >= MIN_AUTO_ADD_SCORE) {
        setActiveCandidate(top.part_num)
        await addCandidate(top)
      } else {
        // Low confidence: never silently pollute the inventory — make the
        // user pick from the chips instead.
        setActiveCandidate(null)
        showToast(
          `Low confidence (${Math.round((top.score ?? 0) * 100)}%) — tap the correct match below`,
          { isError: true }
        )
      }
    } catch (err) {
      showToast('Identify failed: ' + err.message, { isError: true })
    } finally {
      setIdentifying(false)
    }
  }

  const swapCandidate = useCallback(async (candidate) => {
    if (candidate.part_num === activeCandidate) return
    try {
      const last = lastAddRef.current
      if (last) {
        const res = await api.updateBinPart(id, last.rowId, last.prevQty)
        if (res.deleted) removeRow(last.rowId)
        else upsertRow(res)
      }
      setActiveCandidate(candidate.part_num)
      await addCandidate(candidate, { silent: true })
      showToast(last ? `Swapped to ${candidate.name}` : `+ ${candidate.name} added`)
    } catch (err) {
      showToast('Failed to save: ' + err.message, { isError: true })
    }
  }, [id, activeCandidate, addCandidate, upsertRow, removeRow, showToast])

  // --- quantity steppers ----------------------------------------------------

  const stepQuantity = useCallback(async (row, delta) => {
    const newQty = row.quantity + delta
    if (newQty <= 0) {
      removeRow(row.id)
      try {
        await api.updateBinPart(id, row.id, 0)
        showToast(`Removed ${row.name}`, {
          undo: async () => {
            const readded = await api.addBinPart(id, {
              part_num: row.part_num, name: row.name,
              category: row.category, img_url: row.img_url, quantity: 1,
            })
            upsertRow(readded)
          },
        })
      } catch (err) {
        upsertRow(row)
        showToast('Failed to save, try again', { isError: true })
      }
      return
    }
    upsertRow({ ...row, quantity: newQty })
    try {
      const res = await api.updateBinPart(id, row.id, newQty)
      if (!res.deleted) upsertRow(res)
    } catch (err) {
      upsertRow(row)
      showToast('Failed to save, try again', { isError: true })
    }
  }, [id, upsertRow, removeRow, showToast])

  // --- rename / delete ------------------------------------------------------

  const handleRename = useCallback(async () => {
    if (!draftName.trim() || draftName === bin.name) { setEditingName(false); return }
    try {
      const updated = await api.updateBin(id, { name: draftName.trim() })
      setBin((b) => ({ ...b, name: updated.name }))
      setEditingName(false)
    } catch (e) {
      showToast('Failed to rename', { isError: true })
    }
  }, [id, draftName, bin, showToast])

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete bin "${bin.name}"? Its part inventory will be lost.`)) return
    try {
      await api.deleteBin(id)
      navigate('/bins', { replace: true })
    } catch (e) {
      showToast('Failed to delete', { isError: true })
    }
  }, [id, bin, navigate, showToast])

  // --- matching -------------------------------------------------------------

  async function handleMatch() {
    setMatching(true)
    setMatchResult(null)
    try {
      const result = await api.matchBin(id)
      setMatchResult(result)
      if (!result.matches.length) {
        showToast('No candidate sets found — add more distinctive pieces', { isError: true })
      }
    } catch (err) {
      showToast('Match failed: ' + err.message, { isError: true })
    } finally {
      setMatching(false)
    }
  }

  async function handleCreateProject(match) {
    setCreatingSet(match.set_num)
    try {
      const project = await api.createProject({ set_num: match.set_num, name: match.name })
      navigate(`/projects/${project.id}`)
    } catch (err) {
      showToast('Failed to create project: ' + err.message, { isError: true })
      setCreatingSet(null)
    }
  }

  // --- render ---------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !bin) {
    return (
      <div className="p-4">
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">
          {error || 'Bin not found'}
        </div>
      </div>
    )
  }

  return (
    <div className="pb-4">
      {/* Sticky header */}
      <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 z-20 px-4 pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 mr-2">
            {editingName ? (
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                autoFocus
                className="text-xl font-bold text-gray-900 dark:text-gray-100 w-full border-b-2 border-blue-500 focus:outline-none bg-transparent"
              />
            ) : (
              <h1
                onClick={() => setEditingName(true)}
                className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate cursor-pointer"
                title="Tap to rename"
              >
                {bin.name}
              </h1>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {parts.length} unique part{parts.length !== 1 ? 's' : ''} · {pieceCount} piece{pieceCount !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={handleDelete}
            className="flex-shrink-0 p-2 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
            title="Delete bin"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Capture */}
        <button
          onClick={() => photoInputRef.current?.click()}
          disabled={identifying}
          className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          {identifying ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Identifying…
            </>
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Photograph a piece
            </>
          )}
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          onChange={handlePhoto}
          className="hidden"
        />

        {(candidates.length > 1 || (candidates.length === 1 && activeCandidate === null)) && (
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">
              {activeCandidate === null ? 'Pick the correct match:' : 'Not right? Tap the correct match:'}
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {candidates.map((c) => (
                <CandidateChip
                  key={c.part_num}
                  candidate={c}
                  active={activeCandidate === c.part_num}
                  onClick={() => swapCandidate(c)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Inventory */}
        {parts.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500">
            <div className="text-4xl mb-3">📦</div>
            <p className="text-sm">Empty bin — photograph the first piece to start the inventory</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {parts.map((p) => (
              <div key={p.id} className="flex items-center gap-2.5 px-3 py-2">
                <div className="w-10 h-10 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center">
                  {p.img_url ? (
                    <img src={p.img_url} alt={p.name} className="w-full h-full object-contain p-0.5" />
                  ) : (
                    <span className="text-[10px] text-gray-400 text-center px-0.5">{p.part_num}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 leading-tight line-clamp-2">{p.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {p.part_num}{p.category ? ` · ${p.category}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => stepQuantity(p, -1)}
                    className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-300 font-bold leading-none"
                  >
                    −
                  </button>
                  <span className="w-7 text-center text-sm font-bold text-gray-800 dark:text-gray-200 tabular-nums">{p.quantity}</span>
                  <button
                    onClick={() => stepQuantity(p, 1)}
                    className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-300 font-bold leading-none"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Matching */}
        <button
          onClick={handleMatch}
          disabled={matching || parts.length === 0}
          className="w-full border-2 border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-500 rounded-xl py-3 text-sm font-semibold hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {matching ? (
            <>
              <div className="w-4 h-4 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin" />
              Matching…
            </>
          ) : (
            'Find matching sets'
          )}
        </button>

        {matching && (
          <p className="text-xs text-center text-gray-400 dark:text-gray-500">
            Searching the catalog and verifying set inventories…
          </p>
        )}

        {matchResult && (
          <div className="space-y-2">
            {matchResult.weak_discovery && (
              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-800 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-200">
                No distinctive parts in this bin yet — every piece photographed so far appears in hundreds of sets, so these matches are unreliable. Photograph printed, specialized, or unusual pieces to sharpen the results.
              </div>
            )}
            {!matchResult.verified && matchResult.matches.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-800 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-200">
                Showing unverified candidates — the local catalog couldn't verify these; check BrickScan, or add a Rebrickable API key in Settings as a fallback.
              </div>
            )}
            {matchResult.matches.map((m) => (
              <MatchCard
                key={m.set_num}
                match={m}
                verified={matchResult.verified}
                creating={creatingSet === m.set_num}
                onCreateProject={() => handleCreateProject(m)}
              />
            ))}
            <p className="text-xs text-center text-gray-400 dark:text-gray-500 pt-1">
              {matchResult.considered} candidate set{matchResult.considered !== 1 ? 's' : ''} considered
            </p>
          </div>
        )}
      </div>

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
