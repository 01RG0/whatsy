import React, { useState, useRef, useEffect } from 'react';
import { SendMessagePayload } from './types';
import { API_BASE } from '../api/inbox';

interface ChatInputProps {
  onSendMessage: (payload: Partial<SendMessagePayload>) => void;
  onSendVoiceNote?: (audioBlob: Blob) => void;
  disabled?: boolean;
  replyingTo?: { id: string; senderName: string; content: string } | null;
  onCancelReply?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

const UPLOAD_URL = `${API_BASE}/v1/whatsapp/upload`;

async function uploadToBackend(blob: Blob, filename: string): Promise<string> {
  const token = localStorage.getItem('whatsy_jwt');
  const form = new FormData();
  form.append('attachment', blob, filename);
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();
  return data.url as string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onSendVoiceNote: _onSendVoiceNote,
  disabled = false,
  replyingTo,
  onCancelReply,
  onFocus,
  onBlur,
}) => {
  const [text, setText] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [showAttachMenu]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSendMessage({ message: text.trim(), replyTo: replyingTo?.id });
    setText('');
    if (onCancelReply) onCancelReply();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startRecording = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('Microphone access denied:', err);
      return;
    }
    streamRef.current = stream;
    audioChunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
    };
    recorder.start();
    setIsRecording(true);
    setRecordingDuration(0);
    recordingTimerRef.current = setInterval(() => setRecordingDuration((p) => p + 1), 1000);
  };

  const stopRecording = (cancel = false) => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingDuration(0);

    const recorder = mediaRecorderRef.current;
    const stream = streamRef.current;

    if (!recorder) return;

    recorder.onstop = async () => {
      stream?.getTracks().forEach((t) => t.stop());
      if (cancel) return;
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/ogg' });
      setIsUploading(true);
      try {
        const url = await uploadToBackend(blob, `voice-${Date.now()}.ogg`);
        onSendMessage({ voiceNote: true, attachmentType: 'audio', attachmentUrl: url, replyTo: replyingTo?.id });
        if (onCancelReply) onCancelReply();
      } catch (err) {
        console.error('Voice upload failed:', err);
      } finally {
        setIsUploading(false);
      }
    };

    recorder.stop();
    mediaRecorderRef.current = null;
    streamRef.current = null;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    let attachmentType: 'image' | 'audio' | 'video' | 'document' = 'document';
    if (file.type.startsWith('image/')) attachmentType = 'image';
    else if (file.type.startsWith('audio/')) attachmentType = 'audio';
    else if (file.type.startsWith('video/')) attachmentType = 'video';
    setShowAttachMenu(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsUploading(true);
    try {
      const url = await uploadToBackend(file, file.name);
      onSendMessage({
        message: text.trim() || (attachmentType === 'image' ? '' : file.name),
        attachmentUrl: url,
        attachmentType,
        attachmentName: file.name,
        replyTo: replyingTo?.id,
      });
      setText('');
      if (onCancelReply) onCancelReply();
    } catch (err) {
      console.error('File upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className="bg-white dark:bg-[#202c33] border-t border-gray-200 dark:border-[#222e35] px-4 pt-2 pb-2 relative flex flex-col select-none"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {/* Reply Preview */}
      {replyingTo && (
        <div className="flex items-center justify-between bg-gray-100 dark:bg-[#182229] border-l-4 border-[#00a884] p-2.5 mb-2 rounded text-xs">
          <div className="flex flex-col min-w-0 pr-2">
            <span className="text-[#00a884] font-semibold">{replyingTo.senderName}</span>
            <span className="text-gray-500 dark:text-[#8696a0] truncate">{replyingTo.content}</span>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="text-gray-400 dark:text-[#8696a0] hover:text-gray-700 dark:hover:text-[#e9edef] p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Attachment Popover */}
      {showAttachMenu && (
        <div ref={attachMenuRef} className="absolute bottom-full left-4 mb-2 bg-white dark:bg-[#233138] rounded-xl shadow-2xl p-2 flex flex-col gap-2 z-50 border border-gray-200 dark:border-[#2a3942] animate-in fade-in slide-in-from-bottom-2 duration-150">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#182229] text-sm text-gray-700 dark:text-[#e9edef] transition">
            <span className="w-8 h-8 rounded-full bg-[#bf59cf] flex items-center justify-center text-white">🖼️</span>
            <span>Photos &amp; Videos</span>
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#182229] text-sm text-gray-700 dark:text-[#e9edef] transition">
            <span className="w-8 h-8 rounded-full bg-[#5f66cd] flex items-center justify-center text-white">📄</span>
            <span>Document</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAttachMenu(false);
              onSendMessage({ message: 'Interactive Quick Template', buttons: [{ id: 'opt_1', title: 'Talk to Agent' }, { id: 'opt_2', title: 'View Catalog' }] });
            }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#182229] text-sm text-gray-700 dark:text-[#e9edef] transition"
          >
            <span className="w-8 h-8 rounded-full bg-[#00a884] flex items-center justify-center text-white">⚡</span>
            <span>Interactive Template</span>
          </button>
        </div>
      )}

      <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />

      {/* Input Row */}
      <div className="flex items-end gap-2">
        {isRecording ? (
          <div className="flex-1 flex items-center justify-between bg-gray-100 dark:bg-[#111b21] rounded-lg px-4 py-2 text-gray-700 dark:text-[#e9edef]">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-mono">
                {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => stopRecording(true)} className="text-red-400 hover:text-red-500 text-xs font-semibold px-2 py-1">Cancel</button>
              <button type="button" onClick={() => stopRecording(false)} disabled={isUploading} className="w-8 h-8 rounded-full bg-[#00a884] flex items-center justify-center text-white hover:opacity-90 disabled:opacity-50">
                {isUploading ? (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
                )}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Emoji */}
            <button type="button" className="text-gray-400 dark:text-[#8696a0] hover:text-gray-700 dark:hover:text-[#e9edef] p-2 rounded-full transition shrink-0" title="Emoji">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            </button>

            {/* Attach */}
            <button
              type="button"
              onClick={() => setShowAttachMenu((p) => !p)}
              disabled={isUploading}
              className={`p-2 rounded-full transition shrink-0 ${showAttachMenu ? 'text-[#00a884] bg-gray-100 dark:bg-[#2a3942]' : 'text-gray-400 dark:text-[#8696a0] hover:text-gray-700 dark:hover:text-[#e9edef]'} disabled:opacity-50`}
              title="Attach File"
            >
              {isUploading ? (
                <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              ) : (
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              )}
            </button>

            {/* Textarea */}
            <div className="flex-1 bg-gray-100 dark:bg-[#2a3942] rounded-lg px-3 py-2 flex items-center min-h-[42px] max-h-32">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={onFocus}
                onBlur={onBlur}
                rows={1}
                placeholder="Type a message"
                disabled={disabled || isUploading}
                className="w-full bg-transparent text-gray-900 dark:text-[#e9edef] text-sm placeholder-gray-400 dark:placeholder-[#8696a0] outline-none resize-none overflow-y-auto max-h-24 leading-relaxed select-text"
              />
            </div>

            {/* Send / Mic */}
            {text.trim() ? (
              <button
                type="button"
                onClick={handleSend}
                disabled={disabled || isUploading}
                className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center text-white hover:opacity-90 transition shrink-0 shadow disabled:opacity-50"
                title="Send Message"
              >
                <svg className="w-5 h-5 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                disabled={disabled || isUploading}
                className="p-2 text-gray-400 dark:text-[#8696a0] hover:text-gray-700 dark:hover:text-[#e9edef] rounded-full transition shrink-0 disabled:opacity-50"
                title="Record Voice Note"
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
