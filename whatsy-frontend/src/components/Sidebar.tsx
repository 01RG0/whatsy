import React, { useState, useRef } from 'react';
import { ZernioConversation, ConversationFilter } from './types';

interface SidebarProps {
  conversations: ZernioConversation[];
  activeConversationId?: string;
  onSelectConversation: (conversation: ZernioConversation) => void;
  activeFilter: ConversationFilter;
  onFilterChange: (filter: ConversationFilter) => void;
  onSearchChange: (query: string) => void;
  searchQuery: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  activeFilter,
  onFilterChange,
  onSearchChange,
  searchQuery,
}) => {
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filters: { id: ConversationFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'groups', label: 'Groups' },
    { id: 'assigned_to_me', label: 'Assigned' },
  ];

  const formatLastMessageTime = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();
      if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <aside data-testid="sidebar" className="w-full md:w-[380px] lg:w-[420px] h-full flex flex-col bg-white dark:bg-[#111b21] border-r border-gray-200 dark:border-[#222e35] select-none">
      {/* Header */}
      <header className="h-[60px] bg-gray-100 dark:bg-[#202c33] px-4 flex items-center justify-between shrink-0">
        <span className="font-semibold text-base text-gray-900 dark:text-[#e9edef] tracking-tight">Chats</span>

        <div className="flex items-center gap-1 text-gray-500 dark:text-[#aebac1]">
          <button type="button" className="p-2 hover:bg-gray-200 dark:hover:bg-[#374248] rounded-full transition" title="Channels">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </button>
          <button type="button" className="p-2 hover:bg-gray-200 dark:hover:bg-[#374248] rounded-full transition" title="New Chat">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              <line x1="12" y1="8" x2="12" y2="14" />
              <line x1="9" y1="11" x2="15" y2="11" />
            </svg>
          </button>
          <button type="button" className="p-2 hover:bg-gray-200 dark:hover:bg-[#374248] rounded-full transition" title="Menu">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="6" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="18" r="1.5" />
            </svg>
          </button>
        </div>
      </header>

      {/* Search */}
      <div className="p-2 bg-gray-50 dark:bg-[#111b21]">
        <div className={`relative flex items-center bg-gray-200 dark:bg-[#202c33] rounded-lg px-3 py-1.5 transition-all ${isSearchFocused ? 'ring-1 ring-[#00a884]' : ''}`}>
          <svg
            className={`w-4 h-4 mr-3 transition-colors ${isSearchFocused ? 'text-[#00a884]' : 'text-gray-400 dark:text-[#8696a0]'}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            placeholder="Search or start a new chat"
            className="w-full bg-transparent text-gray-900 dark:text-[#e9edef] text-sm placeholder-gray-400 dark:placeholder-[#8696a0] outline-none"
          />
          {searchQuery && (
            <button type="button" onClick={() => onSearchChange('')} className="text-gray-400 dark:text-[#8696a0] hover:text-gray-700 dark:hover:text-[#e9edef] ml-1">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Filter Pills */}
      <div className="px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto border-b border-gray-200 dark:border-[#222e35] scrollbar-none">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilterChange(f.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition shrink-0 ${
              activeFilter === f.id
                ? 'bg-[#00a884] text-white'
                : 'bg-gray-200 dark:bg-[#202c33] text-gray-600 dark:text-[#8696a0] hover:bg-gray-300 dark:hover:bg-[#2a3942] hover:text-gray-900 dark:hover:text-[#e9edef]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-[#202c33]/40">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-[#8696a0] text-sm p-4 text-center">
            <svg className="w-10 h-10 mb-2 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            No conversations found
          </div>
        ) : (
          conversations.map((conv) => {
            const isSelected = conv.id === activeConversationId;
            return (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv)}
                className={`flex items-center gap-3 px-3 py-3 cursor-pointer transition relative ${
                  isSelected
                    ? 'bg-green-50 dark:bg-[#2a3942]'
                    : 'hover:bg-gray-100 dark:hover:bg-[#202c33]/70'
                }`}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <img
                    src={
                      conv.participant.avatarUrl ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(conv.participant.displayName)}&background=e5e7eb&color=374151`
                    }
                    alt={conv.participant.displayName}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                  {conv.participant.isOnline && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full ring-2 ring-white dark:ring-[#111b21]" />
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <h3 className="font-medium text-sm text-gray-900 dark:text-[#e9edef] truncate">
                      {conv.participant.displayName}
                    </h3>
                    <span className={`text-[11px] shrink-0 ml-2 ${conv.unreadCount > 0 ? 'text-[#00a884] font-semibold' : 'text-gray-400 dark:text-[#8696a0]'}`}>
                      {formatLastMessageTime(conv.lastMessage?.createdAt || conv.updatedAt)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500 dark:text-[#8696a0] truncate pr-2">
                      {conv.lastMessage?.direction === 'outbound' && (
                        <span className="mr-1 text-gray-400">You:</span>
                      )}
                      {conv.lastMessage ? (
                        conv.lastMessage.type === 'image' ? '📷 Photo'
                        : conv.lastMessage.type === 'video' ? '🎥 Video'
                        : conv.lastMessage.type === 'audio' ? '🎵 Audio'
                        : conv.lastMessage.type === 'voice_note' ? '🎤 Voice message'
                        : conv.lastMessage.type === 'document' ? '📄 Document'
                        : conv.lastMessage.type === 'location' ? '📍 Location'
                        : conv.lastMessage.type === 'contacts' ? '👤 Contact'
                        : conv.lastMessage.content === '[Unsupported message]' ? '⚠️ Unsupported message'
                        : conv.lastMessage.content
                      ) : (
                        'No messages yet'
                      )}
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      {conv.isPinned && (
                        <svg className="w-3.5 h-3.5 text-gray-400 dark:text-[#8696a0]" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>
                        </svg>
                      )}
                      {conv.unreadCount > 0 && (
                        <span className="bg-[#00a884] text-white font-bold text-[11px] min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
