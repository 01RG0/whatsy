import React, { useMemo, useState, useRef } from 'react';
import { ZernioMessage, DeliveryStatus } from './types';
import { API_BASE } from '../api/inbox';
import VoiceNotePlayer from './VoiceNotePlayer';
import { useT } from '../i18n/translations';

const LONG_MESSAGE_CHAR_LIMIT = 450;

async function downloadMedia(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'image';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, '_blank');
  }
}
const LONG_MESSAGE_LINE_LIMIT = 7;

export function renderFormattedText(text: string): React.ReactNode {
  if (!text) return null;
  // Regex to match URLs starting with http:// or https://
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
      // Reset lastIndex because of /g flag on regex test
      urlRegex.lastIndex = 0;
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#027eb5] dark:text-[#53bdeb] underline hover:opacity-80 break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function getMediaUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  const token = localStorage.getItem('whatsy_jwt');
  let url = rawUrl;

  // Any external https URL → route through our backend proxy (adds Zernio API key).
  // Covers Zernio media, CDN URLs, S3 URLs — any format the upload or webhook returns.
  if (url.startsWith('https://') || url.startsWith('http://')) {
    const proxyUrl = `${API_BASE}/v1/whatsapp/media-proxy?url=${encodeURIComponent(url)}`;
    return token ? `${proxyUrl}&token=${encodeURIComponent(token)}` : proxyUrl;
  }

  // Already a relative proxy path → prepend backend base
  if (url.startsWith('/v1/')) {
    url = `${API_BASE}${url}`;
  }

  // Add JWT token for backend proxy auth on existing /v1/whatsapp/media/ paths
  if (url.includes('/v1/whatsapp/media') && token && !url.includes('token=')) {
    url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  }

  return url;
}

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
  const t = useT();
  const isOutbound = message.direction === 'outbound';
  const [isExpanded, setIsExpanded] = useState(false);

  // Swipe-to-reply — native listeners (passive:false) + direct DOM transforms for zero-jank animation
  const rowRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const row = rowRef.current;
    const bubble = bubbleRef.current;
    const icon = iconRef.current;
    if (!row || !bubble || !onReply) return;

    const THRESHOLD = 56;
    let startX = 0, startY = 0, horizontal = false, triggered = false;

    const applyX = (x: number) => {
      bubble.style.transform = `translateX(${x}px)`;
      if (icon) {
        const p = Math.min(x / THRESHOLD, 1);
        icon.style.opacity = String(p);
        icon.style.transform = `translateY(-50%) scale(${0.4 + p * 0.6})`;
      }
    };

    const snapBack = () => {
      bubble.style.transition = 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
      bubble.style.transform = 'translateX(0px)';
      if (icon) {
        icon.style.transition = 'opacity 0.25s, transform 0.25s';
        icon.style.opacity = '0';
        icon.style.transform = 'translateY(-50%) scale(0.4)';
      }
    };

    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      horizontal = false;
      triggered = false;
      bubble.style.transition = 'none';
      if (icon) icon.style.transition = 'none';
    };

    const onMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startX;
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (!horizontal) {
        if (Math.abs(dx) < 6 && dy < 6) return;
        if (Math.abs(dx) > dy) horizontal = true;
        else { startX = 0; return; }
      }
      if (dx > 0) {
        e.preventDefault();
        // sqrt curve: fast to start, slows naturally — matches WhatsApp feel
        const x = Math.min(Math.sqrt(dx) * 4.8, 78);
        applyX(x);
        if (x >= THRESHOLD && !triggered) {
          triggered = true;
          if ('vibrate' in navigator) navigator.vibrate(8);
        }
      }
    };

    const onEnd = () => {
      if (!horizontal && !startX) return;
      const currentX = parseFloat(bubble.style.transform.replace(/[^0-9.-]/g, '') || '0');
      if (currentX >= THRESHOLD) onReply(message);
      snapBack();
      horizontal = false;
      startX = 0;
    };

    row.addEventListener('touchstart', onStart, { passive: true });
    row.addEventListener('touchmove', onMove, { passive: false });
    row.addEventListener('touchend', onEnd, { passive: true });
    row.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      row.removeEventListener('touchstart', onStart);
      row.removeEventListener('touchmove', onMove);
      row.removeEventListener('touchend', onEnd);
      row.removeEventListener('touchcancel', onEnd);
    };
  }, [message, onReply]);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});

  const lineCount = (message.content || '').split('\n').length;
  const isLongMessage = Boolean(
    message.content &&
    (message.content.length > LONG_MESSAGE_CHAR_LIMIT || lineCount > LONG_MESSAGE_LINE_LIMIT)
  );

  const displayedContent = useMemo(() => {
    if (!message.content) return '';
    if (!isLongMessage || isExpanded) return message.content;

    // Truncate cleanly: take the first ~400 characters (or slice up to the 6th newline, whichever is shorter)
    const charTruncated = message.content.slice(0, 400);
    const lines = message.content.split('\n');
    const lineTruncated = lines.length > 6 ? lines.slice(0, 6).join('\n') : message.content;

    return charTruncated.length < lineTruncated.length ? charTruncated : lineTruncated;
  }, [message.content, isLongMessage, isExpanded]);

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
            title={t.tap_to_retry}
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
    <div
      ref={rowRef}
      className={`group relative flex w-full my-1 px-4 ${isOutbound ? 'justify-end' : 'justify-start'}`}
    >
      {/* Swipe-to-reply indicator — always in DOM, driven by native touch handler */}
      <div
        ref={iconRef}
        className="absolute left-4 top-1/2 w-8 h-8 rounded-full bg-[#e9edef] dark:bg-[#374248] flex items-center justify-center text-[#54656f] dark:text-[#aebac1] pointer-events-none"
        style={{ opacity: 0, transform: 'translateY(-50%) scale(0.4)' }}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10h10a5 5 0 015 5v3M3 10l6-6M3 10l6 6" />
        </svg>
      </div>
      <div
        ref={bubbleRef}
        className={`relative max-w-[85%] sm:max-w-[70%] md:max-w-[60%] lg:max-w-[50%] rounded-lg shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] text-[14.2px] leading-[19px] overflow-hidden transition-all ${
          isOutbound
            ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] ltr:rounded-tr-none rtl:rounded-tl-none'
            : 'bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#d1d7db] ltr:rounded-tl-none rtl:rounded-tr-none'
        }`}
      >
        {/* Reply Quote Banner */}
        {message.replyTo && (
          <div
            className={`mx-1.5 mt-1.5 p-2 rounded flex flex-col text-xs border-s-4 cursor-pointer select-none ${
              isOutbound
                ? 'bg-[#c5ecc0] dark:bg-[#025144] border-[#00a884]'
                : 'bg-[#f0f2f5] dark:bg-[#182229] border-[#00a884]'
            }`}
          >
            <span className="font-semibold text-[#53bdeb] mb-0.5">{message.replyTo.senderName}</span>
            <span className="truncate opacity-80">{renderFormattedText(message.replyTo.content)}</span>
          </div>
        )}

        {/* Media Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-col gap-1">
            {message.attachments.map((att, idx) => {
              const mediaUrl = getMediaUrl(att.url);
              if (att.type === 'image') {
                if (failedImages[idx]) {
                  return (
                    <div key={idx} className="flex items-center gap-3 p-3 m-1.5 rounded bg-black/5 dark:bg-black/15 text-sm">
                      <div className="w-10 h-10 rounded bg-[#bf59cf]/20 flex items-center justify-center text-xl shrink-0">
                        🖼️
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{att.name || t.photo}</p>
                        <p className="text-[11px] opacity-70">{t.unable_to_load_image}</p>
                      </div>
                      <a
                        href={mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        download={att.name || 'image'}
                        className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-[#00a884] dark:text-[#53bdeb] transition"
                        title={t.open_download_image}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </a>
                    </div>
                  );
                }
                return (
                  <div key={idx} className="relative cursor-zoom-in overflow-hidden max-h-72 bg-black/10 group/img" onClick={() => onImageClick?.(mediaUrl)}>
                    <img
                      src={mediaUrl}
                      alt={att.name || 'Attachment'}
                      className="w-full h-auto object-cover transition group-hover/img:brightness-90"
                      loading="lazy"
                      onError={() => setFailedImages((prev) => ({ ...prev, [idx]: true }))}
                    />
                    {/* Download button — bottom-end, WhatsApp style */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); downloadMedia(mediaUrl, att.name || 'image.jpg'); }}
                      className="absolute bottom-2 end-2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white opacity-0 group-hover/img:opacity-100 transition hover:bg-black/70"
                      title={t.download_image}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                  </div>
                );
              }
              if (att.type === 'sticker') {
                if (failedImages[idx]) {
                  return (
                    <div key={idx} className="flex items-center gap-2 p-2 m-1 rounded bg-black/5 dark:bg-black/15 text-sm text-gray-500 dark:text-[#8696a0]">
                      <span className="text-lg">🎨</span>
                      <span className="text-xs italic">{t.sticker}</span>
                    </div>
                  );
                }
                return (
                  <div key={idx} className="p-1 cursor-zoom-in" onClick={() => onImageClick?.(mediaUrl)}>
                    <img
                      src={mediaUrl}
                      alt="Sticker"
                      className="max-w-[160px] max-h-[160px] w-auto h-auto object-contain"
                      loading="lazy"
                      onError={() => setFailedImages((prev) => ({ ...prev, [idx]: true }))}
                    />
                  </div>
                );
              }
              if (att.type === 'video') {
                return (
                  <div key={idx} className="relative overflow-hidden max-h-80 bg-black/10 rounded">
                    <video controls src={mediaUrl} preload="metadata" className="w-full h-auto object-cover rounded" />
                  </div>
                );
              }
              if (att.type === 'audio' || (att.type as string) === 'voice_note' || message.type === 'voice_note') {
                return (
                  <div key={idx} className="px-3 py-2">
                    <VoiceNotePlayer src={mediaUrl} isOutbound={isOutbound} messageId={message.id} />
                  </div>
                );
              }
              if (att.type === 'document' || att.type === 'file') {
                const ext = (att.name || '').split('.').pop()?.toUpperCase() || 'FILE';
                return (
                  <a
                    key={idx}
                    href={mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    download={att.name || 'Document'}
                    className="flex items-center gap-3 p-3 m-1.5 rounded bg-black/5 dark:bg-black/15 hover:bg-black/10 dark:hover:bg-black/25 transition group/doc"
                  >
                    <div className="w-10 h-10 rounded bg-[#5f66cd]/20 flex items-center justify-center text-[#5f66cd] dark:text-[#8f94fb] shrink-0 font-bold text-xs uppercase">
                      {ext.length <= 4 ? ext : 'DOC'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate group-hover/doc:underline">{att.name || t.document}</p>
                      <p className="text-[11px] opacity-70">{att.sizeBytes ? `${(att.sizeBytes / 1024).toFixed(1)} KB` : t.document}</p>
                    </div>
                    <div className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-gray-500 dark:text-gray-300 transition shrink-0" title={t.download}>
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </div>
                  </a>
                );
              }
              return null;
            })}
          </div>
        )}

        {/* Voice Note Fallback: when type is voice_note/audio but no attachments array (URL in message.url or mediaUrl) */}
        {(message.type === 'voice_note' || message.type === 'audio') &&
          (!message.attachments || message.attachments.length === 0) && (
            <div className="px-3 py-2">
              {(message.mediaUrl || message.url) ? (
                <VoiceNotePlayer
                  src={getMediaUrl(message.mediaUrl || message.url!)}
                  isOutbound={isOutbound}
                  messageId={message.id}
                />
              ) : (
                <span className="text-sm text-gray-500 dark:text-[#8696a0] italic">{t.voice_message}</span>
              )}
            </div>
          )
        }

        {/* Text Content */}
        {message.content && message.content !== '[Unsupported message]' && (
          <div className="px-3 pt-2 pb-1.5 whitespace-pre-wrap break-words">
            <span>{renderFormattedText(displayedContent)}</span>
            {isLongMessage && !isExpanded && (
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="text-[#00a884] dark:text-[#53bdeb] font-medium hover:underline ms-1 cursor-pointer select-none"
              >
                {t.read_more}
              </button>
            )}
          </div>
        )}
        {message.content === '[Unsupported message]' && (!message.attachments || message.attachments.length === 0) &&
          !(( message.type === 'voice_note' || message.type === 'audio') && (message.mediaUrl || message.url)) && (
          <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-gray-400 dark:text-[#8696a0] italic text-sm">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>
              {message.type === 'image' ? t.photo
               : message.type === 'video' ? t.video
               : message.type === 'audio' ? t.audio
               : message.type === 'voice_note' ? t.voice_message
               : message.type === 'document' ? t.document
               : message.type === 'location' ? t.location
               : message.type === 'contacts' ? t.contact
               : message.type === 'sticker' ? t.sticker
               : t.unsupported_message}
            </span>
          </div>
        )}

        {/* Interactive Buttons (outbound: agent sent reply buttons) */}
        {message.interactive?.buttons && message.direction === 'outbound' && (
          <div className="border-t border-black/10 mt-1 flex flex-col divide-y divide-black/10">
            {message.interactive.buttons.map((btn, i) => (
              <button
                key={btn.id ?? btn.payload ?? i}
                type="button"
                onClick={() => onButtonClick?.(btn.id ?? btn.payload ?? '', btn.title)}
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

        {/* Interactive List Sections (outbound: agent sent a list message) */}
        {message.interactive?.listSections && message.interactive.listSections.length > 0 && (
          <div className="border-t border-black/10 mt-1">
            {message.interactive.listSections.map((section, si) => (
              <div key={si}>
                {section.title && (
                  <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#8696a0]">
                    {section.title}
                  </div>
                )}
                {section.rows?.map((row, ri) => (
                  <div key={row.id ?? ri} className="px-3 py-1.5 flex flex-col border-t border-black/5 first:border-0">
                    <span className="text-sm text-gray-800 dark:text-[#e9edef]">{row.title}</span>
                    {row.description && <span className="text-xs text-gray-400 dark:text-[#8696a0]">{row.description}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Inbound interactive reply: contact tapped a button or list row */}
        {message.type === 'interactive' && message.direction === 'inbound' && message.interactive?.buttons?.[0] && (
          <div className="mt-1 mx-1 mb-1 px-3 py-2 bg-black/5 dark:bg-white/5 rounded-lg flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-[#00a884] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] text-gray-400 dark:text-[#8696a0]">
                {message.interactive.buttons[0].type === 'list_reply' ? 'Selected' : 'Tapped'}
              </span>
              <span className="text-sm font-medium text-gray-800 dark:text-[#e9edef] truncate">
                {message.interactive.buttons[0].title || message.interactive.body}
              </span>
            </div>
          </div>
        )}

        {/* Timestamp + Status */}
        <div className="flex items-center justify-end gap-1 px-2.5 pb-1 text-[11px] select-none float-right opacity-60 ms-2 mt-[-4px]">
          {isOutbound && message.senderName && (
            <span className="opacity-80 me-1">{message.senderName}</span>
          )}
          <span>{formattedTime}</span>
          {isOutbound && renderStatusTicks(message.status)}
        </div>

        {/* Reaction Badges */}
        {message.reactions && message.reactions.length > 0 && (
          <div className="absolute -bottom-2 end-2 bg-white dark:bg-[#2a3942] rounded-full px-1.5 py-0.5 shadow border border-gray-200 dark:border-[#111b21] flex items-center gap-0.5 text-xs">
            {message.reactions.map((r, i) => (
              <span key={i} title={r.senderName || ''}>{r.emoji}</span>
            ))}
          </div>
        )}

        {/* Hover Quick Actions */}
        <div className="absolute top-1 end-1 hidden group-hover:flex items-center gap-1 bg-white/90 dark:bg-[#111b21]/80 rounded px-1 py-0.5 backdrop-blur-sm shadow">
          <button
            type="button"
            onClick={() => onReply?.(message)}
            title={t.reply}
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
