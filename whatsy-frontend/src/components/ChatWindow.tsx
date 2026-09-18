import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { ZernioConversation, ZernioMessage, SendMessagePayload } from './types';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { ImageLightbox } from './ImageLightbox';
import type { AgentSummary } from '../api/inbox';
import { canWrite, isViewer } from '../lib/auth';

export interface ViewerInfo {
  agentId: string;
  name: string;
  avatar: string;
}

export interface TypingLock {
  lockedBy: ViewerInfo;
  expiresInMs: number;
}

interface ChatWindowProps {
  conversation: ZernioConversation | null;
  messages: ZernioMessage[];
  isLoadingMessages?: boolean;
  onSendMessage: (payload: Partial<SendMessagePayload>) => void;
  onRetryMessage?: (message: ZernioMessage) => void;
  onSendVoiceNote?: (audioBlob: Blob) => void;
  onBack?: () => void;
  onViewContactInfo?: (participantId: string) => void;
  onSearchInChat?: () => void;
  viewers?: ViewerInfo[];
  typingLock?: TypingLock | null;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
  agents?: AgentSummary[];
  onAssign?: (agentId: string) => void;
  onMarkUnread?: (conversationId: string) => void;
  onMarkRead?: (conversationId: string) => void;
  onLoadMoreMessages?: () => void;
  hasMoreMessages?: boolean;
  isLoadingMoreMessages?: boolean;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  conversation,
  messages,
  isLoadingMessages = false,
  onSendMessage,
  onRetryMessage,
  onSendVoiceNote,
  onBack,
  onViewContactInfo,
  onSearchInChat,
  viewers = [],
  typingLock = null,
  onInputFocus,
  onInputBlur,
  agents = [],
  onAssign,
  onMarkUnread,
  onMarkRead,
  onLoadMoreMessages,
  hasMoreMessages = false,
  isLoadingMoreMessages = false,
}) => {
  type ReplyPreview = { id: string; senderName: string; content: string };
  const isViewerMode = isViewer() || !canWrite();
  const [replyingTo, setReplyingTo] = useState<ReplyPreview | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const assignRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  // Close assign & options dropdowns on outside click.
  useEffect(() => {
    if (!assignOpen && !optionsOpen) return;
    const handler = (e: MouseEvent) => {
      if (assignRef.current && !assignRef.current.contains(e.target as Node)) {
        setAssignOpen(false);
      }
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setOptionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [assignOpen, optionsOpen]);

  const prevMessageCountRef = useRef(0);
  const prevConvIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const convChanged = conversation?.id !== prevConvIdRef.current;
    const isNewMessage = messages.length > prevMessageCountRef.current && !convChanged;
    const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;

    if (convChanged || (isNewMessage && wasNearBottom)) {
      el.scrollTop = el.scrollHeight;
    }
    prevMessageCountRef.current = messages.length;
    prevConvIdRef.current = conversation?.id ?? null;
  }, [messages, conversation?.id]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || !hasMoreMessages || isLoadingMoreMessages) return;
    if (el.scrollTop < 80) {
      onLoadMoreMessages?.();
    }
  }, [hasMoreMessages, isLoadingMoreMessages, onLoadMoreMessages]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const groupedMessages = useMemo(() => {
    const groups: { dateLabel: string; items: ZernioMessage[] }[] = [];
    messages.forEach((msg) => {
      const msgDate = new Date(msg.createdAt);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let label = msgDate.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
      if (msgDate.getDate() === today.getDate() && msgDate.getMonth() === today.getMonth() && msgDate.getFullYear() === today.getFullYear()) {
        label = 'TODAY';
      } else if (msgDate.getDate() === yesterday.getDate() && msgDate.getMonth() === yesterday.getMonth() && msgDate.getFullYear() === yesterday.getFullYear()) {
        label = 'YESTERDAY';
      }

      const existingGroup = groups.find((g) => g.dateLabel === label);
      if (existingGroup) existingGroup.items.push(msg);
      else groups.push({ dateLabel: label, items: [msg] });
    });
    return groups;
  }, [messages]);

  if (!conversation) {
    return (
      <div className="flex-1 h-full bg-[#f0f2f5] dark:bg-[#222e35] border-b-[6px] border-[#00a884] flex flex-col items-center justify-center select-none">
        <div className="max-w-md text-center flex flex-col items-center p-6">
          <div className="w-20 h-20 rounded-full bg-white dark:bg-[#111b21] flex items-center justify-center mb-6 shadow-sm">
            <svg className="w-10 h-10 text-[#00a884]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2z"/>
            </svg>
          </div>
          <h2 className="text-2xl font-light text-gray-900 dark:text-[#e9edef] mb-3">WhatsApp for Web &amp; Zernio Inbox</h2>
          <p className="text-sm leading-relaxed text-gray-500 dark:text-[#8696a0]">
            Send and receive real-time messages across WhatsApp, multi-agent teams, and cloud channels without keeping your phone connected.
          </p>
          <div className="mt-8 flex items-center gap-2 text-xs text-gray-400 dark:text-[#667781]">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
            End-to-end encrypted via Zernio Gateway
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-[#efeae2] dark:bg-[#0b141a] relative overflow-hidden">
      {/* Header */}
      <header className="h-[60px] bg-[#f0f2f5] dark:bg-[#202c33] px-4 flex items-center justify-between z-10 select-none border-b border-[#e9edef] dark:border-[#222e35]">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => onViewContactInfo?.(conversation.participant.id)}>
          {onBack && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onBack(); }}
              className="md:hidden text-gray-500 dark:text-[#aebac1] hover:text-gray-900 dark:hover:text-[#e9edef] -ml-1 mr-1"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )}

          <div className="relative">
            <img
              src={conversation.participant.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(conversation.participant.displayName)}&background=e5e7eb&color=374151`}
              alt={conversation.participant.displayName}
              className="w-10 h-10 rounded-full object-cover"
            />
            {conversation.participant.isOnline && (
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white dark:ring-[#202c33]" />
            )}
          </div>

          <div className="flex flex-col">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-[#e9edef] leading-tight">
              {conversation.participant.displayName}
            </h2>
            {typingLock ? (
              <span className="flex items-center gap-1 text-[12px] text-[#00a884] leading-tight mt-0.5">
                <span>{typingLock.lockedBy.name} is typing</span>
                <span className="flex items-center gap-[3px] text-[#00a884]">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </span>
              </span>
            ) : (
              <span className="text-[12px] text-gray-500 dark:text-[#8696a0] leading-tight mt-0.5">
                {conversation.participant.isOnline
                  ? 'online'
                  : (() => {
                      const ls = conversation.participant.lastSeen;
                      if (!ls || ls.startsWith('0001-')) return conversation.participant.phoneNumber || 'offline';
                      const d = new Date(ls);
                      return `last seen ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                    })()}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 text-gray-500 dark:text-[#aebac1]">
          {/* Assigned agent chip + assign dropdown */}
          {onAssign && agents.length > 0 && (
            <div className="relative" ref={assignRef}>
              <button
                type="button"
                disabled={isViewerMode}
                onClick={() => !isViewerMode && setAssignOpen((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-[#374248] transition ${
                  isViewerMode ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-200 dark:hover:bg-[#2a3942]'
                }`}
                title={isViewerMode ? 'View-only mode: cannot reassign conversations' : 'Assign conversation'}
              >
                {conversation.assignedAgent ? (
                  <>
                    <span className="w-4 h-4 rounded-full bg-[#00a884] flex items-center justify-center text-white text-[9px] font-bold shrink-0">
                      {conversation.assignedAgent.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="max-w-[80px] truncate">{conversation.assignedAgent.name}</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                    <span>{isViewerMode ? 'Unassigned' : 'Assign'}</span>
                  </>
                )}
                {!isViewerMode && (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                )}
              </button>
              {assignOpen && !isViewerMode && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-[#233138] rounded-lg shadow-xl border border-gray-200 dark:border-[#374248] z-50 py-1 overflow-hidden">
                  {conversation.assignedAgent && (
                    <button
                      type="button"
                      onClick={() => { onAssign(''); setAssignOpen(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-gray-50 dark:hover:bg-[#2a3942]"
                    >
                      Unassign
                    </button>
                  )}
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => { onAssign(a.id); setAssignOpen(false); }}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-50 dark:hover:bg-[#2a3942] transition ${conversation.assignedAgent?.id === a.id ? 'text-[#00a884]' : 'text-gray-800 dark:text-[#e9edef]'}`}
                    >
                      <span className="w-6 h-6 rounded-full bg-[#00a884] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                        {a.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{a.name}</div>
                        <div className="text-[11px] text-gray-400 dark:text-[#8696a0] truncate">{a.role}</div>
                      </div>
                      {conversation.assignedAgent?.id === a.id && (
                        <svg className="w-3.5 h-3.5 ml-auto shrink-0 text-[#00a884]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={onSearchInChat} className="p-2 hover:bg-gray-100 dark:hover:bg-[#374248] rounded-full transition" title="Search in chat">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <div className="relative" ref={optionsRef}>
            <button
              type="button"
              onClick={() => setOptionsOpen((v) => !v)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-[#374248] rounded-full transition"
              title="More Options"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="6" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="18" r="1.5" />
              </svg>
            </button>
            {optionsOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-[#e9edef] dark:border-[#374151] bg-white dark:bg-[#202c33] p-1.5 shadow-xl z-50 text-left">
                {conversation.isMarkedUnread || conversation.unreadCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOptionsOpen(false);
                      onMarkRead?.(conversation.id);
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
                      setOptionsOpen(false);
                      onMarkUnread?.(conversation.id);
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
        </div>
      </header>

      {/* Message Stream */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-2 py-4 relative">
        {isLoadingMoreMessages && (
          <div className="flex justify-center py-2">
            <div className="w-5 h-5 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {isLoadingMessages && (
          <div className="flex justify-center p-4">
            <div className="w-6 h-6 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {groupedMessages.map((group, groupIdx) => (
          <React.Fragment key={groupIdx}>
            {/* Date separator */}
            <div className="flex justify-center my-3 select-none">
              <span className="bg-white/80 dark:bg-[#182229]/80 text-gray-500 dark:text-[#8696a0] text-[11px] font-semibold uppercase px-3 py-1 rounded-lg shadow-sm border border-gray-200/60 dark:border-[#222e35]/50 backdrop-blur-sm">
                {group.dateLabel}
              </span>
            </div>

            {group.items.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onImageClick={(url) => setLightboxUrl(url)}
                onReply={(m) => setReplyingTo({
                  id: m.id,
                  senderName: m.direction === 'outbound' ? 'You' : conversation.participant.displayName,
                  content: m.content || 'Attachment',
                })}
                onButtonClick={(_btnId, btnText) => !isViewerMode && onSendMessage({ message: btnText, replyTo: msg.id })}
                onRetry={isViewerMode ? undefined : onRetryMessage}
              />
            ))}
          </React.Fragment>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Viewer Pills */}
      {viewers.length > 0 && (
        <div className="px-4 py-1.5 flex items-center gap-2 bg-white dark:bg-[#202c33] border-t border-gray-200 dark:border-[#313d45]">
          <span className="text-xs text-gray-400 dark:text-[#8696a0]">Viewing:</span>
          {viewers.map((v) => (
            <span key={v.agentId} className="flex items-center gap-1 text-xs bg-gray-100 dark:bg-[#2a3942] rounded-full px-2 py-0.5 text-gray-700 dark:text-[#e9edef]">
              {v.avatar ? (
                <img src={v.avatar} alt={v.name} className="w-4 h-4 rounded-full object-cover" />
              ) : (
                <span className="w-4 h-4 rounded-full bg-[#25D366] flex items-center justify-center text-[9px] font-bold text-black">
                  {v.name.charAt(0).toUpperCase()}
                </span>
              )}
              {v.name}
            </span>
          ))}
        </div>
      )}


      {lightboxUrl && (
        <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}

      {/* Chat Input */}
      <ChatInput
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        disabled={typingLock !== null || isViewerMode}
        placeholder={isViewerMode ? 'View-only mode: only agents and admins can send messages.' : 'Type a message'}
        disabledTooltip={isViewerMode ? 'View-only mode: only agents and admins can send messages.' : undefined}
        onSendMessage={(payload) => onSendMessage({
          ...payload,
          conversationId: conversation.id,
          participantId: conversation.participant.id,
        })}
        onSendVoiceNote={isViewerMode ? undefined : onSendVoiceNote}
        onFocus={onInputFocus}
        onBlur={onInputBlur}
      />
    </div>
  );
};
