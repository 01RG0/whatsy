import React, { useState, useCallback, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { ChatWindow } from './ChatWindow';
import { useInboxStore } from '../store/useInboxStore';
import { useWebSocket } from '../store/useWebSocket';
import { getMessages, sendMessage, markRead, assignConversation, getAgents } from '../api/inbox';
import type { AgentSummary } from '../api/inbox';
import type { ZernioConversation, ConversationFilter, SendMessagePayload } from './types';

export const WhatsAppInboxApp: React.FC = () => {
  const { onInputFocus, onInputBlur } = useWebSocket();

  const conversations = useInboxStore((s) => s.conversations);
  const setConversations = useInboxStore((s) => s.setConversations);
  const activeConversationId = useInboxStore((s) => s.activeConversationId);
  const messages = useInboxStore((s) => s.messages);
  const viewers = useInboxStore((s) => s.viewers);
  const typingLock = useInboxStore((s) => s.typingLock);
  const setActiveConversation = useInboxStore((s) => s.setActiveConversation);
  const setMessages = useInboxStore((s) => s.setMessages);
  const updateConversation = useInboxStore((s) => s.updateConversation);

  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);

  // Re-fetch conversations on every filter or search change — instant results.
  useEffect(() => {
    import('../api/inbox').then(({ getConversations }) => {
      getConversations(filter, searchQuery)
        .then(setConversations)
        .catch((err) => console.error('[WhatsAppInboxApp] fetch conversations:', err));
    });
  }, [filter, searchQuery, setConversations]);

  // Always reload full message history when switching conversations.
  // API returns DESC (newest first) — reverse to ASC (oldest first) for chat display.
  useEffect(() => {
    if (!activeConversationId) return;
    setIsLoadingMessages(true);
    getMessages(activeConversationId)
      .then((msgs) => setMessages(activeConversationId, [...msgs].reverse()))
      .catch((err) => console.error('[WhatsAppInboxApp] getMessages:', err))
      .finally(() => setIsLoadingMessages(false));
  }, [activeConversationId, setMessages]);

  // Silently prefetch messages for the top 5 conversations after list loads.
  // This makes clicking them feel instant — messages are already in the store.
  useEffect(() => {
    if (conversations.length === 0) return;
    conversations.slice(0, 5).forEach((conv, i) => {
      if (conv.id === activeConversationId) return; // active conv already loading
      if (messages[conv.id]?.length) return; // already cached
      setTimeout(() => {
        getMessages(conv.id)
          .then((msgs) => setMessages(conv.id, [...msgs].reverse()))
          .catch(() => undefined);
      }, (i + 1) * 300); // stagger by 300ms to avoid hammering
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]); // intentionally excludes messages/activeConversationId to run only when list refreshes

  // Load agent list once for the assign dropdown.
  useEffect(() => {
    getAgents()
      .then(setAgents)
      .catch(() => undefined);
  }, []);

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ?? null;

  const currentMessages = activeConversationId
    ? messages[activeConversationId] ?? []
    : [];

  const activeViewers = activeConversationId
    ? viewers[activeConversationId] ?? []
    : [];

  const activeLock = activeConversationId
    ? typingLock[activeConversationId] ?? null
    : null;

  // Server already applied the filter; just apply local search highlight subset if needed.
  const filteredConversations = conversations;

  const handleSelectConversation = useCallback(
    (conv: ZernioConversation) => {
      setActiveConversation(conv.id);
      updateConversation({ id: conv.id, unreadCount: 0 });
      markRead(conv.id).catch(() => undefined);
      setShowChatOnMobile(true);
    },
    [setActiveConversation, updateConversation]
  );

  const handleSendMessage = useCallback(
    async (payload: Partial<SendMessagePayload>) => {
      if (!activeConversationId) return;
      try {
        await sendMessage(activeConversationId, payload);
        // Re-fetch messages so the sent message is guaranteed to appear.
        const msgs = await getMessages(activeConversationId);
        setMessages(activeConversationId, [...msgs].reverse());
      } catch (err) {
        console.error('[WhatsAppInboxApp] sendMessage failed:', err);
      }
    },
    [activeConversationId, setMessages]
  );

  const handleAssign = useCallback(
    async (agentId: string) => {
      if (!activeConversationId) return;
      try {
        await assignConversation(activeConversationId, agentId);
        if (agentId === '') {
          updateConversation({ id: activeConversationId, assignedAgent: undefined });
        } else {
          const agent = agents.find((a) => a.id === agentId);
          updateConversation({
            id: activeConversationId,
            assignedAgent: agent ? { id: agent.id, name: agent.name, avatarUrl: agent.avatar } : undefined,
          });
        }
      } catch (err) {
        console.error('[WhatsAppInboxApp] assignConversation failed:', err);
      }
    },
    [activeConversationId, agents, updateConversation]
  );

  return (
    <div className="w-full flex-1 min-h-0 flex bg-gray-100 dark:bg-[#111b21] overflow-hidden">
      {/* On mobile: show sidebar OR chat, not both. On desktop: always show both. */}
      <div className={showChatOnMobile ? 'hidden md:contents' : 'contents'}>
        <Sidebar
          conversations={filteredConversations}
          activeConversationId={activeConversationId ?? ''}
          onSelectConversation={handleSelectConversation}
          activeFilter={filter}
          onFilterChange={setFilter}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          viewers={viewers}
          typingLocks={typingLock}
        />
      </div>
      <div className={!showChatOnMobile ? 'hidden md:contents' : 'contents'}>
        <ChatWindow
          conversation={activeConversation}
          messages={currentMessages}
          isLoadingMessages={isLoadingMessages}
          onSendMessage={handleSendMessage}
          viewers={activeViewers}
          typingLock={activeLock}
          onInputFocus={onInputFocus}
          onInputBlur={onInputBlur}
          agents={agents}
          onAssign={handleAssign}
          onBack={() => setShowChatOnMobile(false)}
        />
      </div>
    </div>
  );
};

export default WhatsAppInboxApp;
