import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ZernioConversation, ZernioMessage, SendMessagePayload } from './types';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';

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
  onSendVoiceNote?: (audioBlob: Blob) => void;
  onBack?: () => void;
  onViewContactInfo?: (participantId: string) => void;
  onSearchInChat?: () => void;
  viewers?: ViewerInfo[];
  typingLock?: TypingLock | null;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  conversation,
  messages,
  isLoadingMessages = false,
  onSendMessage,
  onSendVoiceNote,
  onBack,
  onViewContactInfo,
  onSearchInChat,
  viewers = [],
  typingLock = null,
  onInputFocus,
  onInputBlur,
}) => {
  type ReplyPreview = { id: string; senderName: string; content: string };
  const [replyingTo, setReplyingTo] = useState<ReplyPreview | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      <div className="flex-1 h-full bg-gray-100 dark:bg-[#222e35] border-b-[6px] border-[#00a884] flex flex-col items-center justify-center select-none">
        <div className="max-w-md text-center flex flex-col items-center p-6">
          <div className="w-20 h-20 rounded-full bg-white dark:bg-[#111b21] flex items-center justify-center mb-6 shadow-md">
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
      <header className="h-[60px] bg-white dark:bg-[#202c33] px-4 flex items-center justify-between z-10 select-none border-b border-gray-200 dark:border-[#222e35]">
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
          </div>
        </div>

        <div className="flex items-center gap-1 text-gray-500 dark:text-[#aebac1]">
          <button type="button" onClick={onSearchInChat} className="p-2 hover:bg-gray-100 dark:hover:bg-[#374248] rounded-full transition" title="Search in chat">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <button type="button" className="p-2 hover:bg-gray-100 dark:hover:bg-[#374248] rounded-full transition" title="More Options">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="6" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="18" r="1.5" />
            </svg>
          </button>
        </div>
      </header>

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto px-2 py-4 relative">
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
                onButtonClick={(_btnId, btnText) => onSendMessage({ message: btnText, replyTo: msg.id })}
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

      {/* Typing Lock Banner */}
      {typingLock && (
        <div className="px-4 py-2 bg-white dark:bg-[#202c33] border-t border-gray-200 dark:border-[#313d45] flex items-center gap-2">
          <span className="text-[#25D366]">🔒</span>
          <span className="text-sm text-gray-500 dark:text-[#8696a0]">
            <span className="text-gray-900 dark:text-[#e9edef] font-medium">{typingLock.lockedBy.name}</span> is replying right now…
          </span>
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} className="max-h-screen max-w-screen object-contain" alt="" />
        </div>
      )}

      {/* Chat Input */}
      <ChatInput
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        disabled={typingLock !== null}
        onSendMessage={(payload) => onSendMessage({
          ...payload,
          accountId: conversation.accountId,
          conversationId: conversation.id,
          participantId: conversation.participant.id,
        })}
        onSendVoiceNote={onSendVoiceNote}
        onFocus={onInputFocus}
        onBlur={onInputBlur}
      />
    </div>
  );
};
