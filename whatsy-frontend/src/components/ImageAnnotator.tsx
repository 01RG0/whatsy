import React, { useRef, useState, useEffect, useCallback } from 'react';

type Tool = 'pen' | 'highlight' | 'eraser' | 'crop' | 'text' | 'emoji';

interface Point { x: number; y: number }

interface ImageAnnotatorProps {
  file: File;
  onConfirm: (annotatedBlob: Blob) => void;
  onCancel: () => void;
}

const COLORS = [
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759',
  '#007aff', '#af52de', '#ffffff', '#000000',
];

const EMOJIS = ['😊','😂','❤️','👍','🔥','✨','🎉','😍','🙏','💯','😎','🤩','💪','🥰','😭','🤣','😱','🌟','💥','🎊'];

function getPoint(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const src = 'touches' in e ? (e.changedTouches[0] ?? e.touches[0]) : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top) * scaleY,
  };
}

const ImageAnnotator: React.FC<ImageAnnotatorProps> = ({ file, onConfirm, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#ff3b30');
  const [isSending, setIsSending] = useState(false);

  // Crop state
  const [cropRect, setCropRect] = useState<{x:number;y:number;w:number;h:number} | null>(null);
  const cropDragStartRef = useRef<{x:number;y:number} | null>(null);

  // Text overlay state
  const [textInput, setTextInput] = useState<{x:number;y:number;value:string} | null>(null);

  // Emoji state
  const [selectedEmoji, setSelectedEmoji] = useState('😊');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const undoStackRef = useRef<ImageData[]>([]);
  const isDrawingRef = useRef(false);

  // Lock body scroll while annotator is open (prevents Android pull-to-refresh)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  const lastPointRef = useRef<Point | null>(null);
  const prevPointRef = useRef<Point | null>(null);

  // Load image onto canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxW = window.innerWidth;
      const maxH = window.innerHeight - 170; // top bar (~60px) + bottom toolbar (~110px)
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.round(img.naturalWidth * scale);
      const cssH = Math.round(img.naturalHeight * scale);
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.scale(dpr, dpr);
      ctx.drawImage(img, 0, 0, cssW, cssH);
      URL.revokeObjectURL(url);
    };
    img.src = url;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); URL.revokeObjectURL(url); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const handleUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const prev = undoStackRef.current.pop();
    if (prev) ctx.putImageData(prev, 0, 0);
  }, []);

  const saveSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStackRef.current.push(snap);
    if (undoStackRef.current.length > 40) undoStackRef.current.shift();
  }, []);

  const applyStyle = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = 24;
    } else if (tool === 'highlight') {
      ctx.globalCompositeOperation = 'source-over';
      const hex = color.replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.4)`;
      ctx.lineWidth = 16;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
    }
  }, [tool, color]);

  const onPointerDown = useCallback((e: MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if ('touches' in e) e.preventDefault();

    if (tool === 'crop') {
      const rect = canvas.getBoundingClientRect();
      const src = 'touches' in e ? e.touches[0] : e as MouseEvent;
      cropDragStartRef.current = { x: src.clientX - rect.left, y: src.clientY - rect.top };
      setCropRect(null);
      return;
    }

    if (tool === 'text') {
      const rect = canvas.getBoundingClientRect();
      const src = 'touches' in e ? e.touches[0] : e as MouseEvent;
      setTextInput({ x: src.clientX - rect.left, y: src.clientY - rect.top, value: '' });
      return;
    }

    if (tool === 'emoji') {
      const pt = getPoint(e, canvas);
      const ctx = canvas.getContext('2d')!;
      saveSnapshot();
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '36px serif';
      ctx.fillText(selectedEmoji, pt.x, pt.y);
      return;
    }

    const pt = getPoint(e, canvas);
    saveSnapshot();
    isDrawingRef.current = true;
    lastPointRef.current = pt;
    prevPointRef.current = pt;
    const ctx = canvas.getContext('2d')!;
    applyStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  }, [applyStyle, saveSnapshot, tool, selectedEmoji]);

  const onPointerMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (tool === 'crop') {
      if (!cropDragStartRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      if ('touches' in e) e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const src = 'touches' in e ? e.touches[0] : e as MouseEvent;
      const displayX = src.clientX - rect.left;
      const displayY = src.clientY - rect.top;
      const start = cropDragStartRef.current;
      setCropRect({
        x: Math.min(start.x, displayX),
        y: Math.min(start.y, displayY),
        w: Math.abs(displayX - start.x),
        h: Math.abs(displayY - start.y),
      });
      return;
    }

    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if ('touches' in e) e.preventDefault();
    const ctx = canvas.getContext('2d')!;
    applyStyle(ctx);
    const curr = getPoint(e, canvas);
    const prev = lastPointRef.current!;
    // Quadratic bezier smoothing
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    prevPointRef.current = lastPointRef.current;
    lastPointRef.current = curr;
  }, [applyStyle, tool]);

  const onPointerUp = useCallback((e: MouseEvent | TouchEvent) => {
    if (tool === 'crop') {
      cropDragStartRef.current = null;
      return;
    }

    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if ('touches' in e) e.preventDefault();
    const ctx = canvas.getContext('2d')!;
    applyStyle(ctx);
    const curr = getPoint(e, canvas);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    isDrawingRef.current = false;
    lastPointRef.current = null;
    prevPointRef.current = null;
  }, [applyStyle, tool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    canvas.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('mouseleave', onPointerUp);
    canvas.addEventListener('touchstart', onPointerDown, { passive: false });
    canvas.addEventListener('touchmove', onPointerMove, { passive: false });
    canvas.addEventListener('touchend', onPointerUp, { passive: false });
    return () => {
      canvas.removeEventListener('mousedown', onPointerDown);
      canvas.removeEventListener('mousemove', onPointerMove);
      canvas.removeEventListener('mouseup', onPointerUp);
      canvas.removeEventListener('mouseleave', onPointerUp);
      canvas.removeEventListener('touchstart', onPointerDown);
      canvas.removeEventListener('touchmove', onPointerMove);
      canvas.removeEventListener('touchend', onPointerUp);
    };
  }, [onPointerDown, onPointerMove, onPointerUp]);

  const handleSend = () => {
    const canvas = canvasRef.current;
    if (!canvas || isSending) return;
    setIsSending(true);
    canvas.toBlob((blob) => {
      if (blob) {
        onConfirm(blob);
      } else {
        setIsSending(false);
      }
    }, 'image/png');
  };

  const applyCrop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cropRect) return;
    const ctx = canvas.getContext('2d')!;
    const scaleX = canvas.width / canvas.offsetWidth;
    const scaleY = canvas.height / canvas.offsetHeight;
    const sx = Math.round(cropRect.x * scaleX);
    const sy = Math.round(cropRect.y * scaleY);
    const sw = Math.round(cropRect.w * scaleX);
    const sh = Math.round(cropRect.h * scaleY);
    if (sw <= 0 || sh <= 0) return;
    saveSnapshot();
    const imageData = ctx.getImageData(sx, sy, sw, sh);
    canvas.width = sw;
    canvas.height = sh;
    canvas.style.width = `${Math.round(cropRect.w)}px`;
    canvas.style.height = `${Math.round(cropRect.h)}px`;
    ctx.putImageData(imageData, 0, 0);
    setCropRect(null);
    setTool('pen');
  }, [cropRect, saveSnapshot]);

  const toolButtons: { id: Tool; label: string; icon: React.ReactNode }[] = [
    {
      id: 'pen',
      label: 'Draw',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
        </svg>
      ),
    },
    {
      id: 'highlight',
      label: 'Highlight',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 11l-4 4 2 3 3-1 4-4"/>
          <path d="M11.5 6.5l6 6"/>
          <path d="M15 3l6 6-9.5 9.5-3-3L15 3z"/>
        </svg>
      ),
    },
    {
      id: 'eraser',
      label: 'Eraser',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 20H7L3 16l13-13 7 7-2.5 2.5"/>
          <path d="M6.5 17.5l4-4"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden" style={{ touchAction: 'none', overscrollBehavior: 'none' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-3 shrink-0 bg-black">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center justify-center w-10 h-10 rounded-full text-white hover:bg-white/10 transition"
          aria-label="Cancel"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>

        <button
          type="button"
          onClick={handleSend}
          disabled={isSending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#00a884] hover:bg-[#06cf9c] text-white text-sm font-semibold transition disabled:opacity-60 active:scale-95"
        >
          {isSending ? (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/>
              <path d="M12 2a10 10 0 0 1 10 10"/>
            </svg>
          ) : (
            <svg className="w-4 h-4 rtl:scale-x-[-1]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          )}
          <span>Send</span>
        </button>
      </div>

      {/* Canvas area — fills remaining space */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-full"
            style={{ cursor: tool === 'text' ? 'text' : 'crosshair', touchAction: 'none', display: 'block' }}
          />
          {/* Crop selection overlay */}
          {cropRect && tool === 'crop' && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: cropRect.x,
                top: cropRect.y,
                width: cropRect.w,
                height: cropRect.h,
                border: '2px dashed white',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
              }}
            />
          )}
          {/* Text input overlay */}
          {textInput && tool === 'text' && (
            <textarea
              autoFocus
              value={textInput.value}
              rows={1}
              onChange={(e) => setTextInput(prev => prev ? { ...prev, value: e.target.value } : null)}
              style={{
                position: 'absolute',
                left: textInput.x,
                top: textInput.y,
                background: 'transparent',
                border: '1px dashed white',
                color: color,
                fontSize: '20px',
                minWidth: '100px',
                resize: 'none',
                outline: 'none',
              }}
              onBlur={() => {
                const canvas = canvasRef.current;
                if (!canvas || !textInput || !textInput.value.trim()) { setTextInput(null); return; }
                const ctx = canvas.getContext('2d')!;
                const scaleX = canvas.width / canvas.offsetWidth;
                const scaleY = canvas.height / canvas.offsetHeight;
                saveSnapshot();
                ctx.font = '24px Arial';
                ctx.fillStyle = color;
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillText(textInput.value, textInput.x * scaleX, (textInput.y + 20) * scaleY);
                setTextInput(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
            />
          )}
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="shrink-0 bg-black" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {/* Apply Crop button — shown only when crop tool is active and a rect is drawn */}
        {tool === 'crop' && cropRect && cropRect.w > 5 && cropRect.h > 5 && (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={applyCrop}
              className="px-5 py-1.5 rounded-full bg-white text-gray-900 text-sm font-semibold"
            >
              Apply Crop
            </button>
          </div>
        )}

        {/* Emoji picker panel */}
        {showEmojiPicker && tool === 'emoji' && (
          <div className="flex justify-center pb-1">
            <div className="bg-gray-900 rounded-xl p-2 grid grid-cols-10 gap-0.5">
              {EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => { setSelectedEmoji(em); setShowEmojiPicker(false); }}
                  className="w-8 h-8 text-lg hover:bg-white/20 rounded flex items-center justify-center"
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tool + undo row */}
        <div className="flex items-center justify-center gap-1 px-4 py-2">
          {toolButtons.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTool(tb.id)}
              title={tb.label}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                tool === tb.id
                  ? 'bg-white text-gray-900 scale-105'
                  : 'text-white hover:bg-white/15'
              }`}
            >
              {tb.icon}
            </button>
          ))}
          <div className="w-px h-7 bg-white/20 mx-1" />
          <button
            type="button"
            onClick={handleUndo}
            title="Undo (Ctrl+Z)"
            className="w-11 h-11 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 14 4 9 9 4"/>
              <path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
            </svg>
          </button>
          <div className="w-px h-7 bg-white/20 mx-1" />
          {/* Crop tool */}
          <button
            type="button"
            onClick={() => setTool('crop')}
            title="Crop"
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
              tool === 'crop' ? 'bg-white text-gray-900 scale-105' : 'text-white hover:bg-white/15'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14" />
            </svg>
          </button>
          {/* Text tool */}
          <button
            type="button"
            onClick={() => setTool('text')}
            title="Add text"
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all font-bold text-sm ${
              tool === 'text' ? 'bg-white text-gray-900 scale-105' : 'text-white hover:bg-white/15'
            }`}
          >
            T
          </button>
          {/* Emoji tool */}
          <button
            type="button"
            onClick={() => { setTool('emoji'); setShowEmojiPicker(p => !p); }}
            title="Emoji"
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all text-lg ${
              tool === 'emoji' ? 'bg-white/30 scale-105' : 'hover:bg-white/15'
            }`}
          >
            {selectedEmoji}
          </button>
        </div>

        {/* Color swatches */}
        <div className="flex items-center justify-center gap-3 px-4 pb-3">
          {COLORS.map((c) => {
            const isSelected = color === c && tool !== 'eraser';
            return (
              <button
                key={c}
                type="button"
                onClick={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }}
                aria-label={c}
                className="transition-transform active:scale-90"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  backgroundColor: c,
                  border: isSelected ? '2.5px solid white' : '2px solid rgba(255,255,255,0.25)',
                  transform: isSelected ? 'scale(1.2)' : 'scale(1)',
                  outline: isSelected ? '2px solid rgba(0,0,0,0.4)' : 'none',
                  outlineOffset: 1,
                  flexShrink: 0,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ImageAnnotator;
