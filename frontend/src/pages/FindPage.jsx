import { useState, useRef, useCallback } from 'react'
import { api } from '../api.js'
import PartCard from '../components/PartCard.jsx'
import Toast, { useToast } from '../components/Toast.jsx'

export default function FindPage() {
  const [query, setQuery] = useState('')
  const [tiles, setTiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searched, setSearched] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [activeCandidate, setActiveCandidate] = useState(null)
  const [identifying, setIdentifying] = useState(false)
  const debounceRef = useRef(null)
  const photoInputRef = useRef(null)
  const { toast, showToast, dismissToast } = useToast()

  const doSearch = useCallback(async (q) => {
    if (q.trim().length < 2) {
      setTiles([])
      setSearched(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await api.searchParts(q)
      // One tile per (project, part); tile id must be unique across projects
      setTiles((data.results || []).map((r) => ({
        ...r.part,
        id: `${r.project_id}|${r.part.id}`,
        _projectId: r.project_id,
        _setPartId: r.part.id,
        projectName: r.project_name,
        _foundQty: r.found_qty,
      })))
      setSearched(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  function handleChange(e) {
    const q = e.target.value
    setQuery(q)
    setCandidates([])
    setActiveCandidate(null)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(q), 350)
  }

  const searchCandidate = useCallback((candidate) => {
    setActiveCandidate(candidate.part_num)
    setQuery(candidate.part_num)
    doSearch(candidate.part_num)
  }, [doSearch])

  async function handlePhoto(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // allow re-selecting the same photo
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
      searchCandidate(found[0])
    } catch (err) {
      showToast('Identify failed: ' + err.message, { isError: true })
    } finally {
      setIdentifying(false)
    }
  }

  const handlePartUpdateRef = useRef(null)
  const handlePartUpdate = useCallback(async (tileId, newQty, { silent = false } = {}) => {
    const tile = tiles.find((t) => t.id === tileId)
    if (!tile || tile._foundQty === newQty) return
    const prevQty = tile._foundQty
    setTiles((prev) => prev.map((t) => (t.id === tileId ? { ...t, _foundQty: newQty } : t)))
    if (!silent) {
      showToast(`${tile.part_name} — ${newQty}/${tile.quantity}`, {
        undo: () => handlePartUpdateRef.current(tileId, prevQty, { silent: true }),
      })
    }
    try {
      await api.updatePart(tile._projectId, tile._setPartId, newQty)
    } catch {
      setTiles((prev) => prev.map((t) => (t.id === tileId ? { ...t, _foundQty: prevQty } : t)))
      showToast('Failed to save, try again', { isError: true })
    }
  }, [tiles, showToast])
  handlePartUpdateRef.current = handlePartUpdate

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Find a Part</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Holding a piece? Snap a photo of it, or search by the number molded on it, to see which projects need it.
      </p>

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={handleChange}
            placeholder="Part number, element ID, or name…"
            autoFocus
            className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 dark:text-gray-100 shadow-sm"
          />
        </div>
        <button
          onClick={() => photoInputRef.current?.click()}
          disabled={identifying}
          className="flex-shrink-0 w-12 rounded-xl bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          title="Photograph a piece to identify it"
        >
          {identifying ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          )}
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          onChange={handlePhoto}
          className="hidden"
        />
      </div>

      {candidates.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Best matches — tap to search:</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {candidates.map((c) => (
              <button
                key={c.part_num}
                onClick={() => searchCandidate(c)}
                className={`flex-shrink-0 flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-xl border text-left transition-colors ${
                  activeCandidate === c.part_num
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
                  {c.img_url ? (
                    <img src={c.img_url} alt={c.name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-gray-400 px-0.5">{c.part_num}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate max-w-[8rem]">{c.name}</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    {c.part_num}{typeof c.score === 'number' && ` · ${Math.round(c.score * 100)}%`}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Searching…</div>}

      {error && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl p-3 text-sm text-red-700 dark:text-red-300 mb-4">
          {error}
        </div>
      )}

      {!loading && searched && tiles.length === 0 && !error && (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
          No project needs a part matching "{query}"
        </div>
      )}

      {!loading && !searched && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">🔎</div>
          <p className="text-sm">Tap the camera and photograph a piece, or type "3001" or "brick 2 x 4"</p>
        </div>
      )}

      {tiles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {tiles.map((tile) => (
            <PartCard
              key={tile.id}
              part={tile}
              foundQty={tile._foundQty}
              onUpdate={handlePartUpdate}
              projectName={tile.projectName}
            />
          ))}
        </div>
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
