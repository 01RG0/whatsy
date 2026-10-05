import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { ChatWindow } from './ChatWindow';
import { ForwardModal } from './ForwardModal';
import { useInboxStore } from '../store/useInboxStore';
import { useWebSocket } from '../store/useWebSocket'
import { getMessages, getConversations, sendMessage, markRead, markUnread, markAllReadSince, assignConversation, getAgents, addConversationLabel } from '../api/inbox';
import type { AgentSummary } from '../api/inbox';
import type { ZernioConversation, ZernioMessage, ConversationFilter, SendMessagePayload } from './types';
import { useT } from '../i18n/translations';
import { useLabelStore } from '../store/useLabelStore';
import { getSavedAccounts } from '../lib/auth';

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

  const { labels: allLabels } = useLabelStore();

  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'all' | 'numbers'>('all');
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  const [activeLabelId, setActiveLabelId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  const handleLabelFilterToggle = useCallback((labelId: string) => {
    setActiveLabelId(prev => prev === labelId ? null : labelId);
  }, []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState<ZernioMessage | null>(null);
  const [showMarkAllReadModal, setShowMarkAllReadModal] = useState(false);
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  }, []);

  // On mobile, push a history entry when a chat opens so the system back button
  // closes the chat instead of exiting the app.
  const openChatOnMobile = useCallback(() => {
    window.history.pushState({ mobileChatOpen: true }, '');
    setShowChatOnMobile(true);
    setMobileChatOpen(true);
  }, [setMobileChatOpen]);

  const closeChatOnMobile = useCallback(() => {
    setShowChatOnMobile(false);
    setMobileChatOpen(false);
  }, [setMobileChatOpen]);

  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      if (showChatOnMobile && !(e.state as { mobileChatOpen?: boolean } | null)?.mobileChatOpen) {
        closeChatOnMobile();
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [showChatOnMobile, closeChatOnMobile]);
  // Eagerly persist the current user to whatsy_accounts on mount so the account
  // switcher is never empty on first open (no-op if already saved).
  useEffect(() => {
    getSavedAccounts();
  }, []);

  const [hasMoreConversations, setHasMoreConversations] = useState(true);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
  const [showConnected, setShowConnected] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState<Record<string, boolean>>({});
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);

  const totalUnanswered = useInboxStore((s) => s.conversations.filter(c => c.lastMessage?.direction === 'inbound').length);

  useEffect(() => {
    document.title = totalUnanswered > 0 ? `(${totalUnanswered}) Whatsy` : 'Whatsy';
  }, [totalUnanswered]);

  // Keep currentFilter/currentSearch in the store so WS handler can access them.
  useEffect(() => { setCurrentFilter(filter); }, [filter, setCurrentFilter]);
  useEffect(() => { setCurrentSearch(searchQuery); }, [searchQuery, setCurrentSearch]);

  // Re-fetch conversations on every filter, search, or label change — instant results.
  useEffect(() => {
    setHasMoreConversations(true);
    import('../api/inbox').then(({ getConversations }) => {
      getConversations(filter, searchQuery, 100, undefined, activeLabelId ?? undefined, searchType)
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
  }, [filter, searchQuery, searchType, activeLabelId, setConversations]);

  // Reload message history when switching conversations.
  // Use mergeMessages (not setMessages) so any realtime messages that arrived
  // during the fetch are not wiped — deduplication handles the overlap.
  useEffect(() => {
    if (!activeConversationId) return;
    const id = activeConversationId;
    const hasCached = (useInboxStore.getState().messages[id]?.length ?? 0) > 0;
    if (!hasCached) setIsLoadingMessages(true);
    getMessages(id, 100)
      .then((msgs) => {
        mergeMessages(id, [...msgs].reverse());
        setHasMoreMessages((prev) => ({ ...prev, [id]: msgs.length >= 100 }));
      })
      .catch((err) => console.error('[WhatsAppInboxApp] getMessages:', err))
      .finally(() => {
        if (id === useInboxStore.getState().activeConversationId) {
          setIsLoadingMessages(false);
        }
      });
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
      const connected = useInboxStore.getState().wsConnected;
      if (!connected) {
        import('../api/inbox').then(({ getConversations }) => {
          getConversations(filter, searchQuery, 100, undefined, activeLabelId ?? undefined)
            .then(setConversations)
            .catch(() => undefined);
        });
      }
      if (activeConversationId) {
        updateConversation({ id: activeConversationId, unreadCount: 0 });
        markRead(activeConversationId).catch(() => undefined);
        if (!connected) {
          getMessages(activeConversationId)
            .then((msgs) => mergeMessages(activeConversationId, [...msgs].reverse()))
            .catch(() => undefined);
        }
      }
    };

    document.addEventListener('visibilitychange', handleActiveFocus);
    window.addEventListener('focus', handleActiveFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleActiveFocus);
      window.removeEventListener('focus', handleActiveFocus);
    };
  }, [activeConversationId, mergeMessages, filter, searchQuery, activeLabelId, setConversations, updateConversation]);

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

  // 60-second background sync — silently merges any conversations missed while WS was lagging.
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (Date.now() - useInboxStore.getState().lastWsEventAt < 55_000) return;
      import('../api/inbox').then(({ getConversations }) => {
        getConversations(filter, searchQuery)
          .then((convs) => {
            const store = useInboxStore.getState();
            const existingIds = new Set(store.conversations.map((c) => c.id));
            convs.forEach((conv) => {
              if (!existingIds.has(conv.id)) return;
              if (conv.id === store.activeConversationId) {
                store.updateConversation({ ...conv, unreadCount: 0, isMarkedUnread: false });
              } else {
                store.updateConversation(conv);
              }
            });
            const newConvs = convs.filter((c) => !existingIds.has(c.id));
            if (newConvs.length > 0) {
              store.setConversations([...newConvs, ...store.conversations]);
            }
          })
          .catch(() => undefined);
      });
    }, 60_000);
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
      getConversations(filter, searchQuery, 100, lastId, activeLabelId ?? undefined)
        .then((convs) => {
          appendConversations(convs);
          if (convs.length < 100) setHasMoreConversations(false);
        })
        .catch((err) => console.error('[WhatsAppInboxApp] load more conversations:', err))
        .finally(() => setIsLoadingMoreConversations(false));
    });
  }, [isLoadingMoreConversations, hasMoreConversations, conversations, filter, searchQuery, activeLabelId, appendConversations]);

  const handleRefreshConversations = useCallback(() => {
    getConversations(filter, searchQuery, 100, undefined, activeLabelId ?? undefined)
      .then((convs) => {
        setConversations(convs);
        setHasMoreConversations(convs.length >= 100);
      })
      .catch((err) => console.error('[WhatsAppInboxApp] refresh conversations:', err));
  }, [filter, searchQuery, activeLabelId, setConversations]);

  const handleTagsChange = useCallback(
    (conversationId: string, tags: string[]) => {
      updateConversation({ id: conversationId, tags });
    },
    [updateConversation]
  );

  const handleMarkAllRead = useCallback(() => {
    const hasUnread = conversations.some((c) => c.unreadCount > 0 || c.isMarkedUnread);
    if (!hasUnread) return;
    setShowMarkAllReadModal(true);
  }, [conversations]);

  const handleMarkAllReadWithRange = useCallback(
    (range: '1h' | '24h' | '7d' | 'all' | 'custom') => {
      let since: Date | null = null;
      if (range === '1h') {
        since = new Date(Date.now() - 1 * 60 * 60 * 1000);
      } else if (range === '24h') {
        since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      } else if (range === '7d') {
        since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      } else if (range === 'all') {
        since = null;
      } else if (range === 'custom') {
        since = customFromDate ? new Date(customFromDate) : null;
      }
      setShowMarkAllReadModal(false);
      markAllReadSince(since)
        .then(() => {
          const sinceTime = since ? since.getTime() : 0;
          useInboxStore.getState().conversations.forEach((c) => {
            if ((c.unreadCount > 0 || c.isMarkedUnread) && new Date(c.updatedAt).getTime() >= sinceTime) {
              updateConversation({ id: c.id, unreadCount: 0, isMarkedUnread: false });
            }
          });
        })
        .catch((err) => console.error('[WhatsAppInboxApp] mark all read:', err));
    },
    [customFromDate, updateConversation]
  );

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

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, []);

  const handleBulkAssignLabel = useCallback(async (labelId: string) => {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map(id =>
      addConversationLabel(id, labelId)
        .then(tags => updateConversation({ id, tags }))
        .catch(() => undefined)
    ));
    handleClearSelection();
  }, [selectedIds, updateConversation, handleClearSelection]);

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
      if (searchType === 'numbers') {
        const cleanQuery = q.replace(/\D/g, '');
        const phone = (c.participant?.phoneNumber || '').replace(/\D/g, '');
        if (!phone.includes(cleanQuery)) return false;
      } else {
        if (!(
          c.participant?.displayName?.toLowerCase().includes(q) ||
          c.participant?.phoneNumber?.toLowerCase().includes(q) ||
          c.lastMessage?.content?.toLowerCase().includes(q)
        )) return false;
      }
    }
    if (filter === 'unread') return ((c.unreadCount ?? 0) > 0 || !!c.isMarkedUnread) && (!c.lastMessage?.direction || c.lastMessage.direction === 'inbound');
    if (filter === 'unanswered') return !c.lastMessage?.direction || c.lastMessage.direction === 'inbound';
    if (activeLabelId) {
      const activeName = allLabels.find(l => l.id === activeLabelId)?.name;
      if (activeName && !(c.tags ?? []).includes(activeName)) return false;
    }
    return true;
  });

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(filteredConversations.map(c => c.id)));
  }, [filteredConversations]);

  const handleSelectConversation = useCallback(
    (conv: ZernioConversation) => {
      setActiveConversation(conv.id);
      updateConversation({ id: conv.id, unreadCount: 0, isMarkedUnread: false });
      markRead(conv.id).catch(() => undefined);
      openChatOnMobile();
    },
    [setActiveConversation, updateConversation, openChatOnMobile]
  );

  const handleSelectMessageResult = useCallback(
    (convId: string, messageId: string) => {
      setActiveConversation(convId);
      setTargetMessageId(messageId);
      openChatOnMobile();
    },
    [setActiveConversation, openChatOnMobile]
  );

  const handleContactMessage = useCallback(
    (phone: string) => {
      const normalized = phone.replace(/\D/g, '')
      const conv = conversations.find((c) => {
        const pid = (c.participant?.phoneNumber || c.participant?.id || c.participant?.username || '').replace(/\D/g, '')
        return pid === normalized
      })
      if (conv) {
        handleSelectConversation(conv)
      }
    },
    [conversations, handleSelectConversation]
  );

  const handleSendMessage = useCallback(
    async (payload: Partial<SendMessagePayload>) => {
      if (!activeConversationId) return;
      const now = new Date().toISOString();
      const tempId = `temp-${crypto.randomUUID()}`;

      let replyTo: ZernioMessage['replyTo'] | undefined;
      if (payload.replyTo) {
        const convMessages = messages[activeConversationId] ?? [];
        const quoted = convMessages.find((m) => m.id === payload.replyTo);
        if (quoted) {
          replyTo = {
            id: quoted.id,
            senderName:
              quoted.direction === 'outbound'
                ? 'You'
                : (quoted.senderName || (activeConversation as any)?.participantName || activeConversation?.participant?.displayName || 'Contact'),
            content: quoted.content || (quoted.attachments?.length ? 'Attachment' : ''),
          };
        }
      }

      const optimistic: ZernioMessage = {
        id: tempId,
        conversationId: activeConversationId,
        direction: 'outbound',
        type: payload.voiceNote ? 'voice_note' : (payload.attachmentType === 'file' ? 'document' : (payload.attachmentType as ZernioMessage['type'])) || 'text',
        content: payload.message || '',
        status: 'sent',
        createdAt: now,
        ...(replyTo ? { replyTo } : {}),
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
    [activeConversationId, bumpConversation, receiveMessage, updateConversation, messages, activeConversation]
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
      if (message.replyTo) {
        payload.replyTo = message.replyTo.id;
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

  const handleForwardSubmit = useCallback(
    async (targetConversationIds: string[], msg: ZernioMessage) => {
      let basePayload: Partial<SendMessagePayload>;

      if (msg.type === 'contacts') {
        basePayload = {
          contacts: [
            {
              name: { formatted_name: msg.content || '' },
              phones: [{ phone: msg.contactPhone || '' }],
            },
          ],
          forwarded: true,
        };
      } else if (msg.attachments && msg.attachments.length > 0) {
        basePayload = {
          message: msg.content || '',
          attachmentUrl: msg.attachments[0].url,
          attachmentType: (msg.attachments[0].mimeType || msg.attachments[0].type) as any,
          attachmentName: msg.attachments[0].name,
          forwarded: true,
        };
      } else {
        basePayload = {
          message: msg.content || '',
          forwarded: true,
        };
      }

      const now = new Date().toISOString();

      await Promise.all(
        targetConversationIds.map(async (targetId) => {
          const tempId = `temp-${crypto.randomUUID()}`;
          const optimistic: ZernioMessage = {
            id: tempId,
            conversationId: targetId,
            direction: 'outbound',
            type: msg.type,
            content: basePayload.message || msg.content || '',
            status: 'sent',
            createdAt: now,
            isForwarded: true,
            contactPhone: msg.contactPhone,
            attachments: basePayload.attachmentUrl
              ? [
                  {
                    url: basePayload.attachmentUrl,
                    type: (basePayload.attachmentType === 'file' ? 'file' : (basePayload.attachmentType || 'document')) as any,
                    name: basePayload.attachmentName,
                  },
                ]
              : msg.attachments,
          };

          receiveMessage(targetId, optimistic);
          bumpConversation(targetId, {
            lastMessage: {
              id: tempId,
              content: optimistic.content,
              type: optimistic.type,
              direction: 'outbound',
              senderName: 'You',
              createdAt: now,
              status: 'sent',
            },
            updatedAt: now,
            unreadCount: 0,
            isMarkedUnread: false,
          });

          try {
            const real = await sendMessage(targetId, basePayload);
            useInboxStore.getState().replaceMessage(targetId, tempId, { ...real, status: 'sent', isForwarded: true });
            updateConversation({
              id: targetId,
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
          } catch (err) {
            console.error(`[WhatsAppInboxApp] Forward to ${targetId} failed:`, err);
            useInboxStore.getState().updateMessageStatus(tempId, 'failed');
          }
        })
      );

      setForwardingMessage(null);
      showToast(t.message_forwarded);
    },
    [receiveMessage, bumpConversation, updateConversation, showToast, t.message_forwarded]
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
          onTagsChange={handleTagsChange}
          activeLabelId={activeLabelId}
          onLabelFilterChange={handleLabelFilterToggle}
          onLabelFilterClear={() => setActiveLabelId(null)}
          selectionMode={selectionMode}
          onToggleSelectionMode={() => setSelectionMode(v => !v)}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
          onClearSelection={handleClearSelection}
          onBulkAssignLabel={handleBulkAssignLabel}
          searchType={searchType}
          onSearchTypeChange={setSearchType}
          onSelectMessageResult={handleSelectMessageResult}
        />
      </div>
      <div className={!showChatOnMobile ? 'hidden md:contents' : 'contents'}>
        <ChatWindow
          key={activeConversationId ?? ''}
          conversation={activeConversation}
          messages={currentMessages}
          isLoadingMessages={isLoadingMessages}
          initialTargetMessageId={targetMessageId}
          onClearInitialTargetMessageId={() => setTargetMessageId(null)}
          onSendMessage={handleSendMessage}
          onRetryMessage={handleRetryMessage}
          onForward={(msg) => setForwardingMessage(msg)}
          onContactMessage={handleContactMessage}
          viewers={activeViewers}
          typingLock={activeLock}
          onInputFocus={onInputFocus}
          onInputBlur={onInputBlur}
          agents={agents}
          onAssign={handleAssign}
          onMarkUnread={handleMarkUnread}
          onMarkRead={handleMarkRead}
          onTagsChange={handleTagsChange}
          onBack={() => { window.history.back(); }}
          onLoadMoreMessages={handleLoadMoreMessages}
          hasMoreMessages={activeConversationId ? (hasMoreMessages[activeConversationId] ?? false) : false}
          isLoadingMoreMessages={isLoadingMoreMessages}
        />
      </div>
      </div>

      <ForwardModal
        isOpen={Boolean(forwardingMessage)}
        message={forwardingMessage}
        conversations={conversations}
        onClose={() => setForwardingMessage(null)}
        onForward={handleForwardSubmit}
      />

      {showMarkAllReadModal && (() => {
        const ranges: Array<{ key: '1h' | '24h' | '7d' | 'all'; label: string }> = [
          { key: '1h', label: t.mark_all_read_last_hour },
          { key: '24h', label: t.mark_all_read_last_24h },
          { key: '7d', label: t.mark_all_read_last_7d },
          { key: 'all', label: t.mark_all_read_all_time },
        ];
        const getCutoff = (key: '1h' | '24h' | '7d' | 'all') => {
          if (key === '1h') return Date.now() - 1 * 60 * 60 * 1000;
          if (key === '24h') return Date.now() - 24 * 60 * 60 * 1000;
          if (key === '7d') return Date.now() - 7 * 24 * 60 * 60 * 1000;
          return 0;
        };
        const customFromMs = customFromDate ? new Date(customFromDate).getTime() : 0;
        const customToMs = customToDate ? new Date(customToDate).getTime() : Date.now();
        const countForRange = (key: '1h' | '24h' | '7d' | 'all') => {
          const cutoff = getCutoff(key);
          return conversations.filter((c) =>
            (c.unreadCount > 0 || c.isMarkedUnread) && new Date(c.updatedAt).getTime() >= cutoff
          ).length;
        };
        const customCount = conversations.filter((c) =>
          (c.unreadCount > 0 || c.isMarkedUnread) &&
          new Date(c.updatedAt).getTime() >= customFromMs &&
          new Date(c.updatedAt).getTime() <= customToMs
        ).length;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowMarkAllReadModal(false)}>
            <div
              className="bg-white dark:bg-[#202c33] rounded-xl shadow-2xl w-80 mx-4 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700/50">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {t.mark_all_read_modal_title}
                </h2>
              </div>
              <div className="p-3 flex flex-col gap-1.5">
                {ranges.map(({ key, label }) => {
                  const count = countForRange(key);
                  return (
                    <button
                      key={key}
                      onClick={() => handleMarkAllReadWithRange(key)}
                      className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-medium text-gray-800 dark:text-gray-200 hover:bg-[#00a884]/10 dark:hover:bg-[#00a884]/20 transition-colors text-start"
                    >
                      <span>{label}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 ms-2 shrink-0">
                        {count === 0 ? t.mark_all_read_none : t.mark_all_read_conversations(count)}
                      </span>
                    </button>
                  );
                })}
                <div className="mt-1 rounded-lg border border-gray-200 dark:border-gray-700/50 p-3">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Custom range</p>
                  <div className="flex gap-2 mb-2">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 dark:text-gray-500 mb-1">From</label>
                      <input
                        type="datetime-local"
                        value={customFromDate}
                        onChange={(e) => setCustomFromDate(e.target.value)}
                        className="w-full text-xs bg-gray-100 dark:bg-[#111b21] text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-[#00a884]"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 dark:text-gray-500 mb-1">To</label>
                      <input
                        type="datetime-local"
                        value={customToDate}
                        onChange={(e) => setCustomToDate(e.target.value)}
                        className="w-full text-xs bg-gray-100 dark:bg-[#111b21] text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-[#00a884]"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => handleMarkAllReadWithRange('custom')}
                    disabled={!customFromDate}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-gray-800 dark:text-gray-200 hover:bg-[#00a884]/10 dark:hover:bg-[#00a884]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-start"
                  >
                    <span>Apply custom range</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 ms-2 shrink-0">
                      {customFromDate
                        ? (customCount === 0 ? t.mark_all_read_none : t.mark_all_read_conversations(customCount))
                        : ''}
                    </span>
                  </button>
                </div>
              </div>
              <div className="px-4 pb-4">
                <button
                  onClick={() => setShowMarkAllReadModal(false)}
                  className="w-full py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {toastMessage && (
        <div className="fixed bottom-6 start-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-[#111b21] dark:bg-[#202c33] text-white text-sm px-4 py-2.5 rounded-lg shadow-xl border border-gray-700/50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <svg className="w-4 h-4 text-[#00a884] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

export default WhatsAppInboxApp;
