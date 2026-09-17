import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { ChatWindow } from './ChatWindow';
import { useInboxStore } from '../store/useInboxStore';
import { useWebSocket } from '../store/useWebSocket'
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
  const wsConnected = useInboxStore((s) => s.wsConnected);
  const setActiveConversation = useInboxStore((s) => s.setActiveConversation);
  const setMessages = useInboxStore((s) => s.setMessages);
  const mergeMessages = useInboxStore((s) => s.mergeMessages);
  const updateConversation = useInboxStore((s) => s.updateConversation);
  const receiveMessage = useInboxStore((s) => s.receiveMessage);
  const bumpConversation = useInboxStore((s) => s.bumpConversation);

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

  // Reload message history when switching conversations.
  // Use mergeMessages (not setMessages) so any realtime messages that arrived
  // during the fetch are not wiped — deduplication handles the overlap.
  useEffect(() => {
    if (!activeConversationId) return;
    const id = activeConversationId;
    setIsLoadingMessages(true);
    getMessages(id)
      .then((msgs) => mergeMessages(id, [...msgs].reverse()))
      .catch((err) => console.error('[WhatsAppInboxApp] getMessages:', err))
      .finally(() => setIsLoadingMessages(false));
  }, [activeConversationId, mergeMessages]);

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


  // Refetch conversations + messages when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      import('../api/inbox').then(({ getConversations }) => {
        getConversations(filter, searchQuery)
          .then(setConversations)
          .catch(() => undefined);
      });
      if (activeConversationId) {
        getMessages(activeConversationId)
          .then((msgs) => mergeMessages(activeConversationId, [...msgs].reverse()))
          .catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [activeConversationId, mergeMessages, filter, searchQuery, setConversations]);

  // When WebSocket reconnects, refresh both conversation list and active messages.
  const prevWsConnected = useRef(wsConnected);
  useEffect(() => {
    if (wsConnected && !prevWsConnected.current) {
      import('../api/inbox').then(({ getConversations }) => {
        getConversations(filter, searchQuery)
          .then(setConversations)
          .catch(() => undefined);
      });
      if (activeConversationId) {
        const id = activeConversationId;
        getMessages(id)
          .then((msgs) => mergeMessages(id, [...msgs].reverse()))
          .catch(() => undefined);
      }
    }
    prevWsConnected.current = wsConnected;
  }, [wsConnected, activeConversationId, mergeMessages, filter, searchQuery, setConversations]);

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
        const sentMessage = await sendMessage(activeConversationId, payload);
        receiveMessage(activeConversationId, sentMessage);
        bumpConversation(activeConversationId, {
          lastMessage: {
            id: sentMessage.id,
            content: sentMessage.content || '',
            type: sentMessage.type,
            direction: sentMessage.direction,
            createdAt: sentMessage.createdAt,
            status: sentMessage.status,
          },
          updatedAt: sentMessage.createdAt,
        });
      } catch (err) {
        console.error('[WhatsAppInboxApp] sendMessage failed:', err);
      }
    },
    [activeConversationId, bumpConversation, receiveMessage]
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
    <div className="w-full flex-1 min-h-0 flex flex-col bg-gray-100 dark:bg-[#111b21] overflow-hidden">
      {!wsConnected && (
        <div className="flex items-center justify-center gap-2 bg-yellow-500/90 text-white text-xs py-1 px-3 shrink-0">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          Reconnecting…
        </div>
      )}
      <div className="flex-1 min-h-0 flex overflow-hidden">
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
    </div>
  );
};

export default WhatsAppInboxApp;
