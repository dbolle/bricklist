import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import PartCard from '../components/PartCard.jsx'
import Toast, { useToast } from '../components/Toast.jsx'

function GroupSectionHeader({ group, progress }) {
  const totalNeeded = group.parts.reduce((a, p) => a + p.quantity, 0)
  const totalFound = group.parts.reduce(
    (a, p) => a + Math.min(progress[p.id] ?? 0, p.quantity), 0
  )
  const pct = totalNeeded > 0 ? Math.round((totalFound / totalNeeded) * 100) : 0

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
      <span className={`text-xs font-semibold tabular-nums w-8 text-right ${pct === 100 ? 'text-green-600' : 'text-blue-600'}`}>
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
          ? color === 'purple' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  )
}

export default function GroupPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [group, setGroup] = useState(null)
  // projectsData: [{ project, parts: SetPart[], progress: {[setPartId]: foundQty} }]
  const [projectsData, setProjectsData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showSpares, setShowSpares] = useState(false)
  const [showMinifigs, setShowMinifigs] = useState(true)
  const [filter, setFilter] = useState('all')
  const [groupBy, setGroupBy] = useState('none')
  const [sortBy, setSortBy] = useState('status')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const grp = await api.getGroup(id)
        if (cancelled) return
        setGroup(grp)
        setDraftName(grp.name)

        const loaded = await Promise.all(
          (grp.projects || []).map(async (proj) => {
            const [partsData, progressData] = await Promise.all([
              api.getSetParts(proj.set_num, true),
              api.getProgress(proj.id),
            ])
            return {
              project: proj,
              parts: partsData.parts || [],
              progress: progressData.progress || {},
            }
          })
        )
        if (cancelled) return
        setProjectsData(loaded)
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

  // Flatten to one tile per (project, part). Each tile gets a unique `id` = `${projectId}|${setPartId}`.
  const flatTiles = useMemo(() => {
    const tiles = []
    for (const { project, parts, progress } of projectsData) {
      for (const part of parts) {
        tiles.push({
          ...part,
          id: `${project.id}|${part.id}`,  // unique tile key
          _projectId: project.id,
          _setPartId: part.id,
          projectName: project.name,
          _foundQty: progress[String(part.id)] || 0,
        })
      }
    }
    return tiles
  }, [projectsData])

  // foundMap keyed by tileId for GroupSectionHeader and PartCard
  const foundMap = useMemo(() => {
    const m = {}
    for (const tile of flatTiles) {
      m[tile.id] = tile._foundQty
    }
    return m
  }, [flatTiles])

  const handlePartUpdateRef = useRef(null)
  const handlePartUpdate = useCallback(async (tileId, newQty, { silent = false } = {}) => {
    const tile = flatTiles.find((t) => t.id === tileId)
    if (!tile) return
    const { _projectId, _setPartId, _foundQty } = tile
    if (_foundQty === newQty) return

    setProjectsData((prev) =>
      prev.map(({ project, parts, progress }) => {
        if (project.id !== _projectId) return { project, parts, progress }
        return { project, parts, progress: { ...progress, [String(_setPartId)]: newQty } }
      })
    )
    if (!silent) {
      showToast(`${tile.part_name} — ${newQty}/${tile.quantity}`, {
        undo: () => handlePartUpdateRef.current(tileId, _foundQty, { silent: true }),
      })
    }

    try {
      await api.updatePart(_projectId, _setPartId, newQty)
    } catch {
      setProjectsData((prev) =>
        prev.map(({ project, parts, progress }) => {
          if (project.id !== _projectId) return { project, parts, progress }
          return { project, parts, progress: { ...progress, [String(_setPartId)]: _foundQty } }
        })
      )
      showToast('Failed to save, try again', { isError: true })
    }
  }, [flatTiles, showToast])
  handlePartUpdateRef.current = handlePartUpdate

  // Ordering uses a snapshot of found counts taken when loading finishes or a
  // control changes, so completing a part doesn't reshuffle the grid mid-sort.
  const foundMapRef = useRef(foundMap)
  foundMapRef.current = foundMap
  const [orderSnap, setOrderSnap] = useState({})
  useEffect(() => {
    if (!loading) setOrderSnap(foundMapRef.current)
  }, [loading, showSpares, showMinifigs, filter, groupBy, sortBy])

  const groupedParts = useMemo(() => {
    let filtered = flatTiles.filter((t) =>
      (showSpares || !t.is_spare) && (showMinifigs || !t.minifig_num)
    )
    const getFound = (t) => orderSnap[t.id] || 0
    if (filter === 'needed') filtered = filtered.filter((t) => getFound(t) < t.quantity)
    if (filter === 'found')  filtered = filtered.filter((t) => getFound(t) >= t.quantity)

    filtered = [...filtered].sort((a, b) => {
      if (sortBy === 'name')     return a.part_name.localeCompare(b.part_name)
      if (sortBy === 'quantity') return b.quantity - a.quantity
      const aF = getFound(a) >= a.quantity
      const bF = getFound(b) >= b.quantity
      if (aF !== bF) return aF ? 1 : -1
      return a.part_name.localeCompare(b.part_name)
    })

    if (groupBy === 'none') return [{ key: 'all', label: null, colorRgb: null, parts: filtered }]

    const groupMap = new Map()
    for (const tile of filtered) {
      const key = groupBy === 'color' ? String(tile.color_id) : (tile.part_cat_name || 'Other')
      const label = groupBy === 'color' ? tile.color_name : key
      const colorRgb = groupBy === 'color' ? tile.color_rgb : null
      if (!groupMap.has(key)) groupMap.set(key, { key, label, colorRgb, parts: [] })
      groupMap.get(key).parts.push(tile)
    }
    return Array.from(groupMap.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [flatTiles, orderSnap, showSpares, showMinifigs, filter, groupBy, sortBy])

  const totalShown = useMemo(
    () => groupedParts.reduce((a, g) => a + g.parts.length, 0), [groupedParts]
  )

  const nonSpare = useMemo(() => flatTiles.filter((t) => !t.is_spare), [flatTiles])
  const overallFound  = useMemo(() => nonSpare.reduce((a, t) => a + Math.min(foundMap[t.id] || 0, t.quantity), 0), [nonSpare, foundMap])
  const overallNeeded = useMemo(() => nonSpare.reduce((a, t) => a + t.quantity, 0), [nonSpare])
  const pct = overallNeeded > 0 ? Math.round((overallFound / overallNeeded) * 100) : 0

  async function handleRename() {
    if (!draftName.trim() || draftName === group.name) { setEditingName(false); return }
    try {
      const updated = await api.updateGroup(id, { name: draftName.trim() })
      setGroup((g) => ({ ...g, name: updated.name }))
      setEditingName(false)
    } catch (e) {
      showToast('Failed to rename: ' + e.message, { isError: true })
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete group "${group.name}"? Projects will be ungrouped.`)) return
    try {
      await api.deleteGroup(id)
      navigate('/', { replace: true })
    } catch (e) {
      showToast('Failed to delete: ' + e.message, { isError: true })
    }
  }

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
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      </div>
    )
  }

  if (!group) return null

  return (
    <div className="pb-4">
      <div className="sticky top-0 bg-white border-b border-gray-200 z-20 px-4 pt-4 pb-3 space-y-2">

        {/* Title */}
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
                {group.name}
              </h1>
            )}
            <p className="text-sm text-gray-500">{group.projects?.length || 0} projects</p>
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

        {/* Project chips */}
        {group.projects?.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
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

        {/* Overall progress */}
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{overallFound.toLocaleString()} / {overallNeeded.toLocaleString()} parts found (combined)</span>
            <span className="font-semibold text-blue-600">{pct}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex gap-1.5 flex-wrap">
          {[['all','All'],['needed','Needed'],['found','Found']].map(([key, label]) => (
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
            {[['none','None'],['color','Color'],['type','Type']].map(([key, label]) => (
              <Chip key={key} label={label} active={groupBy === key} onClick={() => setGroupBy(key)} />
            ))}
          </div>
        </div>

        {/* Sort by */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 w-12 flex-shrink-0">Sort</span>
          <div className="flex gap-1.5 flex-wrap">
            {[['status','Status'],['name','A – Z'],['quantity','Qty']].map(([key, label]) => (
              <Chip key={key} label={label} active={sortBy === key} onClick={() => setSortBy(key)} />
            ))}
          </div>
        </div>

        <p className="text-xs text-gray-400">
          {totalShown} tiles shown
          {groupBy !== 'none' && ` in ${groupedParts.length} ${groupBy === 'color' ? 'colors' : 'types'}`}
        </p>
      </div>

      {/* Parts */}
      {totalShown === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No parts to show</p>
        </div>
      ) : (
        groupedParts.map((group) => (
          <div key={group.key}>
            {group.label && (
              <GroupSectionHeader group={group} progress={foundMap} />
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
              {group.parts.map((tile) => (
                <PartCard
                  key={tile.id}
                  part={tile}
                  foundQty={foundMap[tile.id] || 0}
                  onUpdate={handlePartUpdate}
                  projectName={tile.projectName}
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
