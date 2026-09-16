import React, { useState, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { ChatWindow } from './ChatWindow';
import { useInboxStore } from '../store/useInboxStore';
import { useWebSocket } from '../store/useWebSocket';
import { getMessages, sendMessage, markRead } from '../api/inbox';
import type { ZernioConversation, ConversationFilter, SendMessagePayload } from './types';

export const WhatsAppInboxApp: React.FC = () => {
  const { onInputFocus, onInputBlur } = useWebSocket();

  const conversations = useInboxStore((s) => s.conversations);
  const activeConversationId = useInboxStore((s) => s.activeConversationId);
  const messages = useInboxStore((s) => s.messages);
  const viewers = useInboxStore((s) => s.viewers);
  const typingLock = useInboxStore((s) => s.typingLock);
  const setActiveConversation = useInboxStore((s) => s.setActiveConversation);
  const setMessages = useInboxStore((s) => s.setMessages);
  const updateConversation = useInboxStore((s) => s.updateConversation);

  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

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

  const filteredConversations = conversations.filter((c) => {
    const matchesSearch =
      c.participant.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.lastMessage?.content ?? '').toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filter === 'unread') return c.unreadCount > 0;
    if (filter === 'groups') return !!c.isGroup;
    if (filter === 'assigned_to_me') return !!c.assignedAgent;
    return true;
  });

  const handleSelectConversation = useCallback(
    async (conv: ZernioConversation) => {
      setActiveConversation(conv.id);
      updateConversation({ id: conv.id, unreadCount: 0 });

      // Load messages if not already loaded
      if (!messages[conv.id]) {
        try {
          const msgs = await getMessages(conv.id);
          setMessages(conv.id, msgs);
        } catch (err) {
          console.error('[WhatsAppInboxApp] getMessages failed:', err);
        }
      }

      // Fire-and-forget read receipt
      markRead(conv.id).catch(() => undefined);
    },
    [messages, setActiveConversation, setMessages, updateConversation]
  );

  const handleSendMessage = useCallback(
    async (payload: Partial<SendMessagePayload>) => {
      if (!activeConversationId) return;
      try {
        await sendMessage(activeConversationId, payload);
        // Backend broadcasts NEW_MESSAGE via WebSocket — store updated automatically
      } catch (err) {
        console.error('[WhatsAppInboxApp] sendMessage failed:', err);
      }
    },
    [activeConversationId]
  );

  return (
    <div className="w-full h-screen flex bg-gray-100 dark:bg-[#111b21] overflow-hidden">
      <Sidebar
        conversations={filteredConversations}
        activeConversationId={activeConversationId ?? ''}
        onSelectConversation={handleSelectConversation}
        activeFilter={filter}
        onFilterChange={setFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />
      <ChatWindow
        conversation={activeConversation}
        messages={currentMessages}
        onSendMessage={handleSendMessage}
        viewers={activeViewers}
        typingLock={activeLock}
        onInputFocus={onInputFocus}
        onInputBlur={onInputBlur}
      />
    </div>
  );
};

export default WhatsAppInboxApp;
