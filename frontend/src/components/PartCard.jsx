import { useState, useRef, useCallback } from 'react'

export default function PartCard({ part, foundQty, onUpdate, projectName }) {
  const [draft, setDraft] = useState(null) // null = not editing
  const inputRef = useRef(null)

  const isComplete = foundQty >= part.quantity
  const isPartial = foundQty > 0 && foundQty < part.quantity

  const numColor = isComplete ? 'text-green-600 dark:text-green-400' : isPartial ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-400 dark:text-gray-500'

  const handleDecrement = useCallback((e) => {
    e.stopPropagation()
    if (foundQty > 0) onUpdate(part.id, foundQty - 1)
  }, [part.id, foundQty, onUpdate])

  const handleIncrement = useCallback((e) => {
    e.stopPropagation()
    if (foundQty < part.quantity) onUpdate(part.id, foundQty + 1)
  }, [part.id, part.quantity, foundQty, onUpdate])

  const handleInputFocus = useCallback((e) => {
    setDraft(String(foundQty))
    e.target.select()
  }, [foundQty])

  const handleInputChange = useCallback((e) => {
    setDraft(e.target.value)
  }, [])

  const commitEdit = useCallback(() => {
    if (draft !== null) {
      const parsed = parseInt(draft, 10)
      if (!isNaN(parsed)) {
        onUpdate(part.id, Math.max(0, Math.min(parsed, part.quantity)))
      }
      setDraft(null)
    }
  }, [draft, part.id, part.quantity, onUpdate])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.target.blur() }
    if (e.key === 'Escape') { setDraft(null); e.target.blur() }
  }, [])

  let bgClass = 'bg-white dark:bg-gray-900'
  if (isComplete) bgClass = 'bg-green-50 dark:bg-green-950'
  else if (isPartial) bgClass = 'bg-yellow-50 dark:bg-yellow-950'

  return (
    <div
      className={`relative rounded-xl shadow-sm border overflow-hidden ${bgClass} ${
        isComplete ? 'border-green-300 dark:border-green-800' : isPartial ? 'border-yellow-300 dark:border-yellow-800' : 'border-gray-200 dark:border-gray-800'
      }`}
      style={{ borderLeftWidth: '4px', borderLeftColor: `#${part.color_rgb}` }}
    >
      {/* Completion checkmark */}
      {isComplete && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center z-10">
          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}

      {/* Part image */}
      <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
        {part.part_img_url ? (
          <img
            src={part.part_img_url}
            alt={part.part_name}
            loading="lazy"
            className="w-full h-full object-contain p-1"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
              e.currentTarget.nextElementSibling.style.display = 'flex'
            }}
          />
        ) : null}
        <div className={`${part.part_img_url ? 'hidden' : 'flex'} w-full h-full items-center justify-center`}>
          <span className="text-xs text-gray-400 dark:text-gray-500 text-center px-1">{part.part_num}</span>
        </div>
      </div>

      {/* Info */}
      <div className="p-2">
        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 leading-tight line-clamp-2">{part.part_name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{part.color_name}</p>
        {part.minifig_name && (
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5 truncate" title={part.minifig_name}>{part.minifig_name}</p>
        )}
        {projectName && (
          <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5 truncate font-medium">{projectName}</p>
        )}
        {part.is_spare && (
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-1 rounded">spare</span>
        )}

        {/* Found / total — centered, found is editable */}
        <div className={`mt-2 text-center font-bold text-sm ${numColor}`}>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={draft !== null ? draft : String(foundQty)}
            onFocus={handleInputFocus}
            onChange={handleInputChange}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className={`w-8 text-center font-bold bg-transparent border-b-2 border-transparent focus:border-blue-400 focus:outline-none ${numColor}`}
          />
          <span>/{part.quantity}</span>
        </div>

        {/* [-] progress bar [+] */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            onClick={handleDecrement}
            disabled={foundQty <= 0}
            className="w-6 h-6 flex-shrink-0 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-gray-700 dark:text-gray-300 font-bold leading-none"
            tabIndex={-1}
          >
            −
          </button>

          <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${isComplete ? 'bg-green-500' : 'bg-yellow-400'}`}
              style={{ width: `${Math.min(100, (foundQty / part.quantity) * 100)}%` }}
            />
          </div>

          <button
            onClick={handleIncrement}
            disabled={foundQty >= part.quantity}
            className="w-6 h-6 flex-shrink-0 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-gray-700 dark:text-gray-300 font-bold leading-none"
            tabIndex={-1}
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}
