import React, { useState, useRef, useEffect } from 'react';
import { SendMessagePayload } from './types';
import { API_BASE } from '../api/inbox';
import { useT } from '../i18n/translations';
import { useSettingsStore } from '../store/useSettingsStore';
import ImageAnnotator from './ImageAnnotator';

interface ChatInputProps {
  onSendMessage: (payload: Partial<SendMessagePayload>) => void;
  onSendVoiceNote?: (audioBlob: Blob) => void;
  disabled?: boolean;
  placeholder?: string;
  disabledTooltip?: string;
  replyingTo?: { id: string; senderName: string; content: string } | null;
  onCancelReply?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

const UPLOAD_URL = `${API_BASE}/v1/whatsapp/upload`;

async function uploadToBackend(blob: Blob, filename: string): Promise<string> {
  const token = localStorage.getItem('whatsy_jwt');
  const form = new FormData();
  form.append('file', blob, filename);
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Upload failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  // Handle various response shapes from Zernio's upload-direct endpoint
  const url = data.url || data.mediaUrl || data.attachmentUrl ||
    data?.data?.url || data?.data?.mediaUrl || data?.data?.attachmentUrl;
  if (!url) throw new Error(`Upload succeeded but response has no URL: ${JSON.stringify(data)}`);
  return url as string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onSendVoiceNote: _onSendVoiceNote,
  disabled = false,
  placeholder,
  disabledTooltip,
  replyingTo,
  onCancelReply,
  onFocus,
  onBlur,
}) => {
  const t = useT();
  const interactiveEnabled = useSettingsStore(s => s.settings.interactive_messages_enabled);
  const [text, setText] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [waveformBars, setWaveformBars] = useState<number[]>([0.3, 0.5, 0.8, 0.6, 0.4, 0.7, 0.5, 0.3]);
  const waveformAnimRef = useRef<number | null>(null);
  const [annotatorFile, setAnnotatorFile] = useState<File | null>(null);

  // Interactive message composer state
  const [showInteractiveComposer, setShowInteractiveComposer] = useState(false);
  const [interactiveTab, setInteractiveTab] = useState<'buttons' | 'list'>('buttons');
  const [interactiveBody, setInteractiveBody] = useState('');
  const [interactiveButtons, setInteractiveButtons] = useState([{ title: '' }, { title: '' }]);
  const [listSectionTitle, setListSectionTitle] = useState('');
  const [listRows, setListRows] = useState([{ title: '', description: '' }]);
  const mediaFileInputRef = useRef<HTMLInputElement>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Resolve placeholder: prop takes precedence, fall back to translation default
  const resolvedPlaceholder = placeholder ?? t.type_a_message;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight, 128); // max height ~5-6 lines
    el.style.height = `${Math.max(nextHeight, 24)}px`;
  }, [text]);

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

  useEffect(() => {
    if (!isRecording) {
      if (waveformAnimRef.current) cancelAnimationFrame(waveformAnimRef.current);
      setWaveformBars([0.3, 0.5, 0.8, 0.6, 0.4, 0.7, 0.5, 0.3]);
      return;
    }
    let lastUpdate = 0;
    const animate = (ts: number) => {
      if (ts - lastUpdate > 80) {
        lastUpdate = ts;
        setWaveformBars(prev => prev.map(() => 0.2 + Math.random() * 0.8));
      }
      waveformAnimRef.current = requestAnimationFrame(animate);
    };
    waveformAnimRef.current = requestAnimationFrame(animate);
    return () => {
      if (waveformAnimRef.current) cancelAnimationFrame(waveformAnimRef.current);
    };
  }, [isRecording]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSendMessage({ message: text.trim(), replyTo: replyingTo?.id });
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    if (onCancelReply) onCancelReply();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (navigator.maxTouchPoints > 0) return; // mobile: let Enter insert newline
      e.preventDefault();
      handleSend();
    }
    // Shift+Enter will naturally insert newline and trigger onChange -> auto-resize
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
    const mimeType = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
      .find(m => MediaRecorder.isTypeSupported(m));
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
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
      const mime = recorder.mimeType || 'audio/ogg';
      const ext = mime.includes('webm') ? 'webm' : 'ogg';
      const filename = `voice-message.${ext}`;
      const blob = new Blob(audioChunksRef.current, { type: mime });
      setIsUploading(true);
      try {
        const url = await uploadToBackend(blob, filename);
        onSendMessage({
          voiceNote: true,
          attachmentType: 'audio',
          attachmentName: filename,
          attachmentUrl: url,
          replyTo: replyingTo?.id,
        });
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

  const handleAnnotatorConfirm = async (blob: Blob) => {
    setAnnotatorFile(null);
    setIsUploading(true);
    try {
      const url = await uploadToBackend(blob, 'annotated-image.png');
      onSendMessage({
        message: text.trim() || '',
        attachmentUrl: url,
        attachmentType: 'image',
        attachmentName: 'annotated-image.png',
        replyTo: replyingTo?.id,
      });
      setText('');
      if (onCancelReply) onCancelReply();
    } catch (err) {
      console.error('Annotated image upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    let attachmentType: 'image' | 'audio' | 'video' | 'file' = 'file';
    if (file.type.startsWith('image/')) attachmentType = 'image';
    else if (file.type.startsWith('audio/')) attachmentType = 'audio';
    else if (file.type.startsWith('video/')) attachmentType = 'video';
    setShowAttachMenu(false);
    if (mediaFileInputRef.current) mediaFileInputRef.current.value = '';
    if (docFileInputRef.current) docFileInputRef.current.value = '';

    if (attachmentType === 'image') {
      setAnnotatorFile(file);
      return;
    }

    setIsUploading(true);
    try {
      const url = await uploadToBackend(file, file.name);
      onSendMessage({
        message: text.trim() || file.name,
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
    <>
    {annotatorFile && (
      <ImageAnnotator
        file={annotatorFile}
        onConfirm={handleAnnotatorConfirm}
        onCancel={() => setAnnotatorFile(null)}
      />
    )}
    <div
      className="bg-[#f0f2f5] dark:bg-[#202c33] border-t border-[#e9edef] dark:border-[#222e35] px-3 pt-2 pb-2 relative flex flex-col"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {/* Reply Preview */}
      {replyingTo && (
        <div className="animate-in slide-in-from-top-1 fade-in duration-75 flex items-center justify-between bg-white dark:bg-[#182229] border-s-4 border-[#00a884] p-2.5 mb-2 rounded text-xs shadow-sm">
          <div className="flex flex-col min-w-0 pe-2">
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

      {/* Interactive Message Composer */}
      {showInteractiveComposer && (
        <div className="mb-2 bg-white dark:bg-[#233138] rounded-xl shadow-2xl border border-gray-200 dark:border-[#2a3942] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-[#2a3942]">
            <span className="text-sm font-semibold text-gray-700 dark:text-[#e9edef]">⚡ {t.interactive_template}</span>
            <button type="button" onClick={() => setShowInteractiveComposer(false)} className="text-gray-400 dark:text-[#8696a0] hover:text-gray-700 dark:hover:text-[#e9edef] p-1">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          {/* Tab switcher */}
          <div className="flex border-b border-gray-100 dark:border-[#2a3942]">
            {(['buttons', 'list'] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => setInteractiveTab(tab)}
                className={`flex-1 py-2 text-xs font-medium transition ${interactiveTab === tab ? 'text-[#00a884] border-b-2 border-[#00a884]' : 'text-gray-400 dark:text-[#8696a0] hover:text-gray-600 dark:hover:text-[#e9edef]'}`}>
                {tab === 'buttons' ? '🔘 Reply Buttons' : '📋 List Message'}
              </button>
            ))}
          </div>
          <div className="p-4 flex flex-col gap-3">
            {/* Body text */}
            <div>
              <label className="text-xs text-gray-500 dark:text-[#8696a0] mb-1 block">Message body</label>
              <textarea value={interactiveBody} onChange={e => setInteractiveBody(e.target.value)} rows={2}
                placeholder="Type your message..."
                className="w-full rounded-lg border border-gray-200 dark:border-[#2a3942] bg-gray-50 dark:bg-[#182229] text-sm text-gray-800 dark:text-[#e9edef] px-3 py-2 resize-none focus:outline-none focus:border-[#00a884]" />
            </div>

            {interactiveTab === 'buttons' ? (
              <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-500 dark:text-[#8696a0]">Buttons (max 3)</label>
                {interactiveButtons.map((btn, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={btn.title} onChange={e => {
                        const next = [...interactiveButtons];
                        next[i] = { title: e.target.value.slice(0, 20) };
                        setInteractiveButtons(next);
                      }}
                      placeholder={`Button ${i + 1} title`} maxLength={20}
                      className="flex-1 rounded-lg border border-gray-200 dark:border-[#2a3942] bg-gray-50 dark:bg-[#182229] text-sm text-gray-800 dark:text-[#e9edef] px-3 py-1.5 focus:outline-none focus:border-[#00a884]" />
                    {interactiveButtons.length > 1 && (
                      <button type="button" onClick={() => setInteractiveButtons(interactiveButtons.filter((_, j) => j !== i))}
                        className="text-gray-400 dark:text-[#8696a0] hover:text-red-400 p-1">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                  </div>
                ))}
                {interactiveButtons.length < 3 && (
                  <button type="button" onClick={() => setInteractiveButtons([...interactiveButtons, { title: '' }])}
                    className="text-xs text-[#00a884] hover:text-[#06cf9c] self-start">+ Add button</button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div>
                  <label className="text-xs text-gray-500 dark:text-[#8696a0] mb-1 block">Section title</label>
                  <input value={listSectionTitle} onChange={e => setListSectionTitle(e.target.value)} placeholder="e.g. Options"
                    className="w-full rounded-lg border border-gray-200 dark:border-[#2a3942] bg-gray-50 dark:bg-[#182229] text-sm text-gray-800 dark:text-[#e9edef] px-3 py-1.5 focus:outline-none focus:border-[#00a884]" />
                </div>
                <label className="text-xs text-gray-500 dark:text-[#8696a0]">Rows (max 5)</label>
                {listRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 flex gap-2">
                      <input value={row.title} onChange={e => { const next = [...listRows]; next[i] = { ...next[i], title: e.target.value.slice(0, 24) }; setListRows(next); }}
                        placeholder="Title" maxLength={24}
                        className="flex-1 rounded-lg border border-gray-200 dark:border-[#2a3942] bg-gray-50 dark:bg-[#182229] text-sm text-gray-800 dark:text-[#e9edef] px-3 py-1.5 focus:outline-none focus:border-[#00a884]" />
                      <input value={row.description} onChange={e => { const next = [...listRows]; next[i] = { ...next[i], description: e.target.value }; setListRows(next); }}
                        placeholder="Description (optional)"
                        className="flex-1 rounded-lg border border-gray-200 dark:border-[#2a3942] bg-gray-50 dark:bg-[#182229] text-sm text-gray-800 dark:text-[#e9edef] px-3 py-1.5 focus:outline-none focus:border-[#00a884]" />
                    </div>
                    {listRows.length > 1 && (
                      <button type="button" onClick={() => setListRows(listRows.filter((_, j) => j !== i))}
                        className="text-gray-400 dark:text-[#8696a0] hover:text-red-400 p-1">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                  </div>
                ))}
                {listRows.length < 5 && (
                  <button type="button" onClick={() => setListRows([...listRows, { title: '', description: '' }])}
                    className="text-xs text-[#00a884] hover:text-[#06cf9c] self-start">+ Add row</button>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={disabled || !interactiveBody.trim() || (interactiveTab === 'buttons' && interactiveButtons.every(b => !b.title.trim())) || (interactiveTab === 'list' && listRows.every(r => !r.title.trim()))}
              onClick={() => {
                if (interactiveTab === 'buttons') {
                  const validBtns = interactiveButtons.filter(b => b.title.trim());
                  if (!validBtns.length) return;
                  onSendMessage({ message: interactiveBody.trim(), buttons: validBtns.map(b => ({ type: 'postback', title: b.title.trim(), payload: b.title.trim().toLowerCase().replace(/\s+/g, '_') })) });
                } else {
                  const validRows = listRows.filter(r => r.title.trim());
                  if (!validRows.length) return;
                  onSendMessage({ message: interactiveBody.trim(), interactive: { type: 'list', body: { text: interactiveBody.trim() }, action: { button: 'Select', sections: [{ title: listSectionTitle || 'Options', rows: validRows.map((r, i) => ({ id: `row_${i}`, title: r.title.trim(), description: r.description || undefined })) }] } } });
                }
                setShowInteractiveComposer(false);
                setInteractiveBody('');
                setInteractiveButtons([{ title: '' }, { title: '' }]);
                setListRows([{ title: '', description: '' }]);
                setListSectionTitle('');
              }}
              className="w-full py-2 rounded-lg bg-[#00a884] hover:bg-[#06cf9c] text-white text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send Interactive Message
            </button>
          </div>
        </div>
      )}


      {/* Hidden file inputs for Photos & Videos and Documents */}
      <input ref={mediaFileInputRef} type="file" accept="image/*,video/*" onChange={handleFileUpload} className="hidden" />
      <input ref={docFileInputRef} type="file" accept="application/*,audio/*,text/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.zip,.rar,.7z" onChange={handleFileUpload} className="hidden" />

      {/* Input Row */}
      <div className="flex items-end gap-2">
        {isRecording ? (
          <div className="flex-1 flex items-center justify-between bg-gray-100 dark:bg-[#111b21] rounded-lg px-4 py-2 text-gray-700 dark:text-[#e9edef]">
            <div className="flex items-center gap-2">
              <div className="flex items-end gap-[2px] h-5">
                {waveformBars.map((h, i) => (
                  <div
                    key={i}
                    className="w-[3px] rounded-full bg-red-500 transition-all duration-75"
                    style={{ height: `${h * 100}%`, minHeight: '3px' }}
                  />
                ))}
              </div>
              <span className="text-sm font-mono text-red-500">
                {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => stopRecording(true)} className="text-red-400 hover:text-red-500 text-xs font-semibold px-2 py-1">{t.cancel}</button>
              <button type="button" onClick={() => stopRecording(false)} disabled={isUploading} className="w-8 h-8 rounded-full bg-[#00a884] flex items-center justify-center text-white hover:opacity-90 disabled:opacity-50">
                {isUploading ? (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 rtl:scale-x-[-1]" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
                )}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Pill: emoji + textarea + attach + camera */}
            <div
              className={`flex-1 bg-white dark:bg-[#2a3942] rounded-[36px] px-3 py-2 flex items-end gap-2 min-h-[44px] ${disabled ? 'opacity-80' : ''}`}
              title={disabled ? disabledTooltip : undefined}
            >
              <button
                type="button"
                disabled={disabled || isUploading}
                className={`text-[#8696a0] hover:text-[#54656f] dark:hover:text-[#e9edef] shrink-0 pb-0.5 transition ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                title={t.emoji}
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                  <line x1="9" y1="9" x2="9.01" y2="9" />
                  <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
              </button>

              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={onFocus}
                onBlur={onBlur}
                rows={1}
                disabled={disabled}
                placeholder={disabled ? (disabledTooltip || t.view_only_mode) : resolvedPlaceholder}
                className="flex-1 bg-transparent text-[#111b21] dark:text-[#e9edef] text-sm placeholder-[#8696a0] dark:placeholder-[#8696a0] outline-none resize-none overflow-y-auto leading-relaxed select-text disabled:cursor-not-allowed scroll-smooth self-center"
              />

              {!text.trim() && (
                <div className="flex items-end gap-3 shrink-0 pb-0.5">
                  {/* Paperclip + its popover — co-located so popover anchors to the button */}
                  <div className="relative mb-1" ref={attachMenuRef}>
                    <button
                      type="button"
                      onClick={() => setShowAttachMenu((p) => !p)}
                      disabled={disabled || isUploading}
                      className={`transition ${showAttachMenu ? 'text-[#00a884]' : 'text-[#8696a0] hover:text-[#54656f] dark:hover:text-[#e9edef]'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                      title={t.attach_file}
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
                    {showAttachMenu && (
                      <div className="absolute bottom-full end-0 mb-2 bg-white dark:bg-[#233138] rounded-xl shadow-2xl p-2 flex flex-col gap-2 z-50 border border-gray-200 dark:border-[#2a3942] animate-in fade-in slide-in-from-bottom-2 duration-75">
                        <button type="button" onClick={() => { setShowAttachMenu(false); docFileInputRef.current?.click(); }} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#182229] text-sm text-gray-700 dark:text-[#e9edef] transition">
                          <span className="w-8 h-8 rounded-full bg-[#5f66cd] flex items-center justify-center text-white">📄</span>
                          <span>{t.document}</span>
                        </button>
                        {interactiveEnabled && (
                          <button
                            type="button"
                            onClick={() => { setShowAttachMenu(false); setShowInteractiveComposer(true); }}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#182229] text-sm text-gray-700 dark:text-[#e9edef] transition"
                          >
                            <span className="w-8 h-8 rounded-full bg-[#00a884] flex items-center justify-center text-white">⚡</span>
                            <span>{t.interactive_template}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { mediaFileInputRef.current?.click(); }}
                    disabled={disabled || isUploading}
                    className={`text-[#8696a0] hover:text-[#54656f] dark:hover:text-[#e9edef] transition ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    title="Photo / Video"
                  >
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  </button>
                </div>
              )}

            </div>

            {/* Mic / Send — outside pill, standalone green circle */}
            {text.trim() ? (
              <button
                key="send"
                type="button"
                onClick={handleSend}
                disabled={disabled || isUploading}
                className="animate-in zoom-in-75 duration-75 w-11 h-11 rounded-full bg-[#00a884] flex items-center justify-center text-white hover:opacity-90 transition shrink-0 shadow disabled:opacity-50 disabled:cursor-not-allowed"
                title={disabled && disabledTooltip ? disabledTooltip : t.send_message}
              >
                <svg className="w-5 h-5 ltr:translate-x-0.5 rtl:-translate-x-0.5 rtl:scale-x-[-1]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            ) : (
              <button
                key="mic"
                type="button"
                onClick={startRecording}
                disabled={disabled || isUploading}
                className="animate-in zoom-in-75 duration-75 w-11 h-11 rounded-full bg-[#00a884] flex items-center justify-center text-white hover:opacity-90 transition shrink-0 shadow disabled:opacity-50 disabled:cursor-not-allowed"
                title={disabled && disabledTooltip ? disabledTooltip : t.record_voice_note}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </button>
            )}
          </>
        )}
      </div>
    </div>
    </>
  );
};
