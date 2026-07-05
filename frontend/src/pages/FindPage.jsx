import { useState, useRef, useCallback } from 'react'
import { api } from '../api.js'
import PartCard from '../components/PartCard.jsx'

export default function FindPage() {
  const [query, setQuery] = useState('')
  const [tiles, setTiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searched, setSearched] = useState(false)
  const [toast, setToast] = useState(null)
  const debounceRef = useRef(null)

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 2500)
  }, [])

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
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(q), 350)
  }

  const handlePartUpdate = useCallback(async (tileId, newQty) => {
    const tile = tiles.find((t) => t.id === tileId)
    if (!tile) return
    const prevQty = tile._foundQty
    setTiles((prev) => prev.map((t) => (t.id === tileId ? { ...t, _foundQty: newQty } : t)))
    try {
      await api.updatePart(tile._projectId, tile._setPartId, newQty)
    } catch {
      setTiles((prev) => prev.map((t) => (t.id === tileId ? { ...t, _foundQty: prevQty } : t)))
      showToast('Failed to save, try again', true)
    }
  }, [tiles, showToast])

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Find a Part</h1>
      <p className="text-sm text-gray-500 mb-4">
        Holding a piece? Search by the number molded on it, or by name, to see which projects need it.
      </p>

      <div className="relative mb-4">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
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
          className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm"
        />
      </div>

      {loading && <div className="text-center py-8 text-gray-400 text-sm">Searching…</div>}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {!loading && searched && tiles.length === 0 && !error && (
        <div className="text-center py-8 text-gray-400 text-sm">
          No project needs a part matching "{query}"
        </div>
      )}

      {!loading && !searched && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">🔎</div>
          <p className="text-sm">e.g. "3001" or "brick 2 x 4"</p>
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

      {toast && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm text-white shadow-lg z-50 ${
            toast.isError ? 'bg-red-600' : 'bg-gray-800'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
