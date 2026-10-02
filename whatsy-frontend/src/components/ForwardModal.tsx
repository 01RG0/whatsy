import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { ZernioMessage, Conversation } from './types';
import { avatarDataUri } from '../utils/avatar';
import { useT } from '../i18n/translations';
import { useLanguageStore } from '../store/useLanguageStore';

export interface ForwardModalProps {
  isOpen: boolean;
  message: ZernioMessage | null;
  conversations: Conversation[];
  onClose: () => void;
  onForward: (targetConversationIds: string[], message: ZernioMessage) => Promise<void>;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({
  isOpen,
  message,
  conversations,
  onClose,
  onForward,
}) => {
  const t = useT();
  const { lang } = useLanguageStore();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset state when modal opens or closes
  useEffect(() => {
    if (isOpen) {
      setSelectedIds([]);
      setSearchQuery('');
      setDebouncedQuery('');
      setIsSending(false);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSending) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSending, onClose]);

  // Filter conversations by name, phone number, and group subject
  const filteredConversations = useMemo(() => {
    if (!debouncedQuery.trim()) return conversations;
    const q = debouncedQuery.toLowerCase().trim();
    return conversations.filter((c) => {
      const name = (c.participant?.displayName || '').toLowerCase();
      const phone = (c.participant?.phoneNumber || '').toLowerCase();
      const groupSubject = (c.groupMetadata?.groupSubject || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || groupSubject.includes(q);
    });
  }, [conversations, debouncedQuery]);

  const handleToggleSelect = (id: string) => {
    if (isSending) return;
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSend = async () => {
    if (selectedIds.length === 0 || !message || isSending) return;
    setIsSending(true);
    try {
      await onForward(selectedIds, message);
      onClose();
    } catch (err) {
      console.error('Failed to forward message:', err);
    } finally {
      setIsSending(false);
    }
  };

  const selectedCountText = useMemo(() => {
    const count = selectedIds.length;
    if (count === 0) return null;
    if (lang === 'ar') {
      return count === 1 ? 'محادثة واحدة محددة' : `${count} محادثات محددة`;
    }
    return `${count} ${count === 1 ? 'chat selected' : 'chats selected'}`;
  }, [selectedIds.length, lang]);

  if (!isOpen || !message) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px] transition-opacity"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSending) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="forward-modal-title"
    >
      <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-gray-200 dark:border-[#222e35] w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-[#222e35] shrink-0">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-[#00a884] rtl:scale-x-[-1]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 10H11a5 5 0 00-5 5v3M21 10l-6-6M21 10l-6 6" />
            </svg>
            <h2 id="forward-modal-title" className="text-base font-semibold text-gray-900 dark:text-[#e9edef]">
              {t.forward_message_to}
            </h2>
          </div>
          <button
            type="button"
            disabled={isSending}
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-[#e9edef] p-1 rounded-full hover:bg-gray-100 dark:hover:bg-[#202c33] transition"
            title={t.cancel}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Message preview bar */}
        <div className="px-5 py-2 bg-gray-50 dark:bg-[#182229] border-b border-gray-100 dark:border-[#222e35] text-xs text-gray-600 dark:text-[#8696a0] flex items-center gap-2 shrink-0 truncate">
          <span className="font-medium text-[#00a884] shrink-0">{t.forward}:</span>
          <span className="truncate italic">
            {message.type === 'contacts'
              ? `👤 ${message.content || t.contact} (${message.contactPhone || ''})`
              : message.attachments && message.attachments.length > 0
              ? `📎 ${message.attachments[0].name || message.attachments[0].type} ${message.content ? `- ${message.content}` : ''}`
              : message.content || t.unsupported_message}
          </span>
        </div>

        {/* Search Input Bar */}
        <div className="p-3 border-b border-gray-100 dark:border-[#222e35] shrink-0">
          <div className="relative flex items-center bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg px-3 py-1.5 transition-colors focus-within:ring-1 focus-within:ring-[#00a884]">
            <svg className="w-4 h-4 text-gray-400 dark:text-[#8696a0] shrink-0 me-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.sidebar_search_placeholder}
              className="w-full bg-transparent border-none text-sm text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-[#e9edef] p-0.5 ms-1"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Conversation List */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-[#202c33] select-none">
          {filteredConversations.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400 dark:text-[#8696a0]">
              {t.search_no_results}
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = selectedIds.includes(conv.id);
              const displayName = conv.groupMetadata?.groupSubject || conv.participant.displayName || t.unknown_contact;
              const subtext = conv.participant.phoneNumber || (conv.isGroup ? `${conv.groupMetadata?.participantCount || 0} participants` : '');
              const avatarSrc = conv.participant.avatarUrl || avatarDataUri(displayName);

              return (
                <div
                  key={conv.id}
                  onClick={() => handleToggleSelect(conv.id)}
                  className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#00a884]/10 dark:bg-[#00a884]/15'
                      : 'hover:bg-gray-50 dark:hover:bg-[#182229]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={avatarSrc}
                      alt={displayName}
                      className="w-11 h-11 rounded-full object-cover shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = avatarDataUri(displayName);
                      }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-[#e9edef] truncate">
                        {displayName}
                      </p>
                      {subtext && (
                        <p className="text-xs text-gray-500 dark:text-[#8696a0] truncate mt-0.5" dir="ltr">
                          {subtext}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Selection Checkbox */}
                  <div className="shrink-0 ms-3">
                    {isSelected ? (
                      <div className="w-5 h-5 rounded-full bg-[#00a884] flex items-center justify-center text-white shadow-sm transition-transform scale-105">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-[#8696a0] transition-colors" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer with Selected Counter and Forward Send Button */}
        <div className="p-4 border-t border-gray-100 dark:border-[#222e35] bg-gray-50 dark:bg-[#182229] flex items-center justify-between shrink-0">
          <div className="text-xs text-gray-600 dark:text-[#8696a0]">
            {selectedCountText ? (
              <span className="font-semibold text-gray-900 dark:text-[#e9edef]">
                {selectedCountText}
              </span>
            ) : (
              <span>{t.select_chats}</span>
            )}
          </div>

          <button
            type="button"
            disabled={selectedIds.length === 0 || isSending}
            onClick={handleSend}
            className="w-11 h-11 rounded-full bg-[#00a884] hover:bg-[#02906f] active:scale-95 text-white flex items-center justify-center shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 shrink-0"
            title={t.send_to}
          >
            {isSending ? (
              <svg className="animate-spin w-5 h-5 text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg
                className="w-5 h-5 rtl:rotate-180"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ForwardModal;
