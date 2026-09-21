import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ZernioConversation, ConversationFilter } from './types';
import type { ViewerInfo, TypingLock } from '../store/useInboxStore';
import { ConversationRow } from './ConversationRow';
import { useT } from '../i18n/translations';
import { useLanguageStore } from '../store/useLanguageStore';
import { useDarkModeStore } from '../store/useDarkModeStore';
import { useLabelStore } from '../store/useLabelStore';
import { LabelManager } from './LabelManager'
import { isLightColor } from '../utils/colorUtils';

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
  onTagsChange?: (conversationId: string, tags: string[]) => void;
  activeLabelIds?: string[];
  onLabelFilterChange?: (labelId: string) => void;
  onLabelFilterClear?: () => void;
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
  onTagsChange,
  activeLabelIds = [],
  onLabelFilterChange,
  onLabelFilterClear,
}) => {
  const t = useT();
  const { lang, setLang } = useLanguageStore();
  const { dark, toggle: toggleDark } = useDarkModeStore();
  const { labels, fetch: fetchLabels } = useLabelStore();
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLabelManager, setShowLabelManager] = useState(false);
  const [newChatSearch, setNewChatSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLabels().catch(() => undefined);
  }, [fetchLabels]);

  const labelCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    conversations.forEach((c) => {
      (c.tags ?? []).forEach((name) => {
        counts[name] = (counts[name] ?? 0) + 1;
      });
    });
    return counts;
  }, [conversations]);

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
    { id: 'all', label: t.filter_all },
    { id: 'unread', label: t.filter_unread },
    { id: 'unanswered', label: t.filter_unanswered },
    { id: 'assigned_to_me', label: t.filter_mine },
  ];

  return (
    <>
    <aside data-testid="sidebar" className="w-full md:w-[380px] lg:w-[420px] h-full flex flex-col bg-white dark:bg-[#111b21] border-r border-[#e9edef] dark:border-[#222e35] select-none">
      {/* Header */}
      <header className="relative h-[60px] bg-[#f0f2f5] dark:bg-[#202c33] px-4 flex items-center justify-between shrink-0 border-b border-[#e9edef] dark:border-[#222e35]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-base text-[#111b21] dark:text-[#e9edef] tracking-tight">{t.sidebar_chats}</span>
          {/* Dark/Light + Language toggles — mobile only */}
          <div className="flex items-center gap-1 md:hidden">
            <button
              type="button"
              onClick={toggleDark}
              title={dark ? 'Light mode' : 'Dark mode'}
              className="p-1.5 rounded-full hover:bg-[#e9edef] dark:hover:bg-[#374248] text-[#54656f] dark:text-[#aebac1] transition"
            >
              {dark ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              title={lang === 'en' ? 'Switch to Arabic' : 'Switch to English'}
              className="px-2 py-0.5 rounded-full text-[10px] font-bold hover:bg-[#e9edef] dark:hover:bg-[#374248] text-[#54656f] dark:text-[#aebac1] transition border border-[#d1d7db] dark:border-[#374248]"
            >
              {lang === 'en' ? 'ع' : 'EN'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[#54656f] dark:text-[#aebac1]">
          {conversations.some(c => c.unreadCount > 0 || c.isMarkedUnread) && (
            <button
              type="button"
              onClick={() => onMarkAllRead?.()}
              title={t.sidebar_mark_all_read_title}
              className="p-2 hover:bg-[#e9edef] dark:hover:bg-[#374248] rounded-full transition"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12l4 4 8-9" />
                <path d="M7 12l4 4 8-9" />
              </svg>
            </button>
          )}
          <button type="button" onClick={openNewChat} className="p-2 hover:bg-[#e9edef] dark:hover:bg-[#374248] rounded-full transition" title={t.sidebar_new_chat_title}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              <line x1="12" y1="8" x2="12" y2="14" />
              <line x1="9" y1="11" x2="15" y2="11" />
            </svg>
          </button>
          <button type="button" onClick={() => setShowMenu(v => !v)} className="p-2 hover:bg-[#e9edef] dark:hover:bg-[#374248] rounded-full transition" title={t.sidebar_menu_title}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="6" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="18" r="1.5" />
            </svg>
          </button>
        </div>

        {showMenu && (
          <div className="absolute end-3 top-12 z-40 w-56 rounded-xl border border-[#e9edef] dark:border-[#374151] bg-white dark:bg-[#202c33] p-1.5 shadow-xl">
            <button type="button" onClick={() => { onRefresh?.(); setShowMenu(false) }} className="w-full rounded-lg px-3 py-2 text-start text-sm text-gray-700 dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">{t.sidebar_refresh}</button>
            <button type="button" onClick={() => { onMarkAllRead?.(); setShowMenu(false) }} className="w-full rounded-lg px-3 py-2 text-start text-sm text-gray-700 dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">{t.sidebar_mark_all_read}</button>
            <button type="button" onClick={() => { window.location.assign('/settings') }} className="w-full rounded-lg px-3 py-2 text-start text-sm text-gray-700 dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">{t.sidebar_open_settings}</button>
            <button type="button" onClick={() => { setShowLabelManager(true); setShowMenu(false) }} className="w-full rounded-lg px-3 py-2 text-start text-sm text-gray-700 dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">Manage labels</button>
            <div className="my-1 border-t border-[#e9edef] dark:border-[#374151]" />
            <p className="px-3 py-2 text-xs text-gray-400 dark:text-[#8696a0]">{t.sidebar_export_unavailable}</p>
          </div>
        )}
      </header>

      {showNewChat && (
        <div className="absolute inset-0 z-30 flex items-start justify-center bg-black/20 p-4 pt-20" onClick={() => setShowNewChat(false)}>
          <div className="w-full max-w-sm rounded-xl border border-[#e9edef] dark:border-[#374151] bg-white dark:bg-[#202c33] p-4 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-gray-900 dark:text-[#e9edef]">{t.sidebar_new_chat_heading}</h2><button type="button" onClick={() => setShowNewChat(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white">×</button></div>
            <input autoFocus value={newChatSearch} onChange={event => setNewChatSearch(event.target.value)} placeholder={t.sidebar_search_student_placeholder} className="mb-3 w-full rounded-lg border border-gray-300 dark:border-[#374151] bg-[#f0f2f5] dark:bg-[#111b21] px-3 py-2 text-sm text-gray-900 dark:text-[#e9edef] outline-none focus:ring-2 focus:ring-[#00a884]" />
            <div className="max-h-72 overflow-y-auto">
              {contactMatches.length === 0 ? <p className="py-6 text-center text-sm text-gray-500 dark:text-[#8696a0]">{t.sidebar_no_contacts}</p> : contactMatches.map(conversation => (
                <button key={conversation.id} type="button" onClick={() => { onSelectConversation(conversation); setShowNewChat(false) }} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">
                  <img src={conversation.participant.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(conversation.participant.displayName)}&background=e5e7eb&color=374151`} alt="" className="h-9 w-9 rounded-full" />
                  <span><span className="block text-sm font-medium text-gray-900 dark:text-[#e9edef]">{conversation.participant.displayName}</span><span className="block text-xs text-gray-500 dark:text-[#8696a0]">{conversation.participant.phoneNumber || t.sidebar_wa_contact}</span></span>
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
            className={`w-4 h-4 me-3 transition-colors ${isSearchFocused ? 'text-[#00a884]' : 'text-[#54656f] dark:text-[#8696a0]'}`}
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
            placeholder={t.sidebar_search_placeholder}
            className="w-full bg-transparent text-[#111b21] dark:text-[#e9edef] text-sm placeholder-[#54656f] dark:placeholder-[#8696a0] outline-none"
          />
          {searchQuery && (
            <button type="button" onClick={() => onSearchChange('')} className="text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] ms-1">
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

      {/* Label Filter — shown only when labels exist */}
      {labels.length > 0 && (
        <div className="px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto border-b border-[#e9edef] dark:border-[#222e35] scrollbar-none bg-white dark:bg-[#111b21]">
          <button
            type="button"
            onClick={() => onLabelFilterClear?.()}
            className={`px-3 py-1 rounded-full text-xs font-medium transition shrink-0 flex items-center gap-1 ${
              activeLabelIds.length === 0
                ? 'bg-[#d9fdd3] text-[#008069] dark:bg-[#005c4b] dark:text-[#e9edef]'
                : 'bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]'
            }`}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            Labels
          </button>
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              onClick={() => onLabelFilterChange?.(label.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition shrink-0 ${
                activeLabelIds.includes(label.id)
                  ? 'ring-2 ring-offset-1 ring-[#00a884]'
                  : 'opacity-80 hover:opacity-100'
              }`}
              style={{ backgroundColor: label.color, color: isLightColor(label.color) ? '#1a1a1a' : '#fff' }}
              title={`${label.name}${labelCounts[label.name] ? ` (${labelCounts[label.name]})` : ''}`}
            >
              {label.name}{labelCounts[label.name] ? ` · ${labelCounts[label.name]}` : ''}
            </button>
          ))}
        </div>
      )}

      {/* Conversations List */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto divide-y divide-[#e9edef]/60 dark:divide-[#202c33]/40">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-[#8696a0] text-sm p-4 text-center">
            <svg className="w-10 h-10 mb-2 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {t.sidebar_no_conversations}
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
              onTagsChange={onTagsChange}
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

    {/* Label manager modal */}
    {showLabelManager && <LabelManager onClose={() => setShowLabelManager(false)} />}
  </>
  );
};

