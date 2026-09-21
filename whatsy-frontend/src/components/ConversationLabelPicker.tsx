import React, { useState } from 'react'
import { useLabelStore } from '../store/useLabelStore'
import { LabelPill } from './LabelPill'
import type { Label } from './types'
import { addConversationLabel, removeConversationLabel } from '../api/inbox'

interface ConversationLabelPickerProps {
  conversationId: string
  /** Names of labels currently assigned to this conversation (from conv.tags). */
  assignedNames: string[]
  onUpdate: (newTagNames: string[]) => void
  onClose: () => void
}

export const ConversationLabelPicker: React.FC<ConversationLabelPickerProps> = ({
  conversationId,
  assignedNames,
  onUpdate,
  onClose,
}) => {
  const { labels } = useLabelStore()
  const [busy, setBusy] = useState<string | null>(null)

  const isAssigned = (label: Label) => assignedNames.includes(label.name)

  const toggle = async (label: Label) => {
    if (busy) return
    setBusy(label.id)
    try {
      let updatedLabels: Label[]
      if (isAssigned(label)) {
        updatedLabels = await removeConversationLabel(conversationId, label.id)
      } else {
        updatedLabels = await addConversationLabel(conversationId, label.id)
      }
      onUpdate(updatedLabels.map((l) => l.name))
    } catch {
      // ignore — server errors don't close the picker
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="absolute end-3 top-full mt-1 z-40 w-52 rounded-xl border border-[#e9edef] dark:border-[#374151] bg-white dark:bg-[#202c33] p-1.5 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="px-2 pt-1 pb-1.5 text-[10px] uppercase font-semibold tracking-wide text-gray-400 dark:text-[#8696a0]">
        Labels
      </p>
      {labels.length === 0 && (
        <p className="px-3 py-2 text-xs text-gray-400 dark:text-[#8696a0]">No labels defined yet.</p>
      )}
      {labels.map((label) => {
        const assigned = isAssigned(label)
        return (
          <button
            key={label.id}
            type="button"
            onClick={() => toggle(label)}
            disabled={busy === label.id}
            className="flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-start hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition disabled:opacity-50"
          >
            <span
              className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition ${
                assigned
                  ? 'bg-[#00a884] border-[#00a884]'
                  : 'border-gray-300 dark:border-[#555f69]'
              }`}
            >
              {assigned && (
                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            <LabelPill label={label} size="xs" />
          </button>
        )
      })}
      <div className="my-1 border-t border-[#e9edef] dark:border-[#374151]" />
      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-lg px-3 py-1.5 text-xs text-center text-gray-500 dark:text-[#8696a0] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition"
      >
        Done
      </button>
    </div>
  )
}
