import { useEffect, useRef, useCallback } from 'react';
import { useInboxStore, type ViewerInfo, type TypingLock } from './useInboxStore';
import type { ZernioMessage, ZernioConversation } from '../components/types';

const WS_URL = 'ws://localhost:8080/ws';
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

type ServerEvent =
  | NewMessageEvent
  | MessageStatusEvent
  | ViewersChangedEvent
  | TypingLockEvent
  | TypingLockReleasedEvent
  | ConversationUpdatedEvent;

function getToken(): string {
  return localStorage.getItem('whatsy_jwt') ?? '';
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const activeIdRef = useRef<string | null>(null);

  const store = useInboxStore();

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
      store.setWsConnected(true);
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
        case 'NEW_MESSAGE':
          store.receiveMessage(data.message.conversationId, data.message);
          break;
        case 'MESSAGE_STATUS':
          store.updateMessageStatus(data.messageId, data.status);
          break;
        case 'STUDENT_VIEWERS_CHANGED':
          store.setViewers(data.studentId, data.viewers);
          break;
        case 'AGENT_TYPING_LOCK': {
          const lock: TypingLock = { lockedBy: data.lockedBy, expiresInMs: data.expiresInMs };
          store.setTypingLock(data.studentId, lock);
          break;
        }
        case 'TYPING_LOCK_RELEASED':
          store.setTypingLock(data.studentId, null);
          break;
        case 'CONVERSATION_UPDATED':
          store.updateConversation(data.conversation);
          break;
      }
    };

    ws.onclose = () => {
      store.setWsConnected(false);
      wsRef.current = null;
      const delay = Math.min(backoffRef.current, MAX_BACKOFF_MS);
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      retryRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [store, sendAction]);

  // Initial connection
  useEffect(() => {
    connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Subscribe/unsubscribe when active conversation changes
  const activeConversationId = store.activeConversationId;
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
    connected: store.wsConnected,
    sendAction,
    onInputFocus,
    onInputBlur,
  };
}
