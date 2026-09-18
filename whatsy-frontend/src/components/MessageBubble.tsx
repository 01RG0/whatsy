import React, { useMemo } from 'react';
import { ZernioMessage, DeliveryStatus } from './types';

interface MessageBubbleProps {
  message: ZernioMessage;
  onImageClick?: (url: string) => void;
  onButtonClick?: (buttonId: string, buttonText: string) => void;
  onReply?: (message: ZernioMessage) => void;
  onRetry?: (message: ZernioMessage) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  onImageClick,
  onButtonClick,
  onReply,
  onRetry,
}) => {
  const isOutbound = message.direction === 'outbound';

  const formattedTime = useMemo(() => {
    try {
      return new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }, [message.createdAt]);

  const renderStatusTicks = (status: DeliveryStatus) => {
    switch (status) {
      case 'pending':
        return (
          <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        );
      case 'sent':
        return (
          <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'delivered':
        return (
          <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 13l4 4L14 7" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 13l4 4L21 7" />
          </svg>
        );
      case 'read':
        return (
          <svg className="w-4 h-4 text-[#53bdeb]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 13l4 4L14 7" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 13l4 4L21 7" />
          </svg>
        );
      case 'failed':
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRetry?.(message); }}
            title="Tap to retry"
            className="flex items-center gap-0.5 text-red-500 hover:text-red-400 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 14a1 1 0 11-2 0 1 1 0 012 0zm-1-10a1 1 0 00-1 1v6a1 1 0 102 0V7a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`group relative flex w-full my-1 px-4 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`relative max-w-[85%] sm:max-w-[70%] md:max-w-[60%] lg:max-w-[50%] rounded-lg shadow-sm text-[14.2px] leading-[19px] overflow-hidden transition-all ${
          isOutbound
            ? 'bg-[#dcf8c6] dark:bg-[#005c4b] text-gray-900 dark:text-[#e9edef] rounded-tr-none'
            : 'bg-white dark:bg-[#202c33] text-gray-900 dark:text-[#d1d7db] rounded-tl-none'
        }`}
      >
        {/* Reply Quote Banner */}
        {message.replyTo && (
          <div
            className={`mx-1.5 mt-1.5 p-2 rounded flex flex-col text-xs border-l-4 cursor-pointer select-none ${
              isOutbound
                ? 'bg-[#b7e0a0] dark:bg-[#025144] border-[#25d366]'
                : 'bg-gray-100 dark:bg-[#182229] border-[#00a884]'
            }`}
          >
            <span className="font-semibold text-[#53bdeb] mb-0.5">{message.replyTo.senderName}</span>
            <span className="truncate opacity-80">{message.replyTo.content}</span>
          </div>
        )}

        {/* Media Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-col gap-1">
            {message.attachments.map((att, idx) => {
              if (att.type === 'image') {
                return (
                  <div key={idx} className="relative cursor-pointer overflow-hidden max-h-80 bg-black/10" onClick={() => onImageClick?.(att.url)}>
                    <img src={att.url} alt={att.name || 'Attachment'} className="w-full h-auto object-cover hover:opacity-95 transition" loading="lazy" />
                  </div>
                );
              }
              if (att.type === 'video') {
                return (
                  <div key={idx} className="relative overflow-hidden max-h-80 bg-black/10 rounded">
                    <video controls src={att.url} className="w-full h-auto object-cover rounded" />
                  </div>
                );
              }
              if (att.type === 'audio' || message.type === 'voice_note') {
                return (
                  <div key={idx} className="p-3 bg-black/5 dark:bg-black/10">
                    <audio controls src={att.url} className="max-w-[240px]" />
                  </div>
                );
              }
              if (att.type === 'document') {
                return (
                  <a key={idx} href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-3 m-1.5 rounded bg-black/5 dark:bg-black/15 hover:bg-black/10 dark:hover:bg-black/25 transition">
                    <div className="w-10 h-10 rounded bg-red-100 dark:bg-[#ff5252]/20 flex items-center justify-center text-red-500 dark:text-[#ff5252] shrink-0 font-bold text-xs uppercase">PDF</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{att.name || 'Document'}</p>
                      <p className="text-[11px] opacity-70">{att.sizeBytes ? `${(att.sizeBytes / 1024).toFixed(1)} KB` : 'Document'}</p>
                    </div>
                  </a>
                );
              }
              return null;
            })}
          </div>
        )}

        {/* Text Content */}
        {message.content && message.content !== '[Unsupported message]' && (
          <div className="px-3 pt-2 pb-1.5 whitespace-pre-wrap break-words">{message.content}</div>
        )}
        {message.content === '[Unsupported message]' && (!message.attachments || message.attachments.length === 0) && (
          <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-gray-400 dark:text-[#8696a0] italic text-sm">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>
              {message.type === 'image' ? '📷 Photo'
               : message.type === 'video' ? '🎥 Video'
               : message.type === 'audio' ? '🎵 Audio'
               : message.type === 'voice_note' ? '🎤 Voice message'
               : message.type === 'document' ? '📄 Document'
               : message.type === 'location' ? '📍 Location'
               : message.type === 'contacts' ? '👤 Contact'
               : message.type === 'sticker' ? '🎨 Sticker'
               : 'Unsupported message'}
            </span>
          </div>
        )}

        {/* Interactive Buttons */}
        {message.interactive?.buttons && (
          <div className="border-t border-black/10 mt-1 flex flex-col divide-y divide-black/10">
            {message.interactive.buttons.map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => onButtonClick?.(btn.id, btn.title)}
                className="py-2 px-3 text-center text-sm font-medium text-[#53bdeb] hover:bg-black/5 dark:hover:bg-black/10 transition flex items-center justify-center gap-2"
              >
                {btn.type === 'url' && (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                )}
                {btn.type === 'call' && (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                  </svg>
                )}
                {btn.title}
              </button>
            ))}
          </div>
        )}

        {/* Timestamp + Status */}
        <div className="flex items-center justify-end gap-1 px-2.5 pb-1 text-[11px] select-none float-right opacity-60 ml-2 mt-[-4px]">
          {isOutbound && message.senderName && (
            <span className="opacity-80 mr-1">{message.senderName}</span>
          )}
          <span>{formattedTime}</span>
          {isOutbound && renderStatusTicks(message.status)}
        </div>

        {/* Reaction Badges */}
        {message.reactions && message.reactions.length > 0 && (
          <div className="absolute -bottom-2 right-2 bg-white dark:bg-[#2a3942] rounded-full px-1.5 py-0.5 shadow border border-gray-200 dark:border-[#111b21] flex items-center gap-0.5 text-xs">
            {message.reactions.map((r, i) => (
              <span key={i} title={r.senderName || ''}>{r.emoji}</span>
            ))}
          </div>
        )}

        {/* Hover Quick Actions */}
        <div className="absolute top-1 right-1 hidden group-hover:flex items-center gap-1 bg-white/90 dark:bg-[#111b21]/80 rounded px-1 py-0.5 backdrop-blur-sm shadow">
          <button
            type="button"
            onClick={() => onReply?.(message)}
            title="Reply"
            className="text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white p-0.5"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 10h10a5 5 0 015 5v3M3 10l6-6M3 10l6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
