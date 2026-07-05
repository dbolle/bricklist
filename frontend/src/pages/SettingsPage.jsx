import { useState, useEffect } from 'react'
import { api } from '../api.js'

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saved, setSaved] = useState(false)

  // Cache management
  const [cachedSets, setCachedSets] = useState([]) // [{set_num, name}]
  const [refreshing, setRefreshing] = useState({}) // { [set_num]: 'loading'|'ok'|'error' }
  const [refreshingAll, setRefreshingAll] = useState(false)

  useEffect(() => {
    api.getSettings().then((s) => setApiKey(s.rebrickable_api_key || ''))
    api.getProjects().then((data) => {
      const seen = new Set()
      const sets = []
      for (const p of data.projects || []) {
        if (!seen.has(p.set_num)) {
          seen.add(p.set_num)
          sets.push({ set_num: p.set_num, name: p.set_name })
        }
      }
      setCachedSets(sets)
    }).catch(() => {})
  }, [])

  async function handleRefreshSet(setNum) {
    setRefreshing((r) => ({ ...r, [setNum]: 'loading' }))
    try {
      await api.refreshSet(setNum)
      setRefreshing((r) => ({ ...r, [setNum]: 'ok' }))
      setTimeout(() => setRefreshing((r) => ({ ...r, [setNum]: null })), 3000)
    } catch (e) {
      setRefreshing((r) => ({ ...r, [setNum]: 'error' }))
      setTimeout(() => setRefreshing((r) => ({ ...r, [setNum]: null })), 4000)
    }
  }

  async function handleRefreshAll() {
    setRefreshingAll(true)
    setRefreshing({})
    for (const { set_num } of cachedSets) {
      await handleRefreshSet(set_num)
    }
    setRefreshingAll(false)
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await api.saveSettings({ rebrickable_api_key: apiKey })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const results = await api.searchSets('8880')
      if (results.results && results.results.length > 0) {
        setTestResult({ ok: true, msg: `Connected! Found ${results.results.length} results.` })
      } else {
        setTestResult({ ok: true, msg: 'Connected! API key is valid.' })
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-800 mb-1">Rebrickable API Key</h2>
          <p className="text-sm text-gray-500 mb-3">
            Get a free API key at{' '}
            <a
              href="https://rebrickable.com/api/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              rebrickable.com/api
            </a>
            {' '}(requires a free account).
          </p>

          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key here"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showKey ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !apiKey}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Key'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !apiKey}
            className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>

        {testResult && (
          <div
            className={`rounded-lg p-3 text-sm ${
              testResult.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
          </div>
        )}
      </div>

      {cachedSets.length > 0 && (
        <div className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Cache Management</h2>
              <p className="text-xs text-gray-500 mt-0.5">Re-fetch part data from Rebrickable (also updates categories)</p>
            </div>
            <button
              onClick={handleRefreshAll}
              disabled={refreshingAll || !apiKey}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {refreshingAll ? 'Refreshing…' : 'Refresh All'}
            </button>
          </div>

          <div className="divide-y divide-gray-100">
            {cachedSets.map(({ set_num, name }) => {
              const state = refreshing[set_num]
              return (
                <div key={set_num} className="flex items-center gap-2 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
                    <p className="text-xs text-gray-400">{set_num}</p>
                  </div>
                  {state === 'ok' && <span className="text-xs text-green-600 font-medium">Updated</span>}
                  {state === 'error' && <span className="text-xs text-red-600 font-medium">Failed</span>}
                  <button
                    onClick={() => handleRefreshSet(set_num)}
                    disabled={state === 'loading' || refreshingAll || !apiKey}
                    className="flex-shrink-0 px-2.5 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {state === 'loading' ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Backup</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Download a snapshot of the database — all projects, groups, and progress.
              To restore, replace <code className="bg-gray-100 px-1 rounded">bricklist.db</code> in the data volume with the downloaded file.
            </p>
          </div>
          <a
            href="/api/backup"
            download
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
          >
            Download Backup
          </a>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
        <h2 className="text-base font-semibold text-gray-800 mb-2">About BrickList</h2>
        <p className="text-sm text-gray-500">
          BrickList helps you sort Lego bricks into sets by tracking which parts you've found.
          Part data and images are provided by{' '}
          <a href="https://rebrickable.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
            Rebrickable
          </a>.
        </p>
      </div>
    </div>
  )
}
