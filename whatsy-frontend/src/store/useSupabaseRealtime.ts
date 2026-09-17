import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useInboxStore } from './useInboxStore'
import type { ZernioMessage, MessageDirection, MessageType, DeliveryStatus } from '../components/types'

// Raw columns that actually exist in the messages table (no JOINs in realtime)
interface DBMessage {
  id: string
  conversation_id: string
  direction: string
  content_type: string
  content: string | null
  status: string
  timestamp: string
  zernio_message_id: string | null
  sent_by_agent_id: string | null
  attachments: Array<{ url: string; type: string; name?: string }> | null
}

function mapDBMessage(row: DBMessage): ZernioMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: (row.direction || 'inbound') as MessageDirection,
    type: (row.content_type || 'text') as MessageType,
    content: row.content || '',
    status: (row.status || 'sent') as DeliveryStatus,
    createdAt: row.timestamp,
    attachments: Array.isArray(row.attachments) && row.attachments.length > 0
      ? row.attachments.map((a) => ({
          url: a.url,
          type: a.type as 'image' | 'audio' | 'video' | 'document',
          name: a.name,
        }))
      : undefined,
  }
}

export function useSupabaseRealtime() {
  const receiveMessage = useInboxStore((s) => s.receiveMessage)
  const bumpConversation = useInboxStore((s) => s.bumpConversation)
  // Keep stable refs so the effect never re-runs due to store selector changes
  const receiveRef = useRef(receiveMessage)
  const bumpRef = useRef(bumpConversation)
  receiveRef.current = receiveMessage
  bumpRef.current = bumpConversation

  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) return;
    const channel = supabase
      .channel('db-messages', { config: { broadcast: { self: false } } })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as DBMessage
          if (!row?.id || !row?.conversation_id) return

          const msg = mapDBMessage(row)
          receiveRef.current(msg.conversationId, msg)
          bumpRef.current(msg.conversationId, {
            lastMessage: {
              id: msg.id,
              content: msg.content || '',
              type: msg.type,
              direction: msg.direction,
              createdAt: msg.createdAt,
              status: msg.status,
            },
            updatedAt: msg.createdAt,
          })
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Supabase Realtime] connected — listening for new messages')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Supabase Realtime] channel error:', status)
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, []) // empty deps — mount once, refs keep callbacks current
}
