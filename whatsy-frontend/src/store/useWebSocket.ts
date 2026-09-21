import { useEffect, useCallback } from 'react';
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

// Module-level singleton so multiple hook calls share one WS connection.
const _ws = {
  socket: null as WebSocket | null,
  retryTimeout: null as ReturnType<typeof setTimeout> | null,
  backoff: 1000,
  activeId: null as string | null,
  refCount: 0,
  sendFn(action: WSAction) {
    if (_ws.socket?.readyState === WebSocket.OPEN) {
      _ws.socket.send(JSON.stringify(action));
    }
  },
};

function connect() {
  const token = getToken();
  const url = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
  const ws = new WebSocket(url);
  _ws.socket = ws;

  const store = useInboxStore.getState;

  ws.onopen = () => {
    _ws.backoff = 1000;
    store().setWsConnected(true);
    if (_ws.activeId) {
      _ws.sendFn({ action: 'SUBSCRIBE_STUDENT', studentId: _ws.activeId });
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
        store().receiveMessage(conversationId, { ...msg, conversationId });

        const activeId = useInboxStore.getState().activeConversationId;
        const isViewingActive =
          conversationId === activeId &&
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible';

        const unreadPatch = isViewingActive
          ? { unreadCount: 0 }
          : msg.direction === 'inbound'
          ? (() => {
              const cur = useInboxStore.getState().conversations.find((c) => c.id === conversationId);
              return { unreadCount: (cur?.unreadCount ?? 0) + 1 };
            })()
          : {};

        store().bumpConversation(conversationId, {
          ...unreadPatch,
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
          store().updateConversation({ id: conversationId, unreadCount: 0 });
          markRead(conversationId).catch(() => undefined);
        }

        {
          const exists = useInboxStore.getState().conversations.some((c) => c.id === conversationId);
          if (!exists) {
            import('../api/inbox').then(({ getConversations }) => {
              const { currentFilter, currentSearch } = useInboxStore.getState();
              getConversations(currentFilter, currentSearch).then((convs) => {
                useInboxStore.getState().setConversations(convs);
              }).catch(() => undefined);
            });
          }
        }
        break;
      }
      case 'MESSAGE_STATUS':
        store().updateMessageStatus(data.messageId, data.status);
        break;
      case 'STUDENT_VIEWERS_CHANGED':
        store().setViewers(data.studentId, data.viewers);
        break;
      case 'AGENT_TYPING_LOCK': {
        if (data.lockedBy.agentId === getMyAgentId()) break;
        const lock: TypingLock = { lockedBy: data.lockedBy, expiresInMs: data.expiresInMs };
        store().setTypingLock(data.studentId, lock);
        break;
      }
      case 'TYPING_LOCK_RELEASED':
        store().setTypingLock(data.studentId, null);
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

        if (isViewingActive) {
          patch.unreadCount = 0;
          if (typeof data.conversation.unreadCount === 'number' && data.conversation.unreadCount > 0) {
            markRead(patch.id).catch(() => undefined);
          }
        } else if (
          patch.id === activeId &&
          typeof patch.unreadCount === 'number' &&
          patch.unreadCount > 0
        ) {
          delete (patch as Record<string, unknown>).unreadCount;
        }
        store().updateConversation(patch);
        break;
      }
    }
  };

  ws.onclose = (event) => {
    store().setWsConnected(false);
    _ws.socket = null;
    // Code 4001 = auth rejected; no token = nothing to auth with.
    // In both cases stop retrying and let the session-invalidated flow handle logout.
    if (event.code === 4001 || !getToken()) {
      window.dispatchEvent(new CustomEvent('whatsy:session_invalidated'));
      return;
    }
    if (_ws.refCount > 0) {
      const delay = Math.min(_ws.backoff, MAX_BACKOFF_MS);
      _ws.backoff = Math.min(_ws.backoff * 2, MAX_BACKOFF_MS);
      _ws.retryTimeout = setTimeout(connect, delay);
    }
  };

  ws.onerror = () => {
    ws.close();
  };
}

export function useWebSocket() {
  const sendAction = useCallback((action: WSAction) => {
    _ws.sendFn(action);
  }, []);

  const activeConversationId = useInboxStore((state) => state.activeConversationId);
  const wsConnected = useInboxStore((state) => state.wsConnected);

  // Manage singleton lifecycle — only connect on first mount, only close on last unmount.
  useEffect(() => {
    _ws.refCount += 1;
    if (_ws.refCount === 1) {
      connect();
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const s = _ws.socket;
        if (!s || s.readyState === WebSocket.CLOSED || s.readyState === WebSocket.CLOSING) {
          if (_ws.retryTimeout) clearTimeout(_ws.retryTimeout);
          _ws.backoff = 1000;
          connect();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      _ws.refCount -= 1;
      if (_ws.refCount === 0) {
        if (_ws.retryTimeout) clearTimeout(_ws.retryTimeout);
        _ws.socket?.close();
      }
    };
  }, []);

  // Subscribe/unsubscribe when active conversation changes
  useEffect(() => {
    const prev = _ws.activeId;
    if (prev && prev !== activeConversationId) {
      sendAction({ action: 'UNSUBSCRIBE_STUDENT', studentId: prev });
    }
    if (activeConversationId) {
      _ws.activeId = activeConversationId;
      sendAction({ action: 'SUBSCRIBE_STUDENT', studentId: activeConversationId });
    }
  }, [activeConversationId, sendAction]);

  const onInputFocus = useCallback(() => {
    if (_ws.activeId) {
      sendAction({ action: 'TYPING_START', studentId: _ws.activeId });
    }
  }, [sendAction]);

  const onInputBlur = useCallback(() => {
    if (_ws.activeId) {
      sendAction({ action: 'TYPING_STOP', studentId: _ws.activeId });
    }
  }, [sendAction]);

  return {
    connected: wsConnected,
    sendAction,
    onInputFocus,
    onInputBlur,
  };
}
