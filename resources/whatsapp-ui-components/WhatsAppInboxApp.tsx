import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { ChatWindow } from './ChatWindow';
import { ZernioConversation, ZernioMessage, ConversationFilter, SendMessagePayload } from './types';

// Mock Initial Data for immediate testing & demonstration
const MOCK_CONVERSATIONS: ZernioConversation[] = [
  {
    id: 'conv_101',
    accountId: 'acc_wa_prod_01',
    platform: 'whatsapp',
    participant: {
      id: 'usr_sarah',
      displayName: 'Sarah Connor',
      phoneNumber: '+14155552671',
      isOnline: true,
      avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    },
    lastMessage: {
      id: 'msg_901',
      content: 'Can you confirm the order shipment status for #WH-8891?',
      type: 'text',
      direction: 'inbound',
      createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      status: 'read',
    },
    unreadCount: 2,
    isPinned: true,
    updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
  {
    id: 'conv_102',
    accountId: 'acc_wa_prod_01',
    platform: 'whatsapp',
    participant: {
      id: 'usr_john',
      displayName: 'John Wick',
      phoneNumber: '+14155559821',
      isOnline: false,
      lastSeen: '10:45 AM',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    },
    lastMessage: {
      id: 'msg_902',
      content: 'Here is the signed agreement.',
      type: 'document',
      direction: 'inbound',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      status: 'read',
    },
    unreadCount: 0,
    isPinned: false,
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: 'conv_103',
    accountId: 'acc_wa_prod_01',
    platform: 'whatsapp',
    participant: {
      id: 'grp_product_team',
      displayName: 'Whatsy Product Engineering',
      avatarUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=150',
    },
    lastMessage: {
      id: 'msg_903',
      content: 'Zernio Webhook integration tests passed ✅',
      type: 'text',
      direction: 'outbound',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      status: 'read',
    },
    unreadCount: 0,
    isGroup: true,
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
];

const MOCK_MESSAGES: Record<string, ZernioMessage[]> = {
  conv_101: [
    {
      id: 'm1',
      conversationId: 'conv_101',
      direction: 'outbound',
      type: 'text',
      content: 'Hello Sarah! Welcome to Whatsy. How can our team assist you today?',
      createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      status: 'read',
    },
    {
      id: 'm2',
      conversationId: 'conv_101',
      direction: 'inbound',
      type: 'text',
      content: 'Hi! I placed an order this morning and wanted to check if it has shipped.',
      createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
      status: 'read',
    },
    {
      id: 'm3',
      conversationId: 'conv_101',
      direction: 'outbound',
      type: 'interactive',
      content: 'Please choose your inquiry category below:',
      createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
      status: 'read',
      interactive: {
        body: 'Please choose your inquiry category below:',
        buttons: [
          { id: 'btn_track', title: 'Track Package' },
          { id: 'btn_talk_rep', title: 'Talk to Support Agent' },
        ],
      },
    },
    {
      id: 'm4',
      conversationId: 'conv_101',
      direction: 'inbound',
      type: 'text',
      content: 'Can you confirm the order shipment status for #WH-8891?',
      createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      status: 'read',
    },
  ],
};

export const WhatsAppInboxApp: React.FC = () => {
  const [conversations, setConversations] = useState<ZernioConversation[]>(MOCK_CONVERSATIONS);
  const [activeId, setActiveId] = useState<string>('conv_101');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [messagesMap, setMessagesMap] = useState<Record<string, ZernioMessage[]>>(MOCK_MESSAGES);

  const activeConversation = conversations.find((c) => c.id === activeId) || null;
  const currentMessages = activeId ? messagesMap[activeId] || [] : [];

  // Filter & Search Logic
  const filteredConversations = conversations.filter((c) => {
    const matchesSearch =
      c.participant.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.lastMessage?.content || '').toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (filter === 'unread') return c.unreadCount > 0;
    if (filter === 'groups') return !!c.isGroup;
    return true;
  });

  const handleSendMessage = (payload: Partial<SendMessagePayload>) => {
    if (!activeId) return;

    const newMessage: ZernioMessage = {
      id: `msg_${Date.now()}`,
      conversationId: activeId,
      direction: 'outbound',
      type: payload.attachmentType || 'text',
      content: payload.message || '',
      createdAt: new Date().toISOString(),
      status: 'sent',
      attachments: payload.attachmentUrl
        ? [
            {
              url: payload.attachmentUrl,
              type: payload.attachmentType || 'document',
              name: payload.attachmentName,
            },
          ]
        : undefined,
      replyTo: payload.replyTo
        ? {
            id: payload.replyTo,
            senderName: 'Sarah Connor',
            content: 'Previous query',
          }
        : undefined,
    };

    setMessagesMap((prev) => ({
      ...prev,
      [activeId]: [...(prev[activeId] || []), newMessage],
    }));

    // Update conversation last message
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeId
          ? {
              ...c,
              lastMessage: {
                id: newMessage.id,
                content: newMessage.content,
                type: newMessage.type,
                direction: 'outbound',
                createdAt: newMessage.createdAt,
                status: 'sent',
              },
              updatedAt: newMessage.createdAt,
            }
          : c
      )
    );
  };

  return (
    <div className="w-full h-screen flex bg-[#111b21] overflow-hidden">
      <Sidebar
        conversations={filteredConversations}
        activeConversationId={activeId}
        onSelectConversation={(c) => {
          setActiveId(c.id);
          // mark as read
          setConversations((prev) =>
            prev.map((item) => (item.id === c.id ? { ...item, unreadCount: 0 } : item))
          );
        }}
        activeFilter={filter}
        onFilterChange={setFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />
      <ChatWindow
        conversation={activeConversation}
        messages={currentMessages}
        onSendMessage={handleSendMessage}
      />
    </div>
  );
};

export default WhatsAppInboxApp;
