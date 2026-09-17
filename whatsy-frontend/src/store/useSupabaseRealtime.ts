import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useInboxStore } from './useInboxStore'
import { getMessagesDirect as getMessages } from '../api/inbox'
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

// Broadcast ping shape — intentionally contains NO message content.
// The anon key is public, so we never put sensitive data in this channel.
interface BroadcastPing {
  id: string
  conversationId: string
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
  const mergeMessages = useInboxStore((s) => s.mergeMessages)
  // Keep stable refs so the effect never re-runs due to store selector changes
  const receiveRef = useRef(receiveMessage)
  const bumpRef = useRef(bumpConversation)
  const mergeRef = useRef(mergeMessages)
  receiveRef.current = receiveMessage
  bumpRef.current = bumpConversation
  mergeRef.current = mergeMessages

  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) return;

    // Fetch fresh messages for a conversation and merge into the store.
    // Used by both broadcast ping and WAL fallback so both paths stay in sync.
    function refreshConversation(conversationId: string) {
      getMessages(conversationId)
        .then((msgs) => mergeRef.current(conversationId, [...msgs].reverse()))
        .catch(() => undefined)
    }

    function handleWALRow(row: DBMessage) {
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

    // Primary: backend-pushed ping — instant (<200ms).
    // Only carries { id, conversationId } — no message content — so it's
    // safe on a public channel. We re-fetch the actual message via the
    // authenticated REST API.
    const broadcastChannel = supabase
      .channel('inbox')
      .on('broadcast', { event: 'new-message' }, (payload) => {
        const ping = payload.payload as BroadcastPing
        if (ping?.conversationId) {
          refreshConversation(ping.conversationId)
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Supabase] broadcast channel connected')
        }
      })

    // Fallback: WAL replication — 3-5s but catches anything the broadcast missed.
    // Uses raw DB row data so no extra HTTP round-trip needed.
    const walChannel = supabase
      .channel('db-messages', { config: { broadcast: { self: false } } })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => handleWALRow(payload.new as DBMessage)
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Supabase] WAL fallback channel connected')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Supabase] WAL channel error:', status)
        }
      })

    return () => {
      supabase.removeChannel(broadcastChannel)
      supabase.removeChannel(walChannel)
    }
  }, []) // empty deps — mount once, refs keep callbacks current
}
