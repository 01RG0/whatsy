import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { ChatWindow } from './ChatWindow';
import { useInboxStore } from '../store/useInboxStore';
import { useWebSocket } from '../store/useWebSocket'
import { getMessages, getConversations, sendMessage, markRead, markUnread, assignConversation, getAgents } from '../api/inbox';
import type { AgentSummary } from '../api/inbox';
import type { ZernioConversation, ZernioMessage, ConversationFilter, SendMessagePayload } from './types';
import { useT } from '../i18n/translations';

export const WhatsAppInboxApp: React.FC = () => {
  const t = useT();
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

  const appendConversations = useInboxStore((s) => s.appendConversations);
  const setCurrentFilter = useInboxStore((s) => s.setCurrentFilter);
  const setCurrentSearch = useInboxStore((s) => s.setCurrentSearch);
  const setMobileChatOpen = useInboxStore((s) => s.setMobileChatOpen);

  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(true);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
  const [showConnected, setShowConnected] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState<Record<string, boolean>>({});
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);

  const totalUnread = useInboxStore((s) => s.totalUnread);

  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) Whatsy` : 'Whatsy';
  }, [totalUnread]);

  // Keep currentFilter/currentSearch in the store so WS handler can access them.
  useEffect(() => { setCurrentFilter(filter); }, [filter, setCurrentFilter]);
  useEffect(() => { setCurrentSearch(searchQuery); }, [searchQuery, setCurrentSearch]);
  useEffect(() => { setMobileChatOpen(showChatOnMobile); }, [showChatOnMobile, setMobileChatOpen]);

  // Re-fetch conversations on every filter or search change — instant results.
  useEffect(() => {
    setHasMoreConversations(true);
    import('../api/inbox').then(({ getConversations }) => {
      getConversations(filter, searchQuery)
        .then((convs) => {
          convs.forEach((conv) => {
            if (conv.lastMessage?.direction === 'outbound' && conv.unreadCount > 0) {
              conv.unreadCount = 0;
              conv.isMarkedUnread = false;
              markRead(conv.id).catch(() => undefined);
            }
          });
          setConversations(convs);
          if (convs.length < 100) setHasMoreConversations(false);
        })
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
    getMessages(id, 100)
      .then((msgs) => {
        mergeMessages(id, [...msgs].reverse());
        setHasMoreMessages((prev) => ({ ...prev, [id]: msgs.length >= 100 }));
      })
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


  // Refetch conversations + messages and mark active conversation as read when tab becomes visible or focused.
  useEffect(() => {
    const handleActiveFocus = () => {
      if (document.visibilityState !== 'visible') return;
      import('../api/inbox').then(({ getConversations }) => {
        getConversations(filter, searchQuery)
          .then(setConversations)
          .catch(() => undefined);
      });
      if (activeConversationId) {
        updateConversation({ id: activeConversationId, unreadCount: 0 });
        markRead(activeConversationId).catch(() => undefined);
        getMessages(activeConversationId)
          .then((msgs) => mergeMessages(activeConversationId, [...msgs].reverse()))
          .catch(() => undefined);
      }
    };

    document.addEventListener('visibilitychange', handleActiveFocus);
    window.addEventListener('focus', handleActiveFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleActiveFocus);
      window.removeEventListener('focus', handleActiveFocus);
    };
  }, [activeConversationId, mergeMessages, filter, searchQuery, setConversations, updateConversation]);

  // Flash "Connected" banner for 3s when WS connects.
  useEffect(() => {
    if (wsConnected) {
      setShowConnected(true);
      const t = setTimeout(() => setShowConnected(false), 3000);
      return () => clearTimeout(t);
    } else {
      setShowConnected(false);
    }
  }, [wsConnected]);

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

  // 30-second background sync — silently merges any conversations missed while WS was lagging.
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      import('../api/inbox').then(({ getConversations }) => {
        getConversations(filter, searchQuery)
          .then((convs) => {
            const store = useInboxStore.getState();
            const existingIds = new Set(store.conversations.map((c) => c.id));
            convs.forEach((conv) => {
              if (existingIds.has(conv.id) && conv.id !== store.activeConversationId) {
                // Last message is agent's own reply — unread MUST be 0; fix the DB too.
                if (conv.lastMessage?.direction === 'outbound' && conv.unreadCount > 0) {
                  markRead(conv.id).catch(() => undefined);
                  store.updateConversation({ ...conv, unreadCount: 0, isMarkedUnread: false });
                  return;
                }
                if (conv.id === store.activeConversationId) {
                  // Actively viewing — always keep it marked as read.
                  store.updateConversation({ ...conv, unreadCount: 0, isMarkedUnread: false });
                } else {
                  store.updateConversation(conv);
                }
              }
            });
            const newConvs = convs.filter((c) => !existingIds.has(c.id));
            if (newConvs.length > 0) {
              store.setConversations([...newConvs, ...store.conversations]);
            }
          })
          .catch(() => undefined);
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, [filter, searchQuery]);

  // Load older messages when the user scrolls to the top.
  const handleLoadMoreMessages = useCallback(async () => {
    if (!activeConversationId || isLoadingMoreMessages) return;
    const msgs = messages[activeConversationId] ?? [];
    if (msgs.length === 0) return;
    const oldestId = msgs[0].id;
    setIsLoadingMoreMessages(true);
    try {
      const olderMsgs = await getMessages(activeConversationId, 50, oldestId);
      if (olderMsgs.length > 0) {
        mergeMessages(activeConversationId, [...olderMsgs].reverse());
        if (olderMsgs.length < 50) {
          setHasMoreMessages((prev) => ({ ...prev, [activeConversationId]: false }));
        }
      } else {
        setHasMoreMessages((prev) => ({ ...prev, [activeConversationId]: false }));
      }
    } catch {
      // silently ignore
    } finally {
      setIsLoadingMoreMessages(false);
    }
  }, [activeConversationId, isLoadingMoreMessages, messages, mergeMessages]);

  const handleLoadMoreConversations = useCallback(() => {
    if (isLoadingMoreConversations || !hasMoreConversations || conversations.length === 0) return;
    setIsLoadingMoreConversations(true);
    const lastId = conversations[conversations.length - 1].id;
    import('../api/inbox').then(({ getConversations }) => {
      getConversations(filter, searchQuery, 100, lastId)
        .then((convs) => {
          appendConversations(convs);
          if (convs.length < 100) setHasMoreConversations(false);
        })
        .catch((err) => console.error('[WhatsAppInboxApp] load more conversations:', err))
        .finally(() => setIsLoadingMoreConversations(false));
    });
  }, [isLoadingMoreConversations, hasMoreConversations, conversations, filter, searchQuery, appendConversations]);

  const handleRefreshConversations = useCallback(() => {
    getConversations(filter, searchQuery)
      .then((convs) => {
        setConversations(convs);
        setHasMoreConversations(convs.length >= 100);
      })
      .catch((err) => console.error('[WhatsAppInboxApp] refresh conversations:', err));
  }, [filter, searchQuery, setConversations]);

  const handleMarkAllRead = useCallback(() => {
    const unread = conversations.filter((conversation) => conversation.unreadCount > 0 || conversation.isMarkedUnread);
    if (unread.length === 0) return;
    const count = unread.length;
    if (!window.confirm(t.mark_all_read_confirm(count))) return;
    Promise.all(unread.map((conversation) => markRead(conversation.id)))
      .then(() => unread.forEach((conversation) => updateConversation({ id: conversation.id, unreadCount: 0, isMarkedUnread: false })))
      .catch((err) => console.error('[WhatsAppInboxApp] mark all read:', err));
  }, [conversations, updateConversation]);

  const handleMarkUnread = useCallback(
    (conversationId: string) => {
      updateConversation({
        id: conversationId,
        isMarkedUnread: true,
        unreadCount: Math.max(conversations.find((c) => c.id === conversationId)?.unreadCount ?? 0, 1),
      });
      markUnread(conversationId).catch((err) => {
        console.error('[WhatsAppInboxApp] mark unread:', err);
      });
    },
    [conversations, updateConversation]
  );

  const handleMarkRead = useCallback(
    (conversationId: string) => {
      updateConversation({
        id: conversationId,
        isMarkedUnread: false,
        unreadCount: 0,
      });
      markRead(conversationId).catch((err) => {
        console.error('[WhatsAppInboxApp] mark read:', err);
      });
    },
    [updateConversation]
  );

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

  // Server applies filter/search, but WebSocket updates bypass that. Re-apply client-side
  // so real-time changes (mark-read, new messages) are reflected immediately.
  const filteredConversations = conversations.filter((c) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!(
        c.participant?.displayName?.toLowerCase().includes(q) ||
        c.participant?.phoneNumber?.toLowerCase().includes(q) ||
        c.lastMessage?.content?.toLowerCase().includes(q)
      )) return false;
    }
    if (filter === 'unread') return (c.unreadCount ?? 0) > 0 || !!c.isMarkedUnread;
    return true;
  });

  const handleSelectConversation = useCallback(
    (conv: ZernioConversation) => {
      setActiveConversation(conv.id);
      updateConversation({ id: conv.id, unreadCount: 0, isMarkedUnread: false });
      markRead(conv.id).catch(() => undefined);
      setShowChatOnMobile(true);
    },
    [setActiveConversation, updateConversation]
  );

  const handleSendMessage = useCallback(
    async (payload: Partial<SendMessagePayload>) => {
      if (!activeConversationId) return;
      const now = new Date().toISOString();
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimistic: ZernioMessage = {
        id: tempId,
        conversationId: activeConversationId,
        direction: 'outbound',
        type: payload.voiceNote ? 'voice_note' : (payload.attachmentType === 'file' ? 'document' : (payload.attachmentType as ZernioMessage['type'])) || 'text',
        content: payload.message || '',
        status: 'sent',
        createdAt: now,
        attachments: payload.attachmentUrl
          ? [{
              url: payload.attachmentUrl,
              type: (payload.attachmentType === 'file' ? 'file' : (payload.attachmentType || 'document')) as 'image' | 'audio' | 'video' | 'file' | 'document',
              name: payload.attachmentName,
            }]
          : [],
      };
      receiveMessage(activeConversationId, optimistic);
      bumpConversation(activeConversationId, {
        lastMessage: {
          id: tempId,
          content: optimistic.content,
          type: optimistic.type,
          direction: 'outbound',
          senderName: optimistic.senderName,
          createdAt: now,
          status: 'sent',
        },
        updatedAt: now,
        unreadCount: 0,
        isMarkedUnread: false,
      });
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const real = await sendMessage(activeConversationId, payload);
          useInboxStore.getState().replaceMessage(activeConversationId, tempId, { ...real, status: 'sent' });
          updateConversation({
            id: activeConversationId,
            lastMessage: {
              id: real.id,
              content: real.content,
              type: real.type,
              direction: real.direction,
              senderName: real.senderName,
              createdAt: real.createdAt,
              status: real.status,
            },
            updatedAt: real.createdAt,
          });
          return;
        } catch (err) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, (attempt + 1) * 1000));
            continue;
          }
          console.error('[WhatsAppInboxApp] sendMessage failed:', err);
          useInboxStore.getState().updateMessageStatus(tempId, 'failed');
        }
      }
    },
    [activeConversationId, bumpConversation, receiveMessage, updateConversation]
  );

  const handleRetryMessage = useCallback(
    async (message: ZernioMessage) => {
      if (!activeConversationId) return;
      useInboxStore.getState().updateMessageStatus(message.id, 'pending');
      const payload: Partial<SendMessagePayload> = { message: message.content };
      if (message.attachments?.length) {
        payload.attachmentUrl = message.attachments[0].url;
        payload.attachmentType = message.attachments[0].type;
      }
      try {
        const real = await sendMessage(activeConversationId, payload);
        useInboxStore.getState().replaceMessage(activeConversationId, message.id, { ...real, status: 'sent' });
      } catch (err) {
        console.error('[WhatsAppInboxApp] retry failed:', err);
        useInboxStore.getState().updateMessageStatus(message.id, 'failed');
      }
    },
    [activeConversationId]
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
          {t.reconnecting}
        </div>
      )}
      {wsConnected && showConnected && (
        <div className="flex items-center justify-center gap-1.5 bg-emerald-500/90 text-white text-xs py-0.5 px-3 shrink-0 transition-opacity duration-500">
          <span className="w-1.5 h-1.5 rounded-full bg-white" />
          {t.connected}
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
          onLoadMore={handleLoadMoreConversations}
          hasMore={hasMoreConversations}
          isLoadingMore={isLoadingMoreConversations}
          onRefresh={handleRefreshConversations}
          onMarkAllRead={handleMarkAllRead}
          onMarkUnread={handleMarkUnread}
          onMarkRead={handleMarkRead}
        />
      </div>
      <div className={!showChatOnMobile ? 'hidden md:contents' : 'contents'}>
        <ChatWindow
          conversation={activeConversation}
          messages={currentMessages}
          isLoadingMessages={isLoadingMessages}
          onSendMessage={handleSendMessage}
          onRetryMessage={handleRetryMessage}
          viewers={activeViewers}
          typingLock={activeLock}
          onInputFocus={onInputFocus}
          onInputBlur={onInputBlur}
          agents={agents}
          onAssign={handleAssign}
          onMarkUnread={handleMarkUnread}
          onMarkRead={handleMarkRead}
          onBack={() => setShowChatOnMobile(false)}
          onLoadMoreMessages={handleLoadMoreMessages}
          hasMoreMessages={activeConversationId ? (hasMoreMessages[activeConversationId] ?? false) : false}
          isLoadingMoreMessages={isLoadingMoreMessages}
        />
      </div>
      </div>
    </div>
  );
};

export default WhatsAppInboxApp;
