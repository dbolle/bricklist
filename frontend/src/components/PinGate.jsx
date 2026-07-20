import { useState, useEffect, useCallback } from 'react'
import { api, storePin } from '../api.js'

// Wraps the app: when a PIN is configured server-side and this browser
// doesn't have it, everything is replaced by a lock screen.
export default function PinGate({ children }) {
  const [checking, setChecking] = useState(true)
  const [locked, setLocked] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(null)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.getSettings()
      .then(() => { if (!cancelled) setLocked(false) })
      .catch(() => { /* 401 also fires the bricklist:locked event below */ })
      .finally(() => { if (!cancelled) setChecking(false) })

    const onLocked = () => setLocked(true)
    window.addEventListener('bricklist:locked', onLocked)
    return () => {
      cancelled = true
      window.removeEventListener('bricklist:locked', onLocked)
    }
  }, [])

  const handleUnlock = useCallback(async (e) => {
    e.preventDefault()
    if (!pin) return
    setVerifying(true)
    setError(null)
    try {
      const res = await api.verifyPin(pin)
      if (res.ok) {
        storePin(pin)
        window.location.reload()
      } else {
        setError('Wrong PIN')
        setPin('')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setVerifying(false)
    }
  }, [pin])

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!locked) return children

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 w-full max-w-xs text-center">
        <div className="text-4xl mb-2">🧱</div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">BrickList is locked</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Enter the PIN to continue</p>
        <form onSubmit={handleUnlock} className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(null) }}
            autoFocus
            placeholder="PIN"
            className="w-full text-center tracking-widest border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 dark:text-gray-100"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={verifying || !pin}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {verifying ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  )
}
