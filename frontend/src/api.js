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
  searchParts: (q, includeSpares = false) =>
    request('GET', `/search/parts?q=${encodeURIComponent(q)}&include_spares=${includeSpares}`),
  identifyPart: async (file, limit = 5) => {
    const form = new FormData()
    form.append('image', file, file.name || 'photo.jpg')
    const res = await fetch(`${BASE}/identify?limit=${limit}`, { method: 'POST', body: form })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || `HTTP ${res.status}`)
    }
    return res.json()
  },
  getRemovedParts: (projectId) => request('GET', `/projects/${projectId}/removed-parts`),
  dismissRemovedPart: (notificationId) => request('DELETE', `/removed-parts/${notificationId}`),
  dismissAllRemovedParts: (projectId) => request('DELETE', `/projects/${projectId}/removed-parts`),

  // Bins
  getBins: () => request('GET', '/bins'),
  createBin: (data) => request('POST', '/bins', data),
  getBin: (id) => request('GET', `/bins/${id}`),
  updateBin: (id, data) => request('PUT', `/bins/${id}`, data),
  deleteBin: (id) => request('DELETE', `/bins/${id}`),
  addBinPart: (binId, data) => request('POST', `/bins/${binId}/parts`, data),
  updateBinPart: (binId, partId, quantity) =>
    request('PATCH', `/bins/${binId}/parts/${partId}`, { quantity }),
  matchBin: (binId) => request('POST', `/bins/${binId}/match`),

  // Groups
  getGroups: () => request('GET', '/groups'),
  createGroup: (data) => request('POST', '/groups', data),
  getGroup: (id) => request('GET', `/groups/${id}`),
  updateGroup: (id, data) => request('PUT', `/groups/${id}`, data),
  deleteGroup: (id) => request('DELETE', `/groups/${id}`),
  getGroupParts: (id, includeSpares = false) =>
    request('GET', `/groups/${id}/parts?include_spares=${includeSpares}`),
}
