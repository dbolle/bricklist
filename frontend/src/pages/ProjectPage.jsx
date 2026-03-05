import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../api.js'
import PartCard from '../components/PartCard.jsx'

const FILTER_ALL = 'all'
const FILTER_NEEDED = 'needed'
const FILTER_FOUND = 'found'

export default function ProjectPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [parts, setParts] = useState([])
  const [progress, setProgress] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showSpares, setShowSpares] = useState(false)
  const [filter, setFilter] = useState(FILTER_ALL)
  const [toast, setToast] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [proj, prog] = await Promise.all([
          api.getProject(id),
          api.getProgress(id),
        ])
        if (cancelled) return
        setProject(proj)
        setDraftName(proj.name)

        const partsData = await api.getSetParts(proj.set_num, true)
        if (cancelled) return
        setParts(partsData.parts || [])
        setProgress(prog.progress || {})
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 2500)
  }, [])

  const handlePartUpdate = useCallback(async (setPartId, newQty) => {
    const previous = progress[String(setPartId)] || 0
    setProgress((prev) => ({ ...prev, [String(setPartId)]: newQty }))
    try {
      await api.updatePart(id, setPartId, newQty)
    } catch (e) {
      setProgress((prev) => ({ ...prev, [String(setPartId)]: previous }))
      showToast('Failed to save, try again', true)
    }
  }, [id, progress, showToast])

  const handleRename = useCallback(async () => {
    if (!draftName.trim() || draftName === project.name) {
      setEditingName(false)
      return
    }
    try {
      const updated = await api.updateProject(id, { name: draftName.trim() })
      setProject(updated)
      setEditingName(false)
    } catch (e) {
      showToast('Failed to rename', true)
    }
  }, [id, draftName, project, showToast])

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return
    try {
      await api.deleteProject(id)
      navigate('/', { replace: true })
    } catch (e) {
      showToast('Failed to delete', true)
    }
  }, [id, project, navigate, showToast])

  const displayedParts = useMemo(() => {
    let filtered = parts.filter((p) => showSpares || !p.is_spare)
    if (filter === FILTER_NEEDED) {
      filtered = filtered.filter((p) => (progress[String(p.id)] || 0) < p.quantity)
    } else if (filter === FILTER_FOUND) {
      filtered = filtered.filter((p) => (progress[String(p.id)] || 0) >= p.quantity)
    }
    return filtered.sort((a, b) => {
      const aFound = (progress[String(a.id)] || 0) >= a.quantity
      const bFound = (progress[String(b.id)] || 0) >= b.quantity
      if (aFound !== bFound) return aFound ? 1 : -1
      return a.part_name.localeCompare(b.part_name)
    })
  }, [parts, progress, showSpares, filter])

  const nonSpare = useMemo(() => parts.filter((p) => !p.is_spare), [parts])
  const foundCount = useMemo(
    () => nonSpare.reduce((acc, p) => acc + Math.min(progress[String(p.id)] || 0, p.quantity), 0),
    [nonSpare, progress]
  )
  const totalCount = useMemo(() => nonSpare.reduce((acc, p) => acc + p.quantity, 0), [nonSpare])
  const pct = totalCount > 0 ? Math.round((foundCount / totalCount) * 100) : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Loading parts…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <p className="font-semibold mb-1">Failed to load project</p>
          <p>{error}</p>
          {error.includes('API key') && (
            <Link to="/settings" className="mt-2 block text-blue-600 underline">Go to Settings</Link>
          )}
        </div>
      </div>
    )
  }

  if (!project) return null

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 z-20 px-4 pt-4 pb-3">
        <div className="flex items-start justify-between mb-1">
          <div className="flex-1 min-w-0 mr-2">
            {editingName ? (
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRename() }}
                className="w-full text-xl font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none bg-transparent"
                autoFocus
              />
            ) : (
              <h1
                className="text-xl font-bold text-gray-900 truncate cursor-pointer hover:text-blue-600"
                onClick={() => setEditingName(true)}
                title="Tap to rename"
              >
                {project.name}
              </h1>
            )}
            <p className="text-sm text-gray-500 truncate">{project.set_name} · {project.set_num}</p>
            {project.group_name && (
              <p className="text-xs text-blue-600">{project.group_name}</p>
            )}
          </div>
          <button
            onClick={handleDelete}
            className="flex-shrink-0 p-2 text-gray-400 hover:text-red-500 transition-colors"
            title="Delete project"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="mb-2">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{foundCount.toLocaleString()} / {totalCount.toLocaleString()} parts found</span>
            <span className="font-semibold text-blue-600">{pct}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          {[
            { key: FILTER_ALL, label: 'All' },
            { key: FILTER_NEEDED, label: 'Needed' },
            { key: FILTER_FOUND, label: 'Found' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => setShowSpares((v) => !v)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              showSpares ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {showSpares ? 'Hide Spares' : 'Show Spares'}
          </button>
        </div>

        <p className="text-xs text-gray-400 mt-1">{displayedParts.length} parts shown · Tap to mark found · Hold to decrement</p>
      </div>

      {/* Parts grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
        {displayedParts.map((part) => (
          <PartCard
            key={part.id}
            part={part}
            foundQty={progress[String(part.id)] || 0}
            onUpdate={handlePartUpdate}
          />
        ))}
      </div>

      {displayedParts.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No parts to show</p>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 rounded-xl px-4 py-2 text-sm text-white shadow-lg z-50 ${
            toast.isError ? 'bg-red-600' : 'bg-gray-800'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
