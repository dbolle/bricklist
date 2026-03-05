import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'

function ProgressBar({ found, total }) {
  const pct = total > 0 ? Math.round((found / total) * 100) : 0
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{found}/{total}</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function ProjectCard({ project, onDelete }) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete "${project.name}"?`)) return
    setDeleting(true)
    try {
      await api.deleteProject(project.id)
      onDelete(project.id)
    } catch (e2) {
      alert('Failed: ' + e2.message)
      setDeleting(false)
    }
  }

  return (
    <Link
      to={`/projects/${project.id}`}
      className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-3 shadow-sm hover:shadow-md transition-shadow active:scale-[0.98]"
    >
      <div className="w-14 h-14 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden">
        {project.set_img_url ? (
          <img src={project.set_img_url} alt={project.set_name} className="w-full h-full object-contain p-1" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl">🧱</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm truncate">{project.name}</p>
        <p className="text-xs text-gray-500 truncate">{project.set_name}</p>
        <div className="mt-1.5">
          <ProgressBar found={project.found_parts} total={project.total_parts} />
        </div>
      </div>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="flex-shrink-0 p-1.5 text-gray-300 hover:text-red-400 transition-colors"
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

function GroupCard({ group, projects }) {
  const navigate = useNavigate()
  const groupProjects = projects.filter((p) => p.group_id === group.id)
  const totalFound = groupProjects.reduce((a, p) => a + p.found_parts, 0)
  const totalNeeded = groupProjects.reduce((a, p) => a + p.total_parts, 0)

  return (
    <div
      className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => navigate(`/groups/${group.id}`)}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900">{group.name}</h3>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
          {groupProjects.length} projects
        </span>
      </div>

      <ProgressBar found={totalFound} total={totalNeeded} />

      {groupProjects.length > 0 && (
        <div className="mt-2 flex gap-1 flex-wrap">
          {groupProjects.slice(0, 3).map((p) => (
            <span key={p.id} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
              {p.name}
            </span>
          ))}
          {groupProjects.length > 3 && (
            <span className="text-xs text-gray-400">+{groupProjects.length - 3} more</span>
          )}
        </div>
      )}
    </div>
  )
}

export default function HomePage() {
  const [projects, setProjects] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [projData, groupData] = await Promise.all([
        api.getProjects(),
        api.getGroups(),
      ])
      setProjects(projData.projects || [])
      setGroups(groupData.groups || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDeleteProject = useCallback((id) => {
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const ungroupedProjects = projects.filter((p) => !p.group_id)
  const groupsWithProjects = groups.filter((g) =>
    projects.some((p) => p.group_id === g.id)
  )

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
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  const isEmpty = projects.length === 0

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">BrickList</h1>
          <p className="text-sm text-gray-500">{projects.length} projects</p>
        </div>
        <button
          onClick={() => navigate('/search')}
          className="bg-blue-600 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Project
        </button>
      </div>

      {isEmpty && (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🧱</div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">No projects yet</h2>
          <p className="text-sm text-gray-500 mb-6">Search for a Lego set to get started</p>
          <button
            onClick={() => navigate('/search')}
            className="bg-blue-600 text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-blue-700"
          >
            Find a Set
          </button>
        </div>
      )}

      {groupsWithProjects.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-gray-700 mb-3">Groups</h2>
          <div className="space-y-2">
            {groupsWithProjects.map((group) => (
              <GroupCard key={group.id} group={group} projects={projects} />
            ))}
          </div>
        </section>
      )}

      {ungroupedProjects.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-3">
            {groupsWithProjects.length > 0 ? 'Other Projects' : 'Projects'}
          </h2>
          <div className="space-y-2">
            {ungroupedProjects.map((project) => (
              <ProjectCard key={project.id} project={project} onDelete={handleDeleteProject} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
