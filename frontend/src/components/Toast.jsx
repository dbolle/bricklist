import { useState, useRef, useCallback } from 'react'

export function useToast() {
  const [toast, setToast] = useState(null)
  const timerRef = useRef(null)

  const showToast = useCallback((msg, { isError = false, undo = null } = {}) => {
    clearTimeout(timerRef.current)
    setToast({ msg, isError, undo })
    timerRef.current = setTimeout(() => setToast(null), undo ? 4000 : 2500)
  }, [])

  const dismissToast = useCallback(() => {
    clearTimeout(timerRef.current)
    setToast(null)
  }, [])

  return { toast, showToast, dismissToast }
}

export default function Toast({ toast, onDismiss }) {
  if (!toast) return null
  return (
    <div
      className={`fixed bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-xl px-4 py-2 text-sm text-white shadow-lg z-50 max-w-[85vw] ${
        toast.isError ? 'bg-red-600' : 'bg-gray-800'
      }`}
    >
      <span className="truncate">{toast.msg}</span>
      {toast.undo && (
        <button
          onClick={() => { toast.undo(); onDismiss() }}
          className="flex-shrink-0 font-bold text-xs uppercase tracking-wide text-blue-300 hover:text-blue-200"
        >
          Undo
        </button>
      )}
    </div>
  )
}
