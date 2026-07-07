import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'

function SetResult({ set, onAdd }) {
  return (
    <div className="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 shadow-sm">
      <div className="w-16 h-16 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden">
        {set.img_url ? (
          <img src={set.img_url} alt={set.name} className="w-full h-full object-contain p-1" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-gray-600 text-2xl">🧱</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">{set.name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{set.set_num} · {set.year}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{set.num_parts?.toLocaleString()} parts</p>
      </div>
      <button
        onClick={() => onAdd(set)}
        className="flex-shrink-0 bg-blue-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-blue-700 transition-colors"
      >
        Add
      </button>
    </div>
  )
}

function AddProjectModal({ set, groups, onConfirm, onCancel }) {
  const [name, setName] = useState(set.name)
  const [groupId, setGroupId] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setCreating(true)
    try {
      await onConfirm({
        set_num: set.set_num,
        name: name.trim() || set.name,
        group_id: groupId ? parseInt(groupId) : null,
        newGroupName: newGroupName.trim(),
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl">
        <div className="p-5">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">Add Project</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{set.name} ({set.set_num})</p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Project name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={set.name}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Add to group (optional)</label>
              <select
                value={groupId}
                onChange={(e) => {
                  setGroupId(e.target.value)
                  if (e.target.value !== 'new') setNewGroupName('')
                }}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
                <option value="new">+ Create new group…</option>
              </select>
            </div>

            {groupId === 'new' && (
              <div>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="New group name"
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Adding…' : 'Add Project'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedSet, setSelectedSet] = useState(null)
  const [groups, setGroups] = useState([])
  const debounceRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.getGroups().then((d) => setGroups(d.groups)).catch(() => {})
  }, [])

  const doSearch = useCallback(async (q) => {
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await api.searchSets(q)
      setResults(data.results || [])
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

  async function handleConfirmAdd({ set_num, name, group_id, newGroupName }) {
    try {
      let finalGroupId = group_id
      if (newGroupName) {
        const newGroup = await api.createGroup({ name: newGroupName })
        finalGroupId = newGroup.id
      }
      const project = await api.createProject({ set_num, name, group_id: finalGroupId })
      navigate(`/projects/${project.id}`)
    } catch (e) {
      alert('Failed to add project: ' + e.message)
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Find a Set</h1>

      <div className="relative mb-4">
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
          placeholder="Search by set number or name…"
          autoFocus
          className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 dark:text-gray-100 shadow-sm"
        />
      </div>

      {loading && (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Searching…</div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl p-3 text-sm text-red-700 dark:text-red-300 mb-4">
          {error}
        </div>
      )}

      {!loading && results.length === 0 && query.length >= 2 && !error && (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">No sets found for "{query}"</div>
      )}

      {!loading && query.length < 2 && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm">Enter a set number or name to search</p>
        </div>
      )}

      <div className="space-y-2">
        {results.map((set) => (
          <SetResult key={set.set_num} set={set} onAdd={setSelectedSet} />
        ))}
      </div>

      {selectedSet && (
        <AddProjectModal
          set={selectedSet}
          groups={groups}
          onConfirm={handleConfirmAdd}
          onCancel={() => setSelectedSet(null)}
        />
      )}
    </div>
  )
}
