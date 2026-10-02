import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { ZernioMessage } from './types';
import { searchMessages, MessageSearchResult } from '../api/inbox';
import { useT } from '../i18n/translations';

interface ChatSearchDrawerProps {
  conversationId: string;
  contactName: string;
  messages: ZernioMessage[];
  onClose: () => void;
  onNavigateToMessage: (messageId: string) => void;
  onQueryChange?: (query: string) => void;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query || !query.trim()) return text;
  const lq = query.trim().toLowerCase();
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const idx = rest.toLowerCase().indexOf(lq);
    if (idx === -1) {
      parts.push(<span key={key++}>{rest}</span>);
      break;
    }
    if (idx > 0) parts.push(<span key={key++}>{rest.slice(0, idx)}</span>);
    parts.push(
      <mark
        key={key++}
        className="bg-yellow-300 dark:bg-yellow-500 text-[#111b21] rounded-[2px] px-[1px] not-italic"
      >
        {rest.slice(idx, idx + query.length)}
      </mark>
    );
    rest = rest.slice(idx + query.length);
  }
  return <>{parts}</>;
}

function formatResultDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();
    if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();
    if (isYesterday) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  } catch {
    return '';
  }
}

export const ChatSearchDrawer: React.FC<ChatSearchDrawerProps> = ({
  conversationId,
  contactName,
  messages,
  onClose,
  onNavigateToMessage,
  onQueryChange,
}) => {
  const t = useT();
  const [query, setQuery] = useState('');
  const [serverResults, setServerResults] = useState<MessageSearchResult[]>([]);
  const [isSearchingServer, setIsSearchingServer] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    onQueryChange?.(query);
  }, [query, onQueryChange]);

  // 1. Instant client-side matches from loaded messages
  const clientMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter((m) => m.content && m.content.toLowerCase().includes(q))
      .map((m) => ({
        id: m.id,
        conversationId,
        content: m.content || '',
        direction: m.direction,
        timestamp: m.createdAt,
      }));
  }, [messages, query, conversationId]);

  // 2. Debounced server-side search across historical messages
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setServerResults([]);
      setIsSearchingServer(false);
      return;
    }

    setIsSearchingServer(true);
    const timer = setTimeout(() => {
      searchMessages(q, conversationId, 50)
        .then((res) => {
          setServerResults(res);
        })
        .catch(() => setServerResults([]))
        .finally(() => setIsSearchingServer(false));
    }, 280);

    return () => clearTimeout(timer);
  }, [query, conversationId]);

  // 3. Merged and deduplicated matches, newest first
  const mergedResults = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{
      id: string;
      content: string;
      direction: 'inbound' | 'outbound';
      timestamp: string;
    }> = [];

    // Client matches first
    for (const cm of clientMatches) {
      if (!seen.has(cm.id)) {
        seen.add(cm.id);
        list.push(cm);
      }
    }

    // Add server matches not yet present
    for (const sm of serverResults) {
      if (!seen.has(sm.id)) {
        seen.add(sm.id);
        list.push({
          id: sm.id,
          content: sm.content,
          direction: sm.direction,
          timestamp: typeof sm.timestamp === 'string' ? sm.timestamp : new Date().toISOString(),
        });
      }
    }

    // Sort newest first
    return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [clientMatches, serverResults]);

  return (
    <div className="w-80 sm:w-96 max-sm:absolute max-sm:inset-0 max-sm:z-40 border-s border-[#e9edef] dark:border-[#222e35] bg-white dark:bg-[#111b21] flex flex-col shrink-0 h-full shadow-lg animate-in slide-in-from-right duration-200 z-20">
      {/* Drawer Header */}
      <div className="h-[60px] px-4 bg-[#f0f2f5] dark:bg-[#202c33] flex items-center gap-3 border-b border-[#e9edef] dark:border-[#222e35] shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-[#374248] text-[#54656f] dark:text-[#aebac1] transition"
          title={t.cancel}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <h3 className="font-semibold text-sm text-[#111b21] dark:text-[#e9edef]">
          {t.search_in_chat}
        </h3>
      </div>

      {/* Search Input Box */}
      <div className="p-3 border-b border-[#e9edef] dark:border-[#222e35] bg-white dark:bg-[#111b21]">
        <div className="relative flex items-center bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg px-3 py-1.5 ring-1 ring-transparent focus-within:ring-[#00a884] transition-all">
          <svg className="w-4 h-4 text-[#54656f] dark:text-[#8696a0] me-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search_in_chat}
            className="w-full bg-transparent text-[#111b21] dark:text-[#e9edef] text-sm placeholder-[#54656f] dark:placeholder-[#8696a0] outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] ms-1 p-0.5 rounded-full"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
          {isSearchingServer && (
            <div className="w-3.5 h-3.5 ms-1 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin shrink-0" />
          )}
        </div>
      </div>

      {/* Results Header / Summary */}
      {query.trim().length >= 2 && (
        <div className="px-4 py-2 text-xs font-semibold text-[#54656f] dark:text-[#8696a0] bg-gray-50/70 dark:bg-[#182229]/70 border-b border-[#e9edef]/60 dark:border-[#222e35]/60 flex items-center justify-between shrink-0">
          <span>
            {mergedResults.length === 0
              ? t.search_no_results
              : `${mergedResults.length} ${t.search_messages_section}`}
          </span>
        </div>
      )}

      {/* Results List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#e9edef]/60 dark:divide-[#222e35]/60">
        {!query.trim() ? (
          <div className="flex flex-col items-center justify-center h-64 text-center px-6 text-gray-400 dark:text-[#8696a0]">
            <svg className="w-12 h-12 mb-3 opacity-30 text-[#00a884]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p className="text-sm font-medium text-gray-700 dark:text-[#d1d7db] mb-1">
              {t.search_in_chat}
            </p>
            <p className="text-xs opacity-75">
              Search for messages with <span className="font-semibold">{contactName}</span>
            </p>
          </div>
        ) : mergedResults.length === 0 && !isSearchingServer ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4 text-gray-400 dark:text-[#8696a0]">
            <p className="text-sm">{t.search_no_results}</p>
          </div>
        ) : (
          mergedResults.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigateToMessage(item.id)}
              className="w-full text-start px-4 py-3 hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] active:bg-[#e9edef] dark:active:bg-[#2a3942] transition flex flex-col gap-1 cursor-pointer group"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] font-medium text-[#00a884]">
                  {formatResultDate(item.timestamp)}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-[#8696a0] opacity-80">
                  {item.direction === 'outbound' ? 'Sent' : 'Received'}
                </span>
              </div>
              <p className="text-xs text-gray-700 dark:text-[#d1d7db] line-clamp-2 leading-relaxed group-hover:text-black dark:group-hover:text-white transition-colors">
                {highlightMatch(item.content, query)}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
