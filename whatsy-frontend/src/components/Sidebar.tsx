import React, { useState, useRef, useCallback } from 'react';
import { ZernioConversation, ConversationFilter } from './types';
import type { ViewerInfo, TypingLock } from '../store/useInboxStore';
import { ConversationRow } from './ConversationRow';

interface SidebarProps {
  conversations: ZernioConversation[];
  activeConversationId?: string;
  onSelectConversation: (conversation: ZernioConversation) => void;
  activeFilter: ConversationFilter;
  onFilterChange: (filter: ConversationFilter) => void;
  onSearchChange: (query: string) => void;
  searchQuery: string;
  viewers?: Record<string, ViewerInfo[]>;
  typingLocks?: Record<string, TypingLock | null>;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onRefresh?: () => void;
  onMarkAllRead?: () => void;
  onMarkUnread?: (conversationId: string) => void;
  onMarkRead?: (conversationId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  activeFilter,
  onFilterChange,
  onSearchChange,
  searchQuery,
  viewers = {},
  typingLocks = {},
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  onRefresh,
  onMarkAllRead,
  onMarkUnread,
  onMarkRead,
}) => {
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [newChatSearch, setNewChatSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const contactMatches = conversations.filter((conversation) => {
    const query = newChatSearch.trim().toLowerCase();
    if (!query) return true;
    return conversation.participant.displayName.toLowerCase().includes(query)
      || conversation.participant.phoneNumber?.toLowerCase().includes(query);
  }).slice(0, 8);

  const openNewChat = () => {
    setShowMenu(false);
    setNewChatSearch('');
    setShowNewChat(true);
  };

  const handleScroll = useCallback(() => {
    if (!onLoadMore || !hasMore || isLoadingMore) return;
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      onLoadMore();
    }
  }, [onLoadMore, hasMore, isLoadingMore]);

  const filters: { id: ConversationFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'unanswered', label: 'Unanswered' },
    { id: 'assigned_to_me', label: 'Mine' },
  ];

  return (
    <aside data-testid="sidebar" className="w-full md:w-[380px] lg:w-[420px] h-full flex flex-col bg-white dark:bg-[#111b21] border-r border-[#e9edef] dark:border-[#222e35] select-none">
      {/* Header */}
      <header className="relative h-[60px] bg-[#f0f2f5] dark:bg-[#202c33] px-4 flex items-center justify-between shrink-0 border-b border-[#e9edef] dark:border-[#222e35]">
        <span className="font-semibold text-base text-[#111b21] dark:text-[#e9edef] tracking-tight">Chats</span>

        <div className="flex items-center gap-1 text-[#54656f] dark:text-[#aebac1]">
          <button type="button" onClick={openNewChat} className="p-2 hover:bg-[#e9edef] dark:hover:bg-[#374248] rounded-full transition" title="New Chat">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              <line x1="12" y1="8" x2="12" y2="14" />
              <line x1="9" y1="11" x2="15" y2="11" />
            </svg>
          </button>
          <button type="button" onClick={() => setShowMenu(v => !v)} className="p-2 hover:bg-[#e9edef] dark:hover:bg-[#374248] rounded-full transition" title="Menu">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="6" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="18" r="1.5" />
            </svg>
          </button>
        </div>

        {showMenu && (
          <div className="absolute right-3 top-12 z-40 w-56 rounded-xl border border-[#e9edef] dark:border-[#374151] bg-white dark:bg-[#202c33] p-1.5 shadow-xl">
            <button type="button" onClick={() => { onRefresh?.(); setShowMenu(false) }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">Refresh conversations</button>
            <button type="button" onClick={() => { onMarkAllRead?.(); setShowMenu(false) }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">Mark all as read</button>
            <button type="button" onClick={() => { window.location.assign('/settings') }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">Open inbox settings</button>
            <div className="my-1 border-t border-[#e9edef] dark:border-[#374151]" />
            <p className="px-3 py-2 text-xs text-gray-400 dark:text-[#8696a0]">Export and archived chats are not available yet.</p>
          </div>
        )}
      </header>

      {showNewChat && (
        <div className="absolute inset-0 z-30 flex items-start justify-center bg-black/20 p-4 pt-20" onClick={() => setShowNewChat(false)}>
          <div className="w-full max-w-sm rounded-xl border border-[#e9edef] dark:border-[#374151] bg-white dark:bg-[#202c33] p-4 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-gray-900 dark:text-[#e9edef]">New chat</h2><button type="button" onClick={() => setShowNewChat(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white">×</button></div>
            <input autoFocus value={newChatSearch} onChange={event => setNewChatSearch(event.target.value)} placeholder="Search a student or phone" className="mb-3 w-full rounded-lg border border-gray-300 dark:border-[#374151] bg-[#f0f2f5] dark:bg-[#111b21] px-3 py-2 text-sm text-gray-900 dark:text-[#e9edef] outline-none focus:ring-2 focus:ring-[#00a884]" />
            <div className="max-h-72 overflow-y-auto">
              {contactMatches.length === 0 ? <p className="py-6 text-center text-sm text-gray-500 dark:text-[#8696a0]">No contacts found in your conversations.</p> : contactMatches.map(conversation => (
                <button key={conversation.id} type="button" onClick={() => { onSelectConversation(conversation); setShowNewChat(false) }} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">
                  <img src={conversation.participant.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(conversation.participant.displayName)}&background=e5e7eb&color=374151`} alt="" className="h-9 w-9 rounded-full" />
                  <span><span className="block text-sm font-medium text-gray-900 dark:text-[#e9edef]">{conversation.participant.displayName}</span><span className="block text-xs text-gray-500 dark:text-[#8696a0]">{conversation.participant.phoneNumber || 'WhatsApp contact'}</span></span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="p-2 bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#222e35]">
        <div className={`relative flex items-center bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg px-3 py-1.5 transition-all ${isSearchFocused ? 'ring-1 ring-[#00a884]' : ''}`}>
          <svg
            className={`w-4 h-4 mr-3 transition-colors ${isSearchFocused ? 'text-[#00a884]' : 'text-[#54656f] dark:text-[#8696a0]'}`}
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
            className="w-full bg-transparent text-[#111b21] dark:text-[#e9edef] text-sm placeholder-[#54656f] dark:placeholder-[#8696a0] outline-none"
          />
          {searchQuery && (
            <button type="button" onClick={() => onSearchChange('')} className="text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] ml-1">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Filter Pills */}
      <div className="px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto border-b border-[#e9edef] dark:border-[#222e35] scrollbar-none bg-white dark:bg-[#111b21]">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilterChange(f.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition shrink-0 ${
              activeFilter === f.id
                ? 'bg-[#d9fdd3] text-[#008069] dark:bg-[#005c4b] dark:text-[#e9edef]'
                : 'bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942] hover:text-[#111b21] dark:hover:text-[#e9edef]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Conversations List */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto divide-y divide-[#e9edef]/60 dark:divide-[#202c33]/40">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-[#8696a0] text-sm p-4 text-center">
            <svg className="w-10 h-10 mb-2 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            No conversations found
          </div>
        ) : (
          conversations.map((conv) => (
            <ConversationRow
              key={conv.id}
              conversation={conv}
              isSelected={conv.id === activeConversationId}
              viewers={viewers[conv.id]}
              typingLock={typingLocks[conv.id]}
              onSelect={() => onSelectConversation(conv)}
              onMarkUnread={onMarkUnread}
              onMarkRead={onMarkRead}
            />
          ))
        )}
        {isLoadingMore && (
          <div className="flex items-center justify-center py-3">
            <svg className="animate-spin h-5 w-5 text-[#00a884]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        )}
      </div>
    </aside>
  );
};
