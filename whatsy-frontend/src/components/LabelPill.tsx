import React from 'react'
import type { Label } from './types'

interface LabelPillProps {
  label: Label
  onRemove?: () => void
  size?: 'xs' | 'sm'
}

/** Renders a colored pill for a single label. */
export const LabelPill: React.FC<LabelPillProps> = ({ label, onRemove, size = 'xs' }) => {
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs'
  const px = size === 'xs' ? 'px-1.5 py-0.5' : 'px-2 py-0.5'

  // Derive a readable text color (dark/light) from the hex background.
  const textColor = isLightColor(label.color) ? '#1a1a1a' : '#ffffff'

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full font-medium shrink-0 ${textSize} ${px}`}
      style={{ backgroundColor: label.color, color: textColor }}
      title={label.name}
    >
      <span className="truncate max-w-[80px]">{label.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="opacity-70 hover:opacity-100 transition leading-none"
          aria-label={`Remove label ${label.name}`}
        >
          ×
        </button>
      )}
    </span>
  )
}

/** Returns true when the hex color is light enough to need dark text. */
function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '')
  if (c.length < 6) return true
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  // Perceived luminance formula
  return (r * 299 + g * 587 + b * 114) / 1000 > 150
}
