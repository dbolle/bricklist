import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'

function AggregatePartCard({ part }) {
  const isComplete = part.total_found >= part.total_needed
  const isPartial = part.total_found > 0 && part.total_found < part.total_needed

  let bgClass = 'bg-white'
  if (isComplete) bgClass = 'bg-green-50'
  else if (isPartial) bgClass = 'bg-yellow-50'

  return (
    <div
      className={`relative rounded-xl shadow-sm border overflow-hidden ${bgClass} ${
        isComplete ? 'border-green-300' : isPartial ? 'border-yellow-300' : 'border-gray-200'
      }`}
      style={{ borderLeftWidth: '4px', borderLeftColor: `#${part.color_rgb}` }}
    >
      {isComplete && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}

      <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
        {part.part_img_url ? (
          <img
            src={part.part_img_url}
            alt={part.part_name}
            loading="lazy"
            className="w-full h-full object-contain p-1"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
              e.currentTarget.nextElementSibling.style.display = 'flex'
            }}
          />
        ) : null}
        <div className={`${part.part_img_url ? 'hidden' : 'flex'} w-full h-full items-center justify-center`}>
          <span className="text-xs text-gray-400 text-center px-1">{part.part_num}</span>
        </div>
      </div>

      <div className="p-2">
        <p className="text-xs font-medium text-gray-800 leading-tight line-clamp-2">{part.part_name}</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{part.color_name}</p>
        <div className="mt-1.5 flex items-center justify-between">
          <span className={`text-sm font-bold ${isComplete ? 'text-green-600' : isPartial ? 'text-yellow-600' : 'text-gray-400'}`}>
            {part.total_found}/{part.total_needed}
          </span>
        </div>
        <div className="mt-1 h-1 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${isComplete ? 'bg-green-500' : 'bg-yellow-400'}`}
            style={{ width: `${Math.min(100, (part.total_found / part.total_needed) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export default function GroupPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [group, setGroup] = useState(null)
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showSpares, setShowSpares] = useState(false)
  const [filter, setFilter] = useState('all')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [grp, partsData] = await Promise.all([
          api.getGroup(id),
          api.getGroupParts(id, true),
        ])
        if (cancelled) return
        setGroup(grp)
        setDraftName(grp.name)
        setParts(partsData.parts || [])
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  async function handleRename() {
    if (!draftName.trim() || draftName === group.name) {
      setEditingName(false)
      return
    }
    try {
      const updated = await api.updateGroup(id, { name: draftName.trim() })
      setGroup((g) => ({ ...g, name: updated.name }))
      setEditingName(false)
    } catch (e) {
      alert('Failed to rename: ' + e.message)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete group "${group.name}"? Projects will be ungrouped.`)) return
    try {
      await api.deleteGroup(id)
      navigate('/', { replace: true })
    } catch (e) {
      alert('Failed to delete: ' + e.message)
    }
  }

  const displayedParts = useMemo(() => {
    let filtered = parts.filter((p) => showSpares || !p.is_spare)
    if (filter === 'needed') filtered = filtered.filter((p) => p.total_found < p.total_needed)
    if (filter === 'found') filtered = filtered.filter((p) => p.total_found >= p.total_needed)
    return filtered
  }, [parts, showSpares, filter])

  const nonSpare = useMemo(() => parts.filter((p) => !p.is_spare), [parts])
  const totalFound = useMemo(() => nonSpare.reduce((a, p) => a + Math.min(p.total_found, p.total_needed), 0), [nonSpare])
  const totalNeeded = useMemo(() => nonSpare.reduce((a, p) => a + p.total_needed, 0), [nonSpare])
  const pct = totalNeeded > 0 ? Math.round((totalFound / totalNeeded) * 100) : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Loading group…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  if (!group) return null

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
                {group.name}
              </h1>
            )}
            <p className="text-sm text-gray-500">{group.projects?.length || 0} projects · {displayedParts.length} part types</p>
          </div>
          <button onClick={handleDelete} className="flex-shrink-0 p-2 text-gray-400 hover:text-red-500">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>

        {/* Projects chips */}
        {group.projects && group.projects.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-2">
            {group.projects.map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs border border-blue-200 hover:bg-blue-100"
              >
                {p.name}
              </Link>
            ))}
          </div>
        )}

        {/* Progress */}
        <div className="mb-2">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{totalFound.toLocaleString()} / {totalNeeded.toLocaleString()} parts found (combined)</span>
            <span className="font-semibold text-blue-600">{pct}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          {['all', 'needed', 'found'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
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
        <p className="text-xs text-gray-400 mt-1">Read-only view — tap a project link above to update progress</p>
      </div>

      {/* Parts grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
        {displayedParts.map((part, i) => (
          <AggregatePartCard key={`${part.part_num}-${part.color_id}-${i}`} part={part} />
        ))}
      </div>

      {displayedParts.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No parts to show</p>
        </div>
      )}
    </div>
  )
}
