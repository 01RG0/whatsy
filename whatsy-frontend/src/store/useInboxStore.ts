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
}

export const useInboxStore = create<InboxState>((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  viewers: {},
  typingLock: {},
  wsConnected: false,

  setConversations: (convs) => set({ conversations: convs }),

  appendConversations: (convs) =>
    set((state) => {
      const existingIds = new Set(state.conversations.map((c) => c.id));
      const toAdd = convs.filter((c) => !existingIds.has(c.id));
      if (toAdd.length === 0) return state;
      return { conversations: [...state.conversations, ...toAdd] };
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
      // deduplicate by id
      if (existing.some((m) => m.id === message.id)) return state;
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
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conv.id ? { ...c, ...conv } : c
      ),
    })),

  bumpConversation: (id, patch) =>
    set((state) => {
      const idx = state.conversations.findIndex((c) => c.id === id);
      if (idx === -1) {
        // Brand-new conversation (first message from a new contact) — prepend if we
        // received a full enough patch to render it.
        if (patch && patch.participant && patch.id) {
          return { conversations: [patch as ZernioConversation, ...state.conversations] };
        }
        return state;
      }
      const updated = patch ? { ...state.conversations[idx], ...patch } : state.conversations[idx];
      const rest = state.conversations.filter((c) => c.id !== id);
      return { conversations: [updated, ...rest] };
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
}));
