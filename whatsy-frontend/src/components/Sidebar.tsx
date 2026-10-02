import React, { useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import { ZernioConversation, ConversationFilter } from './types';
import { avatarDataUri } from '../utils/avatar';
import type { ViewerInfo, TypingLock } from '../store/useInboxStore';
import { ConversationRow } from './ConversationRow';
import { BulkActionBar } from './BulkActionBar';
import { useT } from '../i18n/translations';
import { useLanguageStore } from '../store/useLanguageStore';
import { useDarkModeStore } from '../store/useDarkModeStore';
import { useLabelStore } from '../store/useLabelStore';
import { LabelManager } from './LabelManager';
import { searchMessages, MessageSearchResult } from '../api/inbox';

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
  activeLabelId?: string | null;
  onLabelFilterChange?: (labelId: string) => void;
  onLabelFilterClear?: () => void;
  selectionMode?: boolean;
  onToggleSelectionMode?: () => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onBulkAssignLabel?: (labelId: string) => void;
  searchType?: 'all' | 'numbers';
  onSearchTypeChange?: (type: 'all' | 'numbers') => void;
  onSelectMessageResult?: (conversationId: string, messageId: string) => void;
}

/** Wrap matched portions of `text` in <mark> tags, case-insensitive. */
function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const lq = query.toLowerCase();
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const idx = rest.toLowerCase().indexOf(lq);
    if (idx === -1) { parts.push(<span key={key++}>{rest}</span>); break; }
    if (idx > 0) parts.push(<span key={key++}>{rest.slice(0, idx)}</span>);
    parts.push(
      <mark key={key++} className="bg-yellow-300 dark:bg-yellow-500 text-[#111b21] rounded-[2px] px-[1px] not-italic">
        {rest.slice(idx, idx + query.length)}
      </mark>
    );
    rest = rest.slice(idx + query.length);
  }
  return <>{parts}</>;
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
  activeLabelId = null,
  onLabelFilterChange,
  selectionMode = false,
  onToggleSelectionMode,
  selectedIds = new Set(),
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onBulkAssignLabel,
  searchType = 'all',
  onSearchTypeChange,
  onSelectMessageResult,
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
  const [localInput, setLocalInput] = useState(searchQuery);
  const [messageResults, setMessageResults] = useState<MessageSearchResult[]>([]);
  const [isSearchingMessages, setIsSearchingMessages] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Sync external searchQuery changes (e.g. resets)
  useEffect(() => {
    setLocalInput(searchQuery);
  }, [searchQuery]);

  // Debounced search query propagation (250ms) for snappy typing
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localInput !== searchQuery) {
        onSearchChange(localInput);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [localInput, searchQuery, onSearchChange]);

  // Debounced deep message content search when in 'all' mode
  useEffect(() => {
    const q = localInput.trim();
    if (searchType === 'numbers' || q.length < 2) {
      setMessageResults([]);
      setIsSearchingMessages(false);
      return;
    }
    setIsSearchingMessages(true);
    const timer = setTimeout(() => {
      searchMessages(q, undefined, 30)
        .then((res) => setMessageResults(res))
        .catch(() => setMessageResults([]))
        .finally(() => setIsSearchingMessages(false));
    }, 280);
    return () => clearTimeout(timer);
  }, [localInput, searchType]);

  useEffect(() => {
    fetchLabels().catch(() => undefined);
  }, [fetchLabels]);

  useEffect(() => {
    if (!showMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [showMenu]);

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
          <button
            type="button"
            onClick={onToggleSelectionMode}
            title={selectionMode ? 'Cancel selection' : 'Select conversations'}
            className={`p-2 hover:bg-[#e9edef] dark:hover:bg-[#374248] rounded-full transition ${selectionMode ? 'text-[#00a884]' : ''}`}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </button>
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
          <div ref={menuRef} className="absolute end-3 top-12 z-40 w-56 rounded-xl border border-[#e9edef] dark:border-[#374151] bg-white dark:bg-[#202c33] p-1.5 shadow-xl">
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
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-[#e9edef]">{t.sidebar_new_chat_heading}</h2>
              <button type="button" onClick={() => setShowNewChat(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-lg leading-none">×</button>
            </div>
            <div className="relative mb-3">
              <svg className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#54656f] dark:text-[#8696a0] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                autoFocus
                value={newChatSearch}
                onChange={event => setNewChatSearch(event.target.value)}
                placeholder={t.sidebar_search_student_placeholder}
                className="w-full rounded-lg border border-gray-300 dark:border-[#374151] bg-[#f0f2f5] dark:bg-[#111b21] ps-9 pe-3 py-2 text-sm text-gray-900 dark:text-[#e9edef] outline-none focus:ring-2 focus:ring-[#00a884]"
              />
              {newChatSearch && (
                <button type="button" onClick={() => setNewChatSearch('')} className="absolute end-3 top-1/2 -translate-y-1/2 text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef]">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto">
              {contactMatches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-gray-400 dark:text-[#8696a0]">
                  <svg className="w-8 h-8 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <p className="text-sm">{t.sidebar_no_contacts}</p>
                </div>
              ) : (
                contactMatches.map(conversation => {
                  const q = newChatSearch.trim();
                  const phone = conversation.participant.phoneNumber || t.sidebar_wa_contact;
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => { onSelectConversation(conversation); setShowNewChat(false); }}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition"
                    >
                      <img
                        src={conversation.participant.avatarUrl || avatarDataUri(conversation.participant.displayName)}
                        alt=""
                        className="h-9 w-9 rounded-full shrink-0"
                        onError={e => { (e.target as HTMLImageElement).src = avatarDataUri(conversation.participant.displayName); }}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900 dark:text-[#e9edef] truncate">
                          {highlightMatch(conversation.participant.displayName, q)}
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-[#8696a0] truncate">
                          {highlightMatch(phone, q)}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="p-2 bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#222e35]">
        <div className={`relative flex items-center bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg px-3 py-1.5 transition-all ${isSearchFocused ? 'ring-1 ring-[#00a884]' : ''}`}>
          <svg
            className={`w-4 h-4 me-2 transition-colors shrink-0 ${isSearchFocused ? 'text-[#00a884]' : 'text-[#54656f] dark:text-[#8696a0]'}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>

          {searchType === 'numbers' && (
            <span className="inline-flex items-center gap-1 bg-[#00a884] text-white text-[11px] font-medium px-2 py-0.5 rounded me-1.5 shrink-0 select-none">
              <span>#</span>
              <span>{t.filter_numbers_only}</span>
              <button
                type="button"
                onClick={() => onSearchTypeChange?.('all')}
                className="hover:opacity-75 ms-0.5 leading-none"
                title="Clear"
              >
                ×
              </button>
            </span>
          )}

          <input
            ref={searchInputRef}
            type="text"
            value={localInput}
            onChange={(e) => setLocalInput(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            placeholder={searchType === 'numbers' ? `${t.filter_numbers_only}...` : t.sidebar_search_placeholder}
            className="w-full bg-transparent text-[#111b21] dark:text-[#e9edef] text-sm placeholder-[#54656f] dark:placeholder-[#8696a0] outline-none"
          />

          {isSearchingMessages && (
            <div className="w-3.5 h-3.5 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin shrink-0 me-1" />
          )}

          {localInput && (
            <button
              type="button"
              onClick={() => {
                setLocalInput('');
                onSearchChange('');
                setMessageResults([]);
              }}
              className="text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] ms-1 p-0.5 rounded-full"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}

          {/* Quick toggle for Numbers only */}
          <button
            type="button"
            onClick={() => onSearchTypeChange?.(searchType === 'numbers' ? 'all' : 'numbers')}
            className={`p-1 ms-1 rounded transition-colors ${
              searchType === 'numbers'
                ? 'text-[#00a884]'
                : 'text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef]'
            }`}
            title={t.filter_numbers_only}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Unified filter chip row — Numbers only / All / Unread / Mine + label chips */}
      <div className="flex gap-1.5 overflow-x-auto px-3 pb-2 pt-1.5 scrollbar-hide shrink-0 border-b border-[#e9edef] dark:border-[#222e35] bg-white dark:bg-[#111b21]">
        {/* Numbers only filter chip */}
        <button
          type="button"
          onClick={() => onSearchTypeChange?.(searchType === 'numbers' ? 'all' : 'numbers')}
          className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 ${
            searchType === 'numbers'
              ? 'bg-[#00a884] text-white shadow-sm ring-1 ring-[#00a884]'
              : 'bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]'
          }`}
          title={t.filter_numbers_only}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          <span>{t.filter_numbers_only}</span>
        </button>

        {/* Static filter chips */}
        {(['all', 'unread', 'unanswered', 'assigned_to_me'] as ConversationFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition shrink-0 ${
              activeFilter === f && !activeLabelId && searchType !== 'numbers'
                ? 'bg-[#00a884] text-white'
                : 'bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]'
            }`}
          >
            {f === 'all' ? t.filter_all : f === 'unread' ? t.filter_unread : f === 'unanswered' ? t.filter_unanswered : t.filter_mine}
          </button>
        ))}

        {/* Label chips */}
        {labels.map((label) => (
          <button
            key={label.id}
            onClick={() => onLabelFilterChange?.(label.id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition shrink-0 ${
              activeLabelId === label.id
                ? 'text-white'
                : 'bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]'
            }`}
            style={activeLabelId === label.id ? { backgroundColor: label.color } : {}}
            title={`${label.name}${labelCounts[label.name] ? ` (${labelCounts[label.name]})` : ''}`}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: activeLabelId === label.id ? 'rgba(255,255,255,0.7)' : label.color }}
            />
            {label.name}
          </button>
        ))}

        {/* Manage labels gear button */}
        {labels.length > 0 && (
          <button
            type="button"
            onClick={() => setShowLabelManager(true)}
            className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition shrink-0 bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]"
            title="Manage labels"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>

      {/* Bulk action bar — shown when selection mode is active */}
      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
          onBulkAssignLabel={onBulkAssignLabel}
        />
      )}

      {/* Conversations and Messages List */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto divide-y divide-[#e9edef]/60 dark:divide-[#202c33]/40">
        {conversations.length === 0 && messageResults.length === 0 && !isSearchingMessages ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-[#8696a0] text-sm p-4 text-center">
            <svg className="w-10 h-10 mb-2 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {localInput ? t.search_no_results : (activeLabelId ? 'No conversations with this label' : t.sidebar_no_conversations)}
          </div>
        ) : (
          <>
            {/* Chats Section Header when search returned both chats and messages */}
            {localInput.trim().length >= 2 && searchType !== 'numbers' && conversations.length > 0 && messageResults.length > 0 && (
              <div className="px-3 py-1.5 text-xs font-semibold text-[#00a884] uppercase tracking-wider bg-gray-50/90 dark:bg-[#182229]/90 sticky top-0 z-10 border-b border-[#e9edef]/50 dark:border-[#222e35]/50">
                {t.search_chats_section} ({conversations.length})
              </div>
            )}

            {/* Conversation Rows */}
            {conversations.map((conv) => (
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
                selectionMode={selectionMode}
                isChecked={selectedIds.has(conv.id)}
                onToggleSelect={onToggleSelect}
                searchQuery={localInput}
              />
            ))}

            {/* Messages Section when searching across chats */}
            {localInput.trim().length >= 2 && searchType !== 'numbers' && messageResults.length > 0 && (
              <div className="flex flex-col">
                <div className="px-3 py-1.5 text-xs font-semibold text-[#00a884] uppercase tracking-wider bg-gray-50/90 dark:bg-[#182229]/90 sticky top-0 z-10 border-t border-b border-[#e9edef]/60 dark:border-[#222e35]/60">
                  {t.search_messages_section} ({messageResults.length})
                </div>
                {messageResults.map((msg) => (
                  <button
                    key={msg.id}
                    type="button"
                    onClick={() => onSelectMessageResult?.(msg.conversationId, msg.id)}
                    className="w-full text-start px-3 py-2.5 hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] active:bg-[#e9edef] dark:active:bg-[#2a3942] transition flex flex-col gap-1 border-b border-[#e9edef]/40 dark:border-[#222e35]/40 cursor-pointer group"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-gray-900 dark:text-[#e9edef] truncate">
                        {highlightMatch(msg.studentName || msg.studentPhone || 'Contact', localInput)}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-[#8696a0] shrink-0">
                        {new Date(msg.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-[#8696a0] line-clamp-2 leading-relaxed group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                      {highlightMatch(msg.content, localInput)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </>
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

