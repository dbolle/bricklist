const BASE = '/api'

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // Settings
  getSettings: () => request('GET', '/settings'),
  saveSettings: (data) => request('PUT', '/settings', data),

  // Search
  searchSets: (q) => request('GET', `/rebrickable/search?q=${encodeURIComponent(q)}`),

  // Sets
  getSetParts: (setNum, includeSpares = false) =>
    request('GET', `/sets/${setNum}/parts?include_spares=${includeSpares}`),
  refreshSet: (setNum) => request('POST', `/sets/${setNum}/refresh`),

  // Projects
  getProjects: () => request('GET', '/projects'),
  createProject: (data) => request('POST', '/projects', data),
  getProject: (id) => request('GET', `/projects/${id}`),
  updateProject: (id, data) => request('PUT', `/projects/${id}`, data),
  deleteProject: (id) => request('DELETE', `/projects/${id}`),
  getProgress: (id) => request('GET', `/projects/${id}/progress`),
  updatePart: (projectId, setPartId, foundQty) =>
    request('PATCH', `/projects/${projectId}/parts/${setPartId}`, { found_qty: foundQty }),
  getRemovedParts: (projectId) => request('GET', `/projects/${projectId}/removed-parts`),
  dismissRemovedPart: (notificationId) => request('DELETE', `/removed-parts/${notificationId}`),
  dismissAllRemovedParts: (projectId) => request('DELETE', `/projects/${projectId}/removed-parts`),

  // Groups
  getGroups: () => request('GET', '/groups'),
  createGroup: (data) => request('POST', '/groups', data),
  getGroup: (id) => request('GET', `/groups/${id}`),
  updateGroup: (id, data) => request('PUT', `/groups/${id}`, data),
  deleteGroup: (id) => request('DELETE', `/groups/${id}`),
  getGroupParts: (id, includeSpares = false) =>
    request('GET', `/groups/${id}/parts?include_spares=${includeSpares}`),
}
