import { useEffect, useRef, useCallback } from 'react';
import { useInboxStore, type ViewerInfo, type TypingLock } from './useInboxStore';
import type { ZernioMessage, ZernioConversation } from '../components/types';
import { markRead } from '../api/inbox';

const _apiBase = import.meta.env.VITE_API_URL ?? ''
const WS_URL = _apiBase
  ? _apiBase.replace(/^http/, 'ws') + '/ws'
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const MAX_BACKOFF_MS = 30_000;

type WSAction =
  | { action: 'SUBSCRIBE_STUDENT'; studentId: string }
  | { action: 'UNSUBSCRIBE_STUDENT'; studentId: string }
  | { action: 'TYPING_START'; studentId: string }
  | { action: 'TYPING_STOP'; studentId: string };

interface NewMessageEvent {
  event: 'NEW_MESSAGE';
  studentId: string;
  message: ZernioMessage;
}
interface MessageStatusEvent {
  event: 'MESSAGE_STATUS';
  messageId: string;
  status: ZernioMessage['status'];
}
interface ViewersChangedEvent {
  event: 'STUDENT_VIEWERS_CHANGED';
  studentId: string;
  viewers: ViewerInfo[];
}
interface TypingLockEvent {
  event: 'AGENT_TYPING_LOCK';
  studentId: string;
  lockedBy: ViewerInfo;
  expiresInMs: number;
}
interface TypingLockReleasedEvent {
  event: 'TYPING_LOCK_RELEASED';
  studentId: string;
}
interface ConversationUpdatedEvent {
  event: 'CONVERSATION_UPDATED';
  conversation: Partial<ZernioConversation> & { id: string };
}
interface ReactionEvent {
  event: 'REACTION';
  messageId: string;
  conversationId: string;
  emoji: string;
}
interface MessageDeletedEvent {
  event: 'MESSAGE_DELETED';
  messageId: string;
  conversationId: string;
}

type ServerEvent =
  | NewMessageEvent
  | MessageStatusEvent
  | ViewersChangedEvent
  | TypingLockEvent
  | TypingLockReleasedEvent
  | ConversationUpdatedEvent
  | ReactionEvent
  | MessageDeletedEvent;

function getToken(): string {
  return localStorage.getItem('whatsy_jwt') ?? '';
}

function getMyAgentId(): string {
  try {
    const token = getToken();
    if (!token) return '';
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.agent_id ?? payload.sub ?? '';
  } catch {
    return '';
  }
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const activeIdRef = useRef<string | null>(null);

  const setWsConnected = useInboxStore((state) => state.setWsConnected);
  const receiveMessage = useInboxStore((state) => state.receiveMessage);
  const updateMessageStatus = useInboxStore((state) => state.updateMessageStatus);
  const setViewers = useInboxStore((state) => state.setViewers);
  const setTypingLock = useInboxStore((state) => state.setTypingLock);
  const bumpConversation = useInboxStore((state) => state.bumpConversation);
  const updateConversation = useInboxStore((state) => state.updateConversation);
  const activeConversationId = useInboxStore((state) => state.activeConversationId);
  const wsConnected = useInboxStore((state) => state.wsConnected);

  const sendAction = useCallback((action: WSAction) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(action));
    }
  }, []);

  const connect = useCallback(() => {
    const token = getToken();
    const url = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = 1000;
      setWsConnected(true);
      // re-subscribe if we had an active conversation
      if (activeIdRef.current) {
        sendAction({ action: 'SUBSCRIBE_STUDENT', studentId: activeIdRef.current });
      }
    };

    ws.onmessage = (evt) => {
      let data: ServerEvent;
      try {
        data = JSON.parse(evt.data as string) as ServerEvent;
      } catch {
        return;
      }

      switch (data.event) {
        case 'NEW_MESSAGE': {
          const msg = data.message;
          const conversationId = msg.conversationId || data.studentId;
          receiveMessage(conversationId, { ...msg, conversationId });

          const activeId = useInboxStore.getState().activeConversationId;
          const isViewingActive =
            conversationId === activeId &&
            typeof document !== 'undefined' &&
            document.visibilityState === 'visible';

          // Move the conversation to the top and update last message preview.
          bumpConversation(conversationId, {
            ...(isViewingActive ? { unreadCount: 0 } : {}),
            lastMessage: {
              id: msg.id,
              content: msg.content || '',
              type: msg.type,
              direction: msg.direction,
              senderName: msg.senderName,
              createdAt: msg.createdAt,
              status: msg.status,
            },
            updatedAt: msg.createdAt,
          });

          if (isViewingActive) {
            updateConversation({ id: conversationId, unreadCount: 0 });
            markRead(conversationId).catch(() => undefined);
          }
          break;
        }
        case 'MESSAGE_STATUS':
          updateMessageStatus(data.messageId, data.status);
          break;
        case 'STUDENT_VIEWERS_CHANGED':
          setViewers(data.studentId, data.viewers);
          break;
        case 'AGENT_TYPING_LOCK': {
          // Ignore lock events originating from this agent — we don't lock ourselves out.
          if (data.lockedBy.agentId === getMyAgentId()) break;
          const lock: TypingLock = { lockedBy: data.lockedBy, expiresInMs: data.expiresInMs };
          setTypingLock(data.studentId, lock);
          break;
        }
        case 'TYPING_LOCK_RELEASED':
          setTypingLock(data.studentId, null);
          break;
        case 'REACTION': {
          const { messageId, conversationId, emoji } = data;
          useInboxStore.getState().addReaction(conversationId, messageId, emoji);
          break;
        }
        case 'MESSAGE_DELETED': {
          const { messageId, conversationId } = data;
          useInboxStore.getState().deleteMessage(conversationId, messageId);
          break;
        }
        case 'CONVERSATION_UPDATED': {
          const patch = { ...data.conversation } as Partial<ZernioConversation> & { id: string };
          const activeId = useInboxStore.getState().activeConversationId;
          const isViewingActive =
            patch.id === activeId &&
            typeof document !== 'undefined' &&
            document.visibilityState === 'visible';

          // For the active conversation, keep unreadCount 0 when actively viewing,
          // and suppress positive increments to avoid badge flash.
          if (isViewingActive) {
            patch.unreadCount = 0;
          } else if (
            patch.id === activeId &&
            typeof patch.unreadCount === 'number' &&
            patch.unreadCount > 0
          ) {
            delete (patch as Record<string, unknown>).unreadCount;
          }
          updateConversation(patch);
          break;
        }
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      wsRef.current = null;
      const delay = Math.min(backoffRef.current, MAX_BACKOFF_MS);
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      retryRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [bumpConversation, receiveMessage, sendAction, setTypingLock, setViewers, setWsConnected, updateMessageStatus]);

  // Initial connection
  useEffect(() => {
    connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Subscribe/unsubscribe when active conversation changes
  useEffect(() => {
    const prev = activeIdRef.current;
    if (prev && prev !== activeConversationId) {
      sendAction({ action: 'UNSUBSCRIBE_STUDENT', studentId: prev });
    }
    if (activeConversationId) {
      activeIdRef.current = activeConversationId;
      sendAction({ action: 'SUBSCRIBE_STUDENT', studentId: activeConversationId });
    }
  }, [activeConversationId, sendAction]);

  const onInputFocus = useCallback(() => {
    if (activeIdRef.current) {
      sendAction({ action: 'TYPING_START', studentId: activeIdRef.current });
    }
  }, [sendAction]);

  const onInputBlur = useCallback(() => {
    if (activeIdRef.current) {
      sendAction({ action: 'TYPING_STOP', studentId: activeIdRef.current });
    }
  }, [sendAction]);

  return {
    connected: wsConnected,
    sendAction,
    onInputFocus,
    onInputBlur,
  };
}
