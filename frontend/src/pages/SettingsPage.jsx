import { useState, useEffect } from 'react'
import { api, storePin, clearPin } from '../api.js'

function DiagRow({ ok, warn = false, label, detail }) {
  const dot = ok ? 'bg-green-500' : warn ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-start gap-2 py-2">
      <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${dot}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 break-words">{detail}</p>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  // apiKey is only ever the *draft* being typed — the server never returns the full key
  const [apiKey, setApiKey] = useState('')
  const [keySet, setKeySet] = useState(false)
  const [keyMasked, setKeyMasked] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saved, setSaved] = useState(false)

  // Diagnostics
  const [diag, setDiag] = useState(null)
  const [diagLoading, setDiagLoading] = useState(false)

  async function loadDiagnostics() {
    setDiagLoading(true)
    try {
      setDiag(await api.getDiagnostics())
    } catch {
      setDiag(null)
    } finally {
      setDiagLoading(false)
    }
  }

  // Security (PIN)
  const [pinSet, setPinSet] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const [pinMsg, setPinMsg] = useState(null) // {ok, text}

  // Cache management
  const [cachedSets, setCachedSets] = useState([]) // [{set_num, name}]
  const [refreshing, setRefreshing] = useState({}) // { [set_num]: 'loading'|'ok'|'error' }
  const [refreshingAll, setRefreshingAll] = useState(false)

  function applySettings(s) {
    setKeySet(!!s.rebrickable_api_key_set)
    setKeyMasked(s.rebrickable_api_key_masked || '')
    setPinSet(!!s.pin_set)
  }

  useEffect(() => {
    api.getSettings().then(applySettings).catch(() => {})
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
      const s = await api.saveSettings({ rebrickable_api_key: apiKey.trim() })
      applySettings(s)
      setApiKey('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSetPin() {
    setPinBusy(true)
    setPinMsg(null)
    try {
      const res = await api.setPin(newPin, pinSet ? currentPin : null)
      if (newPin) storePin(newPin)
      else clearPin()
      setPinSet(res.pin_set)
      setNewPin('')
      setCurrentPin('')
      setPinMsg({ ok: true, text: res.pin_set ? 'PIN saved — this browser stays unlocked' : 'PIN removed' })
    } catch (e) {
      setPinMsg({ ok: false, text: e.message.includes('PIN') ? e.message : 'Failed: ' + e.message })
    } finally {
      setPinBusy(false)
    }
  }

  async function handleRemovePin() {
    setPinBusy(true)
    setPinMsg(null)
    try {
      const res = await api.setPin('', currentPin)
      clearPin()
      setPinSet(res.pin_set)
      setNewPin('')
      setCurrentPin('')
      setPinMsg({ ok: true, text: 'PIN removed' })
    } catch (e) {
      setPinMsg({ ok: false, text: e.message.includes('PIN') ? e.message : 'Failed: ' + e.message })
    } finally {
      setPinBusy(false)
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
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Settings</h1>

      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-4 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-1">Rebrickable API Key</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            Get a free API key at{' '}
            <a
              href="https://rebrickable.com/api/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 underline"
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
              placeholder={keySet ? `Saved key: ${keyMasked} — paste a new key to replace` : 'Paste your API key here'}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2.5 text-sm pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
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
            disabled={saving || !apiKey.trim()}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Key'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || (!keySet && !apiKey.trim())}
            className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>

        {testResult && (
          <div
            className={`rounded-lg p-3 text-sm ${
              testResult.ok ? 'bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-900' : 'bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-900'
            }`}
          >
            {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
          </div>
        )}
      </div>

      {cachedSets.length > 0 && (
        <div className="mt-6 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Cache Management</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Re-fetch part data from Rebrickable (also updates categories)</p>
            </div>
            <button
              onClick={handleRefreshAll}
              disabled={refreshingAll}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {refreshingAll ? 'Refreshing…' : 'Refresh All'}
            </button>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {cachedSets.map(({ set_num, name }) => {
              const state = refreshing[set_num]
              return (
                <div key={set_num} className="flex items-center gap-2 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{set_num}</p>
                  </div>
                  {state === 'ok' && <span className="text-xs text-green-600 dark:text-green-400 font-medium">Updated</span>}
                  {state === 'error' && <span className="text-xs text-red-600 dark:text-red-400 font-medium">Failed</span>}
                  <button
                    onClick={() => handleRefreshSet(set_num)}
                    disabled={state === 'loading' || refreshingAll}
                    className="flex-shrink-0 px-2.5 py-1 text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {state === 'loading' ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-6 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Backup</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Download a snapshot of the database — all projects, groups, and progress.
              To restore, replace <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">bricklist.db</code> in the data volume with the downloaded file.
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

      <div className="mt-6 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-4 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Security</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {pinSet
              ? 'PIN protection is on — every device on the network needs the PIN.'
              : 'Require a PIN on this network. Anyone without it sees only a lock screen.'}
          </p>
        </div>

        {pinSet && (
          <input
            type="password"
            inputMode="numeric"
            value={currentPin}
            onChange={(e) => { setCurrentPin(e.target.value); setPinMsg(null) }}
            placeholder="Current PIN"
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        )}
        <input
          type="password"
          inputMode="numeric"
          value={newPin}
          onChange={(e) => { setNewPin(e.target.value); setPinMsg(null) }}
          placeholder={pinSet ? 'New PIN (4–12 characters)' : 'Choose a PIN (4–12 characters)'}
          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />

        <div className="flex gap-2">
          <button
            onClick={handleSetPin}
            disabled={pinBusy || newPin.length < 4 || newPin.length > 12 || (pinSet && !currentPin)}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pinBusy ? 'Saving…' : pinSet ? 'Change PIN' : 'Set PIN'}
          </button>
          {pinSet && (
            <button
              onClick={handleRemovePin}
              disabled={pinBusy || !currentPin}
              className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Remove PIN
            </button>
          )}
        </div>

        {pinMsg && (
          <div
            className={`rounded-lg p-3 text-sm ${
              pinMsg.ok ? 'bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-900' : 'bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-900'
            }`}
          >
            {pinMsg.ok ? '✓ ' : '✗ '}{pinMsg.text}
          </div>
        )}
      </div>

      <div className="mt-6 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Diagnostics</h2>
          <button
            onClick={loadDiagnostics}
            disabled={diagLoading}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {diagLoading ? 'Checking…' : 'Refresh'}
          </button>
        </div>
        {!diag && !diagLoading && (
          <p className="text-xs text-gray-400 dark:text-gray-500">Tap Refresh to check system health.</p>
        )}
        {diag && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <DiagRow
              ok={diag.brickscan.reachable}
              label="BrickScan"
              detail={diag.brickscan.reachable
                ? `v${diag.brickscan.version} · catalog ${diag.brickscan.catalog_imported_at ? diag.brickscan.catalog_imported_at.slice(0, 10) : 'unknown'}`
                : (diag.brickscan.error || 'unreachable')}
            />
            <DiagRow
              ok={diag.rebrickable_key_set}
              warn={!diag.rebrickable_key_set}
              label="Rebrickable fallback"
              detail={diag.rebrickable_key_set ? 'API key saved' : 'no API key — fallback unavailable'}
            />
            <DiagRow
              ok={diag.rebrickable_fallbacks.count === 0}
              warn={diag.rebrickable_fallbacks.count > 0}
              label="Catalog misses"
              detail={diag.rebrickable_fallbacks.count === 0
                ? 'no fallbacks since restart'
                : `${diag.rebrickable_fallbacks.count} fetch${diag.rebrickable_fallbacks.count !== 1 ? 'es' : ''} fell back (last: ${diag.rebrickable_fallbacks.last_set})`}
            />
            <DiagRow
              ok={!diag.last_refresh_failure}
              warn={!!diag.last_refresh_failure}
              label="Background refresh"
              detail={diag.last_refresh_failure
                ? `last failure: ${diag.last_refresh_failure.set_num} — ${diag.last_refresh_failure.error}`
                : 'no failures since restart'}
            />
            <DiagRow
              ok={!!diag.backups.last_run?.ok}
              label="Auto-backup"
              detail={diag.backups.last_run
                ? `${diag.backups.last_run.ok ? 'ok' : 'FAILED'} · ${diag.backups.volume.daily} daily / ${diag.backups.volume.monthly} monthly in volume`
                : 'has not run yet'}
            />
            <DiagRow
              ok={diag.backups.mirror.configured && diag.backups.mirror.daily > 0}
              warn={!diag.backups.mirror.configured}
              label="Backup mirror"
              detail={diag.backups.mirror.configured
                ? `${diag.backups.mirror.daily} daily / ${diag.backups.mirror.monthly} monthly mirrored`
                : 'mirror mount missing'}
            />
          </div>
        )}
      </div>

      <div className="mt-6 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-4">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-2">About BrickList</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          BrickList helps you sort Lego bricks into sets by tracking which parts you've found.
          Part data and images are provided by{' '}
          <a href="https://rebrickable.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">
            Rebrickable
          </a>.
        </p>
      </div>
    </div>
  )
}
