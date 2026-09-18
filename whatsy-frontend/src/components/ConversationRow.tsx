import React, { useState, useRef, useEffect } from 'react';
import type { ZernioConversation } from './types';
import type { ViewerInfo, TypingLock } from '../store/useInboxStore';

interface ConversationRowProps {
  conversation: ZernioConversation;
  isSelected: boolean;
  viewers?: ViewerInfo[];
  typingLock?: TypingLock | null;
  onSelect: () => void;
  onMarkUnread?: (conversationId: string) => void;
  onMarkRead?: (conversationId: string) => void;
}

export const ConversationRow: React.FC<ConversationRowProps> = ({
  conversation: conv,
  isSelected,
  viewers = [],
  typingLock = null,
  onSelect,
  onMarkUnread,
  onMarkRead,
}) => {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showHoverMenu, setShowHoverMenu] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu && !menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setMenuOpen(false);
      }
    };
    const handleScroll = () => {
      setContextMenu(null);
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu, menuOpen]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  };

  // Guard against +unknown-<zernioConvID> placeholders created before sync
  // has had a chance to backfill the real phone number.
  const displayName = /^\+unknown-/i.test(conv.participant.displayName)
    ? 'Unknown Contact'
    : conv.participant.displayName;

  const isUnread = conv.isMarkedUnread || conv.unreadCount > 0;
  const isManuallyUnread = Boolean(conv.isMarkedUnread);

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
    <div
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setShowHoverMenu(true)}
      onMouseLeave={() => {
        setShowHoverMenu(false);
        if (!contextMenu) setMenuOpen(false);
      }}
      onClick={onSelect}
      className={`group flex items-center gap-3 px-3 py-3 cursor-pointer transition relative select-none ${
        isSelected
          ? 'bg-[#f0f2f5] dark:bg-[#2a3942]'
          : 'hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]/70'
      }`}
    >
      {/* Avatar + team presence overlay */}
      <div className="relative shrink-0">
        <img
          src={
            conv.participant.avatarUrl ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=e5e7eb&color=374151`
          }
          alt={displayName}
          className="w-12 h-12 rounded-full object-cover"
        />
        {conv.participant.isOnline && viewers.length === 0 && (
          <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full ring-2 ring-white dark:ring-[#111b21]" />
        )}
        {/* Stacked agent avatars — team members viewing this chat */}
        {viewers.length > 0 && (
          <div className="absolute -bottom-1 -right-1 flex">
            {viewers.slice(0, 3).map((v, i) => (
              <span
                key={v.agentId}
                title={v.name}
                style={{ zIndex: 10 - i, marginLeft: i === 0 ? 0 : -6 }}
                className="w-5 h-5 rounded-full bg-[#00a884] ring-2 ring-white dark:ring-[#111b21] flex items-center justify-center text-white text-[8px] font-bold shrink-0"
              >
                {v.name.charAt(0).toUpperCase()}
              </span>
            ))}
            {viewers.length > 3 && (
              <span
                style={{ zIndex: 7, marginLeft: -6 }}
                className="w-5 h-5 rounded-full bg-gray-400 ring-2 ring-white dark:ring-[#111b21] flex items-center justify-center text-white text-[8px] font-bold shrink-0"
              >
                +{viewers.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <h3 className="font-medium text-sm text-gray-900 dark:text-[#e9edef] truncate">
            {displayName}
          </h3>
          <span
            className={`text-[11px] shrink-0 ml-2 ${
              isManuallyUnread
                ? 'text-[#027eb5] dark:text-[#53bdeb] font-semibold'
                : isUnread
                ? 'text-[#00a884] font-semibold'
                : 'text-gray-400 dark:text-[#8696a0]'
            }`}
          >
            {formatLastMessageTime(conv.lastMessage?.createdAt || conv.updatedAt)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs truncate pr-2 flex items-center gap-1">
            {typingLock ? (
              <span className="flex items-center gap-1 text-[#00a884]">
                <span>{typingLock.lockedBy.name} is typing</span>
                <span className="flex items-center gap-[3px]">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </span>
              </span>
            ) : (
              <span className="text-gray-500 dark:text-[#8696a0] truncate">
                {conv.lastMessage?.direction === 'outbound' && (
                  <span className="mr-1 text-gray-400">{conv.lastMessage.senderName || 'You'} :</span>
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
              </span>
            )}
          </p>

          <div className="flex items-center gap-1.5 shrink-0">
            {conv.isPinned && (
              <svg className="w-3.5 h-3.5 text-gray-400 dark:text-[#8696a0]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>
              </svg>
            )}

            {/* Unread badge / indicator: Blue circle for marked unread, green for standard unread */}
            {isManuallyUnread ? (
              <span
                data-testid="unread-dot-blue"
                title="Marked as unread"
                className="w-3 h-3 rounded-full bg-[#027eb5] dark:bg-[#53bdeb] shrink-0"
              />
            ) : conv.unreadCount > 0 ? (
              <span className="bg-[#00a884] text-white font-bold text-[11px] min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center">
                {conv.unreadCount}
              </span>
            ) : null}

            {/* Hover arrow trigger for action menu */}
            {(showHoverMenu || menuOpen) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenu(null);
                  setMenuOpen((v) => !v);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-[#e9edef] rounded-full transition"
                title="Chat options"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Context Menu / Dropdown Menu */}
      {menuOpen && (
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={
            contextMenu
              ? { position: 'fixed', top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }
              : undefined
          }
          className={`${
            contextMenu
              ? 'fixed z-50 w-48'
              : 'absolute right-3 top-10 z-30 w-48'
          } rounded-xl border border-[#e9edef] dark:border-[#374151] bg-white dark:bg-[#202c33] p-1.5 shadow-xl text-left`}
        >
          {isUnread ? (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setContextMenu(null);
                onMarkRead?.(conv.id);
              }}
              className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition"
            >
              <svg className="w-4 h-4 text-[#00a884]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Mark as read</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setContextMenu(null);
                onMarkUnread?.(conv.id);
              }}
              className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition"
            >
              <span className="w-3 h-3 rounded-full bg-[#027eb5] dark:bg-[#53bdeb]" />
              <span>Mark as unread</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
