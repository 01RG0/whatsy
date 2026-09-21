import React, { useState } from 'react'
import { useLabelStore } from '../store/useLabelStore'
import { LabelPill } from './LabelPill'
import type { Label } from './types'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
  '#6b7280', '#0ea5e9', '#84cc16', '#f59e0b',
]

interface LabelManagerProps {
  onClose: () => void
}

export const LabelManager: React.FC<LabelManagerProps> = ({ onClose }) => {
  const { labels, add, update, remove } = useLabelStore()
  const [editing, setEditing] = useState<Label | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[5])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const resetForm = () => {
    setEditing(null)
    setCreating(false)
    setName('')
    setColor(PRESET_COLORS[5])
    setError('')
  }

  const openCreate = () => {
    setEditing(null)
    setName('')
    setColor(PRESET_COLORS[5])
    setError('')
    setCreating(true)
  }

  const openEdit = (label: Label) => {
    setCreating(false)
    setEditing(label)
    setName(label.name)
    setColor(label.color)
    setError('')
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      if (editing) {
        await update(editing.id, name.trim(), color)
      } else {
        await add(name.trim(), color)
      }
      resetForm()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save label')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this label? It will be removed from all conversations.')) return
    setDeleting(id)
    try {
      await remove(id)
    } catch {
      // ignore
    } finally {
      setDeleting(null)
    }
  }

  const isFormOpen = creating || editing != null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-[#e9edef] dark:border-[#374151] bg-white dark:bg-[#202c33] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e9edef] dark:border-[#374151]">
          <h2 className="font-semibold text-gray-900 dark:text-[#e9edef]">Manage Labels</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Label list */}
        <div className="max-h-64 overflow-y-auto px-4 py-3 space-y-1.5">
          {labels.length === 0 && !isFormOpen && (
            <p className="text-sm text-center text-gray-400 dark:text-[#8696a0] py-4">No labels yet.</p>
          )}
          {labels.map((label) => (
            <div
              key={label.id}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] group"
            >
              <LabelPill label={label} size="sm" />
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  type="button"
                  onClick={() => openEdit(label)}
                  className="p-1 text-gray-400 hover:text-[#3b82f6] transition"
                  title="Edit label"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(label.id)}
                  disabled={deleting === label.id}
                  className="p-1 text-gray-400 hover:text-red-500 transition"
                  title="Delete label"
                >
                  {deleting === label.id ? (
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Create / Edit form */}
        {isFormOpen && (
          <div className="px-4 py-3 border-t border-[#e9edef] dark:border-[#374151] space-y-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-[#8696a0] uppercase tracking-wide">
              {editing ? 'Edit label' : 'New label'}
            </p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
              placeholder="Label name"
              className="w-full rounded-lg border border-[#e9edef] dark:border-[#374151] bg-[#f0f2f5] dark:bg-[#111b21] px-3 py-2 text-sm text-gray-900 dark:text-[#e9edef] outline-none focus:ring-2 focus:ring-[#00a884]"
            />
            {/* Color presets */}
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-6 h-6 rounded-full border-2 transition"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? '#00a884' : 'transparent',
                    outline: color === c ? '2px solid #00a884' : 'none',
                  }}
                  title={c}
                />
              ))}
              {/* Custom hex input */}
              <label className="flex items-center gap-1 cursor-pointer" title="Custom color">
                <span className="w-6 h-6 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 text-xs">+</span>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="sr-only"
                />
              </label>
            </div>
            {/* Color preview */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-[#8696a0]">Preview:</span>
              <span
                className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: color,
                  color: isLightColor(color) ? '#1a1a1a' : '#ffffff',
                }}
              >
                {name || 'Label'}
              </span>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white text-sm font-medium py-2 transition disabled:opacity-60"
              >
                {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 rounded-lg border border-[#e9edef] dark:border-[#374151] text-sm text-gray-600 dark:text-[#aebac1] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        {!isFormOpen && (
          <div className="px-4 pb-4 pt-2 border-t border-[#e9edef] dark:border-[#374151]">
            <button
              type="button"
              onClick={openCreate}
              className="w-full rounded-lg border border-dashed border-[#e9edef] dark:border-[#374151] py-2 text-sm text-[#00a884] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition flex items-center justify-center gap-1.5"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New label
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '')
  if (c.length < 6) return true
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 150
}
