import { useState, useEffect } from 'react'
import { api } from '../api.js'

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getSettings().then((s) => setApiKey(s.rebrickable_api_key || ''))
  }, [])

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
