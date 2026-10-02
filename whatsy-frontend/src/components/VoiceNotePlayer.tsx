import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';

// Custom event to pause other voice notes when one starts playing
const VOICE_NOTE_PLAY_EVENT = 'whatsy:voicenote:play';

function generateWaveformBars(messageId: string, count: number): number[] {
  // Simple seeded pseudo-random based on messageId
  let seed = 0;
  for (let i = 0; i < messageId.length; i++) {
    seed = ((seed << 5) - seed + messageId.charCodeAt(i)) | 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    seed = (seed * 16807 + 11) % 2147483647;
    const normalized = (seed & 0x7fffffff) / 2147483647;
    bars.push(0.2 + normalized * 0.8); // 20% to 100%
  }
  return bars;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SPEED_OPTIONS = [1, 1.5, 2] as const;

interface VoiceNotePlayerProps {
  src: string;
  isOutbound: boolean;
  messageId: string;
}

const VoiceNotePlayer: React.FC<VoiceNotePlayerProps> = ({ src, isOutbound, messageId }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [playError, setPlayError] = useState(false);
  const isDraggingRef = useRef(false);

  const BAR_COUNT = 36;
  const bars = useMemo(() => generateWaveformBars(messageId, BAR_COUNT), [messageId]);

  const progress = duration > 0 ? currentTime / duration : 0;

  // Accent colors
  const accentColor = isOutbound ? '#00a884' : '#8696a0';
  const playedBarClass = isOutbound
    ? 'bg-[#00a884]'
    : 'bg-[#8696a0]';
  const unplayedBarClass = isOutbound
    ? 'bg-[#00a884]/30 dark:bg-[#00a884]/25'
    : 'bg-[#8696a0]/30 dark:bg-[#8696a0]/25';

  // Pause this player when another voice note starts
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail !== messageId && audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
    };
    window.addEventListener(VOICE_NOTE_PLAY_EVENT, handler);
    return () => window.removeEventListener(VOICE_NOTE_PLAY_EVENT, handler);
  }, [messageId]);

  // Sync audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => setDuration(audio.duration);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => { setIsPlaying(false); setCurrentTime(0); };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      setIsPlaying(false);
      setPlayError(true);
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);

    // If metadata already loaded
    if (audio.duration) setDuration(audio.duration);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || playError) return;
    if (audio.paused) {
      // Notify other players to pause
      window.dispatchEvent(new CustomEvent(VOICE_NOTE_PLAY_EVENT, { detail: messageId }));
      audio.play().catch((err: Error) => {
        console.error('[VoiceNotePlayer] playback failed:', err);
        setPlayError(true);
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  }, [messageId, playError]);

  const handleWaveformClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const fraction = Math.max(0, Math.min(1, x / rect.width));
    audio.currentTime = fraction * duration;
    setCurrentTime(audio.currentTime);
  }, [duration]);

  const seekFromClientX = useCallback((clientX: number, container: HTMLDivElement) => {
    const rect = container.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const audio = audioRef.current;
    if (audio && duration > 0) {
      audio.currentTime = fraction * duration;
    }
  }, [duration]);

  const cycleSpeed = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = (speedIndex + 1) % SPEED_OPTIONS.length;
    setSpeedIndex(next);
    audio.playbackRate = SPEED_OPTIONS[next];
  }, [speedIndex]);

  const displayTime = (isPlaying || currentTime > 0) ? formatTime(currentTime) : formatTime(duration);

  // Render an expired/broken state when the media could not be loaded or played.
  if (playError) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Disabled play button */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 opacity-40"
          style={{ backgroundColor: accentColor }}
          aria-hidden="true"
        >
          <svg className="w-3.5 h-3.5 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>

        {/* Expired message */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-end gap-[1.5px] h-6">
            {bars.map((height, i) => (
              <div
                key={i}
                className={`rounded-full ${unplayedBarClass} opacity-40`}
                style={{ width: '2.5px', height: `${height * 100}%`, minHeight: '3px' }}
              />
            ))}
          </div>
          <span className="text-[10px] leading-none opacity-60 select-none">
            Voice message expired
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      {/* Play / Pause button */}
      <button
        type="button"
        onClick={togglePlay}
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-90"
        style={{ backgroundColor: accentColor }}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Waveform + info column */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Waveform bars */}
        <div
          className="relative flex items-end gap-[1.5px] h-6 cursor-pointer"
          onClick={handleWaveformClick}
          role="slider"
          aria-label="Audio progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          tabIndex={0}
          onMouseDown={(e) => { isDraggingRef.current = true; seekFromClientX(e.clientX, e.currentTarget); }}
          onMouseMove={(e) => { if (isDraggingRef.current) seekFromClientX(e.clientX, e.currentTarget); }}
          onMouseUp={() => { isDraggingRef.current = false; }}
          onMouseLeave={() => { isDraggingRef.current = false; }}
          onTouchStart={(e) => { e.preventDefault(); isDraggingRef.current = true; seekFromClientX(e.touches[0].clientX, e.currentTarget); }}
          onTouchMove={(e) => { e.preventDefault(); if (isDraggingRef.current) seekFromClientX(e.touches[0].clientX, e.currentTarget); }}
          onTouchEnd={() => { isDraggingRef.current = false; }}
          onKeyDown={(e) => {
            const audio = audioRef.current;
            if (!audio) return;
            if (e.key === 'ArrowRight') { e.preventDefault(); audio.currentTime = Math.min(duration, audio.currentTime + 5); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 5); }
          }}
        >
          {bars.map((height, i) => {
            const barProgress = i / BAR_COUNT;
            const isPlayed = barProgress < progress;
            return (
              <div
                key={i}
                className={`rounded-full transition-colors duration-100 ${isPlayed ? playedBarClass : unplayedBarClass}`}
                style={{
                  width: '2.5px',
                  height: `${height * 100}%`,
                  minHeight: '3px',
                }}
              />
            );
          })}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md pointer-events-none transition-[left] duration-75"
            style={{ left: `calc(${progress * 100}% - 5px)` }}
          />
        </div>

        {/* Duration + speed row */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] leading-none opacity-70 select-none">
            {displayTime}
          </span>
          <button
            type="button"
            onClick={cycleSpeed}
            className={`text-[10px] font-semibold leading-none px-1.5 py-0.5 rounded-full select-none transition-colors ${
              isOutbound
                ? 'bg-[#00a884]/20 text-[#00a884] dark:bg-[#00a884]/30 dark:text-[#00a884]'
                : 'bg-[#8696a0]/20 text-[#8696a0] dark:bg-[#8696a0]/30 dark:text-[#8696a0]'
            }`}
            aria-label="Playback speed"
          >
            {SPEED_OPTIONS[speedIndex]}x
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceNotePlayer;
