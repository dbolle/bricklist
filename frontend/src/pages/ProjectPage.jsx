import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../api.js'
import PartCard from '../components/PartCard.jsx'
import Toast, { useToast } from '../components/Toast.jsx'

const FILTER_ALL = 'all'
const FILTER_NEEDED = 'needed'
const FILTER_FOUND = 'found'


function GroupHeader({ group, progress }) {
  const totalNeeded = group.parts.reduce((a, p) => a + p.quantity, 0)
  const totalFound = group.parts.reduce(
    (a, p) => a + Math.min(progress[String(p.id)] || 0, p.quantity), 0
  )
  const pct = totalNeeded > 0 ? Math.round((totalFound / totalNeeded) * 100) : 0
  const complete = pct === 100

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-y border-gray-200 mt-1 first:mt-0">
      {group.colorRgb && (
        <div
          className="w-4 h-4 rounded-full flex-shrink-0 border border-black/10"
          style={{ backgroundColor: `#${group.colorRgb}` }}
        />
      )}
      <span className="font-semibold text-sm text-gray-800 flex-1 truncate">{group.label}</span>
      <span className="text-xs text-gray-500 tabular-nums">{totalFound}/{totalNeeded}</span>
      <span className={`text-xs font-semibold tabular-nums w-8 text-right ${complete ? 'text-green-600' : 'text-blue-600'}`}>
        {pct}%
      </span>
    </div>
  )
}

function Chip({ label, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
        active
          ? color === 'purple'
            ? 'bg-purple-600 text-white'
            : 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  )
}

export default function ProjectPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [parts, setParts] = useState([])
  const [progress, setProgress] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showSpares, setShowSpares] = useState(false)
  const [showMinifigs, setShowMinifigs] = useState(true)
  const [filter, setFilter] = useState(FILTER_ALL)
  const [groupBy, setGroupBy] = useState('none')
  const [sortBy, setSortBy] = useState('status')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [removedParts, setRemovedParts] = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [proj, prog, removed] = await Promise.all([
          api.getProject(id),
          api.getProgress(id),
          api.getRemovedParts(id),
        ])
        if (cancelled) return
        setProject(proj)
        setDraftName(proj.name)

        const partsData = await api.getSetParts(proj.set_num, true)
        if (cancelled) return
        setParts(partsData.parts || [])
        setProgress(prog.progress || {})
        setRemovedParts(removed.notifications || [])
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const { toast, showToast, dismissToast } = useToast()

  const handlePartUpdateRef = useRef(null)
  const handlePartUpdate = useCallback(async (setPartId, newQty, { silent = false } = {}) => {
    const previous = progress[String(setPartId)] || 0
    if (previous === newQty) return
    setProgress((prev) => ({ ...prev, [String(setPartId)]: newQty }))
    if (!silent) {
      const part = parts.find((p) => p.id === setPartId)
      if (part) {
        showToast(`${part.part_name} — ${newQty}/${part.quantity}`, {
          undo: () => handlePartUpdateRef.current(setPartId, previous, { silent: true }),
        })
      }
    }
    try {
      await api.updatePart(id, setPartId, newQty)
    } catch (e) {
      setProgress((prev) => ({ ...prev, [String(setPartId)]: previous }))
      showToast('Failed to save, try again', { isError: true })
    }
  }, [id, progress, parts, showToast])
  handlePartUpdateRef.current = handlePartUpdate

  const handleRename = useCallback(async () => {
    if (!draftName.trim() || draftName === project.name) { setEditingName(false); return }
    try {
      const updated = await api.updateProject(id, { name: draftName.trim() })
      setProject(updated)
      setEditingName(false)
    } catch (e) {
      showToast('Failed to rename', { isError: true })
    }
  }, [id, draftName, project, showToast])

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return
    try {
      await api.deleteProject(id)
      navigate('/', { replace: true })
    } catch (e) {
      showToast('Failed to delete', { isError: true })
    }
  }, [id, project, navigate, showToast])

  const handleDismissRemovedPart = useCallback(async (notificationId) => {
    setRemovedParts((prev) => prev.filter((n) => n.id !== notificationId))
    try {
      await api.dismissRemovedPart(notificationId)
    } catch {
      // Non-critical: UI already updated, silently ignore
    }
  }, [])

  const handleDismissAllRemovedParts = useCallback(async () => {
    setRemovedParts([])
    try {
      await api.dismissAllRemovedParts(id)
    } catch {
      // Non-critical
    }
  }, [id])

  // Ordering uses a snapshot of progress taken when the data loads or a
  // control changes — completing a part must not reshuffle the grid under
  // the user's finger mid-sort.
  const progressRef = useRef(progress)
  progressRef.current = progress
  const [orderSnap, setOrderSnap] = useState({})
  useEffect(() => {
    setOrderSnap(progressRef.current)
  }, [parts, showSpares, showMinifigs, filter, groupBy, sortBy])

  // Build filtered + sorted + grouped structure
  const groupedParts = useMemo(() => {
    const snapFound = (p) => orderSnap[String(p.id)] || 0

    // 1. Filter
    let filtered = parts.filter((p) =>
      (showSpares || !p.is_spare) && (showMinifigs || !p.minifig_num)
    )
    if (filter === FILTER_NEEDED) {
      filtered = filtered.filter((p) => snapFound(p) < p.quantity)
    } else if (filter === FILTER_FOUND) {
      filtered = filtered.filter((p) => snapFound(p) >= p.quantity)
    }

    // 2. Sort
    filtered = [...filtered].sort((a, b) => {
      if (sortBy === 'name') return a.part_name.localeCompare(b.part_name)
      if (sortBy === 'quantity') return b.quantity - a.quantity
      // 'status': incomplete first, then alphabetical
      const aFound = snapFound(a) >= a.quantity
      const bFound = snapFound(b) >= b.quantity
      if (aFound !== bFound) return aFound ? 1 : -1
      return a.part_name.localeCompare(b.part_name)
    })

    // 3. Group (or return flat)
    if (groupBy === 'none') {
      return [{ key: 'all', label: null, colorRgb: null, parts: filtered }]
    }

    const groupMap = new Map()
    for (const part of filtered) {
      let key, label, colorRgb
      if (groupBy === 'color') {
        key = String(part.color_id)
        label = part.color_name
        colorRgb = part.color_rgb
      } else {
        key = part.part_cat_name || 'Other'
        label = key
        colorRgb = null
      }
      if (!groupMap.has(key)) groupMap.set(key, { key, label, colorRgb, parts: [] })
      groupMap.get(key).parts.push(part)
    }

    // Sort groups alphabetically by label
    return Array.from(groupMap.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [parts, orderSnap, showSpares, showMinifigs, filter, groupBy, sortBy])

  const totalShown = useMemo(
    () => groupedParts.reduce((acc, g) => acc + g.parts.length, 0),
    [groupedParts]
  )

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
      {/* Sticky header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 z-20 px-4 pt-4 pb-3 space-y-2">

        {/* Title row */}
        <div className="flex items-start justify-between">
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
            {project.group_name && <p className="text-xs text-blue-600">{project.group_name}</p>}
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

        {/* Overall progress */}
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{foundCount.toLocaleString()} / {totalCount.toLocaleString()} parts found</span>
            <span className="font-semibold text-blue-600">{pct}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex gap-1.5 flex-wrap">
          {[
            { key: FILTER_ALL, label: 'All' },
            { key: FILTER_NEEDED, label: 'Needed' },
            { key: FILTER_FOUND, label: 'Found' },
          ].map(({ key, label }) => (
            <Chip key={key} label={label} active={filter === key} onClick={() => setFilter(key)} />
          ))}
          <Chip
            label={showSpares ? 'Hide Spares' : 'Show Spares'}
            active={showSpares}
            onClick={() => setShowSpares((v) => !v)}
            color="purple"
          />
          <Chip
            label={showMinifigs ? 'Hide Minifigs' : 'Show Minifigs'}
            active={showMinifigs}
            onClick={() => setShowMinifigs((v) => !v)}
            color="purple"
          />
        </div>

        {/* Group by */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 w-12 flex-shrink-0">Group</span>
          <div className="flex gap-1.5 flex-wrap">
            {[
              { key: 'none', label: 'None' },
              { key: 'color', label: 'Color' },
              { key: 'type', label: 'Type' },
            ].map(({ key, label }) => (
              <Chip key={key} label={label} active={groupBy === key} onClick={() => setGroupBy(key)} />
            ))}
          </div>
        </div>

        {/* Sort by */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 w-12 flex-shrink-0">Sort</span>
          <div className="flex gap-1.5 flex-wrap">
            {[
              { key: 'status', label: 'Status' },
              { key: 'name', label: 'A – Z' },
              { key: 'quantity', label: 'Qty' },
            ].map(({ key, label }) => (
              <Chip key={key} label={label} active={sortBy === key} onClick={() => setSortBy(key)} />
            ))}
          </div>
        </div>

        <p className="text-xs text-gray-400">
          {totalShown} parts shown
          {groupBy !== 'none' && ` in ${groupedParts.length} ${groupBy === 'color' ? 'colors' : 'types'}`}
        </p>
      </div>

      {/* Removed-parts notification */}
      {removedParts.length > 0 && (
        <div className="mx-3 mt-3 rounded-xl border border-amber-300 bg-amber-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-amber-100 border-b border-amber-300">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-700 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="text-xs font-semibold text-amber-800">
                {removedParts.length} part{removedParts.length !== 1 ? 's' : ''} removed from this set's inventory
              </span>
            </div>
            <button
              onClick={handleDismissAllRemovedParts}
              className="text-xs text-amber-700 hover:text-amber-900 font-medium underline"
            >
              Dismiss all
            </button>
          </div>
          <p className="px-3 pt-2 pb-1 text-xs text-amber-700">
            You had found these — remove them from your bag.
          </p>
          <div className="divide-y divide-amber-200">
            {removedParts.map((n) => (
              <div key={n.id} className="flex items-center gap-2 px-3 py-2">
                <div
                  className="w-1 self-stretch rounded-full flex-shrink-0"
                  style={{ backgroundColor: `#${n.color_rgb}` }}
                />
                <div className="w-10 h-10 flex-shrink-0 bg-white rounded-lg border border-amber-200 flex items-center justify-center overflow-hidden">
                  {n.part_img_url ? (
                    <img src={n.part_img_url} alt={n.part_name} className="w-full h-full object-contain p-0.5" />
                  ) : (
                    <span className="text-xs text-gray-400 text-center px-0.5">{n.part_num}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 leading-tight line-clamp-2">{n.part_name}</p>
                  <p className="text-xs text-gray-500 truncate">{n.color_name}</p>
                </div>
                <span className="flex-shrink-0 text-xs font-semibold text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5">
                  had {n.found_qty}
                </span>
                <button
                  onClick={() => handleDismissRemovedPart(n.id)}
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-amber-600 hover:bg-amber-200 transition-colors"
                  title="Dismiss"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Parts — flat or grouped */}
      {totalShown === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No parts to show</p>
        </div>
      ) : (
        groupedParts.map((group) => (
          <div key={group.key}>
            {group.label && <GroupHeader group={group} progress={progress} />}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
              {group.parts.map((part) => (
                <PartCard
                  key={part.id}
                  part={part}
                  foundQty={progress[String(part.id)] || 0}
                  onUpdate={handlePartUpdate}
                />
              ))}
            </div>
          </div>
        ))
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
