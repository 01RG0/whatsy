import { create } from 'zustand';
import type {
  ZernioConversation,
  ZernioMessage,
} from '../components/types';

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
  setActiveConversation: (id: string) => void;
  setMessages: (conversationId: string, msgs: ZernioMessage[]) => void;
  receiveMessage: (conversationId: string, message: ZernioMessage) => void;
  updateMessageStatus: (messageId: string, status: ZernioMessage['status']) => void;
  updateConversation: (conv: Partial<ZernioConversation> & { id: string }) => void;
  setViewers: (studentId: string, viewers: ViewerInfo[]) => void;
  setTypingLock: (studentId: string, lock: TypingLock | null) => void;
  setWsConnected: (connected: boolean) => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  viewers: {},
  typingLock: {},
  wsConnected: false,

  setConversations: (convs) => set({ conversations: convs }),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  setMessages: (conversationId, msgs) =>
    set((state) => ({
      messages: { ...state.messages, [conversationId]: msgs },
    })),

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

  setViewers: (studentId, viewers) =>
    set((state) => ({
      viewers: { ...state.viewers, [studentId]: viewers },
    })),

  setTypingLock: (studentId, lock) =>
    set((state) => ({
      typingLock: { ...state.typingLock, [studentId]: lock },
    })),

  setWsConnected: (connected) => set({ wsConnected: connected }),
}));
