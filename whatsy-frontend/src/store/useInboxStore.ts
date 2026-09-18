import { create } from 'zustand';
import type {
  ZernioConversation,
  ZernioMessage,
} from '../components/types';
export type { ZernioConversation };

export interface ViewerInfo {
  agentId: string;
  name: string;
  avatar: string;
}

export interface TypingLock {
  lockedBy: ViewerInfo;
  expiresInMs: number;
}

interface InboxState {
  conversations: ZernioConversation[];
  totalUnread: number;
  activeConversationId: string | null;
  messages: Record<string, ZernioMessage[]>;
  viewers: Record<string, ViewerInfo[]>;
  typingLock: Record<string, TypingLock | null>;
  wsConnected: boolean;

  setConversations: (convs: ZernioConversation[]) => void;
  appendConversations: (convs: ZernioConversation[]) => void;
  setActiveConversation: (id: string) => void;
  setMessages: (conversationId: string, msgs: ZernioMessage[]) => void;
  mergeMessages: (conversationId: string, msgs: ZernioMessage[]) => void;
  receiveMessage: (conversationId: string, message: ZernioMessage) => void;
  updateMessageStatus: (messageId: string, status: ZernioMessage['status']) => void;
  updateConversation: (conv: Partial<ZernioConversation> & { id: string }) => void;
  bumpConversation: (id: string, patch?: Partial<ZernioConversation>) => void;
  setViewers: (studentId: string, viewers: ViewerInfo[]) => void;
  setTypingLock: (studentId: string, lock: TypingLock | null) => void;
  setWsConnected: (connected: boolean) => void;
  addReaction: (conversationId: string, messageId: string, emoji: string) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  replaceMessage: (conversationId: string, tempId: string, real: ZernioMessage) => void;
}

const isUnread = (c: ZernioConversation | Partial<ZernioConversation>) =>
  (c.unreadCount ?? 0) > 0 || !!c.isMarkedUnread;

export const useInboxStore = create<InboxState>((set) => ({
  conversations: [],
  totalUnread: 0,
  activeConversationId: null,
  messages: {},
  viewers: {},
  typingLock: {},
  wsConnected: false,

  setConversations: (convs) =>
    set((state) => {
      const locallyRead = new Set(
        state.conversations
          .filter((c) => c.unreadCount === 0 && !c.isMarkedUnread)
          .map((c) => c.id)
      );
      const merged = convs.map((c) =>
        locallyRead.has(c.id) ? { ...c, unreadCount: 0, isMarkedUnread: false } : c
      );

      if (state.activeConversationId) {
        const stillPresent = merged.some((c) => c.id === state.activeConversationId);
        if (!stillPresent) {
          const kept = state.conversations.find((c) => c.id === state.activeConversationId);
          if (kept) {
            const list = [kept, ...merged];
            return { conversations: list, totalUnread: list.filter(isUnread).length };
          }
        }
      }
      return { conversations: merged, totalUnread: merged.filter(isUnread).length };
    }),

  appendConversations: (convs) =>
    set((state) => {
      const existingIds = new Set(state.conversations.map((c) => c.id));
      const toAdd = convs.filter((c) => !existingIds.has(c.id));
      if (toAdd.length === 0) return state;
      const addedUnread = toAdd.filter(isUnread).length;
      return {
        conversations: [...state.conversations, ...toAdd],
        totalUnread: state.totalUnread + addedUnread,
      };
    }),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  setMessages: (conversationId, msgs) =>
    set((state) => ({
      messages: { ...state.messages, [conversationId]: msgs },
    })),

  mergeMessages: (conversationId, msgs) =>
    set((state) => {
      const existing = state.messages[conversationId] ?? [];
      const existingIds = new Set(existing.map((m) => m.id));
      const toAdd = msgs.filter((m) => !existingIds.has(m.id));
      if (toAdd.length === 0) return state;
      const merged = [...existing, ...toAdd].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      return { messages: { ...state.messages, [conversationId]: merged } };
    }),

  receiveMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.messages[conversationId] ?? [];
      if (existing.some((m) => m.id === message.id)) return state;
      // If this is an outbound message from the server and we have a temp
      // optimistic message with matching content, replace it instead of adding.
      if (message.direction === 'outbound' && !message.id.startsWith('temp-')) {
        const tempIdx = existing.findIndex(
          (m) => m.id.startsWith('temp-') && m.direction === 'outbound'
        );
        if (tempIdx !== -1) {
          const replaced = [...existing];
          replaced[tempIdx] = message;
          return { messages: { ...state.messages, [conversationId]: replaced } };
        }
      }
      return {
        messages: { ...state.messages, [conversationId]: [...existing, message] },
      };
    }),

  updateMessageStatus: (messageId, status) =>
    set((state) => {
      const updated: Record<string, ZernioMessage[]> = {};
      for (const [convId, msgs] of Object.entries(state.messages)) {
        updated[convId] = msgs.map((m) => (m.id === messageId ? { ...m, status } : m));
      }
      return { messages: updated };
    }),

  updateConversation: (conv) =>
    set((state) => {
      let delta = 0;
      const conversations = state.conversations.map((c) => {
        if (c.id !== conv.id) return c;
        const wasUnread = isUnread(c);
        const patched = { ...c, ...conv };
        const nowUnread = isUnread(patched);
        if (wasUnread && !nowUnread) delta = -1;
        else if (!wasUnread && nowUnread) delta = 1;
        return patched;
      });
      return { conversations, totalUnread: Math.max(0, state.totalUnread + delta) };
    }),

  bumpConversation: (id, patch) =>
    set((state) => {
      const idx = state.conversations.findIndex((c) => c.id === id);
      if (idx === -1) {
        if (patch && patch.participant && patch.id) {
          const added = isUnread(patch) ? 1 : 0;
          return {
            conversations: [patch as ZernioConversation, ...state.conversations],
            totalUnread: state.totalUnread + added,
          };
        }
        return state;
      }
      const old = state.conversations[idx];
      const updated = patch ? { ...old, ...patch } : old;
      const rest = state.conversations.filter((c) => c.id !== id);
      let delta = 0;
      if (isUnread(old) && !isUnread(updated)) delta = -1;
      else if (!isUnread(old) && isUnread(updated)) delta = 1;
      return {
        conversations: [updated, ...rest],
        totalUnread: Math.max(0, state.totalUnread + delta),
      };
    }),

  setViewers: (studentId, viewers) =>
    set((state) => ({
      viewers: { ...state.viewers, [studentId]: viewers },
    })),

  setTypingLock: (studentId, lock) =>
    set((state) => ({
      typingLock: { ...state.typingLock, [studentId]: lock },
    })),

  setWsConnected: (connected) => set({ wsConnected: connected }),

  addReaction: (conversationId, messageId, emoji) =>
    set((state) => {
      const msgs = state.messages[conversationId];
      if (!msgs) return state;
      return {
        messages: {
          ...state.messages,
          [conversationId]: msgs.map((m) =>
            m.id === messageId ? { ...m, reaction: emoji } : m
          ),
        },
      };
    }),

  deleteMessage: (conversationId, messageId) =>
    set((state) => {
      const msgs = state.messages[conversationId];
      if (!msgs) return state;
      return {
        messages: {
          ...state.messages,
          [conversationId]: msgs.filter((m) => m.id !== messageId),
        },
      };
    }),

  replaceMessage: (conversationId, tempId, real) =>
    set((state) => {
      const msgs = state.messages[conversationId];
      if (!msgs) return state;
      return {
        messages: {
          ...state.messages,
          [conversationId]: msgs.map((m) => (m.id === tempId ? real : m)),
        },
      };
    }),
}));
