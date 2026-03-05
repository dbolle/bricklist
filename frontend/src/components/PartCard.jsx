import { useRef, useCallback } from 'react'

export default function PartCard({ part, foundQty, onUpdate }) {
  const timerRef = useRef(null)
  const isComplete = foundQty >= part.quantity
  const isPartial = foundQty > 0 && foundQty < part.quantity

  const handleClick = useCallback(() => {
    if (isComplete) {
      onUpdate(part.id, 0)
    } else {
      onUpdate(part.id, foundQty + 1)
    }
  }, [part.id, foundQty, isComplete, onUpdate])

  const handlePointerDown = useCallback(() => {
    if (foundQty <= 0) return
    timerRef.current = setTimeout(() => {
      onUpdate(part.id, Math.max(0, foundQty - 1))
    }, 600)
  }, [part.id, foundQty, onUpdate])

  const handlePointerUp = useCallback(() => {
    clearTimeout(timerRef.current)
  }, [])

  const handlePointerLeave = useCallback(() => {
    clearTimeout(timerRef.current)
  }, [])

  let bgClass = 'bg-white'
  if (isComplete) bgClass = 'bg-green-50'
  else if (isPartial) bgClass = 'bg-yellow-50'

  return (
    <div
      className={`part-card relative rounded-xl shadow-sm border cursor-pointer select-none overflow-hidden ${bgClass} ${
        isComplete ? 'border-green-300' : isPartial ? 'border-yellow-300' : 'border-gray-200'
      }`}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      style={{ borderLeftWidth: '4px', borderLeftColor: `#${part.color_rgb}` }}
      title={`${part.part_name} — ${part.color_name}\nHold to decrement`}
    >
      {/* Completion overlay */}
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
        <div
          className={`${part.part_img_url ? 'hidden' : 'flex'} w-full h-full items-center justify-center`}
        >
          <span className="text-xs text-gray-400 text-center px-1">{part.part_num}</span>
        </div>
      </div>

      {/* Info */}
      <div className="p-2">
        <p className="text-xs font-medium text-gray-800 leading-tight line-clamp-2">{part.part_name}</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{part.color_name}</p>

        {/* Progress */}
        <div className="mt-1.5 flex items-center justify-between">
          <span
            className={`text-sm font-bold ${
              isComplete ? 'text-green-600' : isPartial ? 'text-yellow-600' : 'text-gray-400'
            }`}
          >
            {foundQty}/{part.quantity}
          </span>
          {part.is_spare && (
            <span className="text-xs bg-gray-100 text-gray-500 px-1 rounded">spare</span>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-1 h-1 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isComplete ? 'bg-green-500' : 'bg-yellow-400'
            }`}
            style={{ width: `${Math.min(100, (foundQty / part.quantity) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
