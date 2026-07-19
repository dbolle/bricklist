import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'

function BinCard({ bin, onDelete }) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete bin "${bin.name}"? Its part inventory will be lost.`)) return
    setDeleting(true)
    try {
      await api.deleteBin(bin.id)
      onDelete(bin.id)
    } catch (e2) {
      alert('Failed: ' + e2.message)
      setDeleting(false)
    }
  }

  return (
    <Link
      to={`/bins/${bin.id}`}
      className="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 shadow-sm hover:shadow-md transition-shadow active:scale-[0.98]"
    >
      <div className="w-12 h-12 flex-shrink-0 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-2xl">
        📦
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">{bin.name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {bin.part_count} unique part{bin.part_count !== 1 ? 's' : ''} · {bin.piece_count} piece{bin.piece_count !== 1 ? 's' : ''}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          {new Date(bin.created_at).toLocaleDateString()}
        </p>
      </div>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="flex-shrink-0 p-1.5 text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </button>
    </Link>
  )
}

export default function BinsPage() {
  const [bins, setBins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getBins()
      setBins(data.bins || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function startCreate() {
    setNewName(`Bin ${new Date().toLocaleDateString()}`)
    setCreating(true)
  }

  async function handleCreate(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    try {
      const bin = await api.createBin({ name })
      navigate(`/bins/${bin.id}`)
    } catch (e2) {
      alert('Failed to create bin: ' + e2.message)
    }
  }

  const handleDeleteBin = useCallback((id) => {
    setBins((prev) => prev.filter((b) => b.id !== id))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Bins</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{bins.length} bin{bins.length !== 1 ? 's' : ''}</p>
        </div>
        {!creating && (
          <button
            onClick={startCreate}
            className="bg-blue-600 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Bin
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Photograph pieces from an unsorted pile to build an inventory, then find which sets are hiding in it.
      </p>

      {creating && (
        <form onSubmit={handleCreate} className="flex gap-2 mb-6">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            placeholder="Bin name"
            className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 dark:text-gray-100"
          />
          <button
            type="submit"
            className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
        </form>
      )}

      {bins.length === 0 && !creating ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">📦</div>
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">No bins yet</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Got a mystery pile? Create a bin and start photographing pieces.
          </p>
          <button
            onClick={startCreate}
            className="bg-blue-600 text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-blue-700"
          >
            New Bin
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {bins.map((bin) => (
            <BinCard key={bin.id} bin={bin} onDelete={handleDeleteBin} />
          ))}
        </div>
      )}
    </div>
  )
}
