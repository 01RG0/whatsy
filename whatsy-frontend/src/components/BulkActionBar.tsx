import React, { useState, useRef, useEffect } from 'react';
import { useLabelStore } from '../store/useLabelStore';

interface BulkActionBarProps {
  selectedCount: number;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onBulkAssignLabel?: (labelId: string) => void;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  onSelectAll,
  onClearSelection,
  onBulkAssignLabel,
}) => {
  const { labels } = useLabelStore();
  const [showLabels, setShowLabels] = useState(false);
  const labelDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showLabels) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) {
        setShowLabels(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [showLabels]);

  return (
    <div className="px-3 py-2 bg-[#005c4b] flex items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-white text-sm font-medium">{selectedCount} selected</span>
        <button
          type="button"
          onClick={onSelectAll}
          className="text-xs text-[#d9fdd3] hover:text-white transition"
        >
          Select all
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="relative" ref={labelDropdownRef}>
          <button
            type="button"
            onClick={() => setShowLabels(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs font-medium transition"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
            Label
          </button>
          {showLabels && (
            <div className="absolute bottom-full mb-1 end-0 z-50 w-48 rounded-xl border border-[#e9edef] dark:border-[#374151] bg-white dark:bg-[#202c33] p-1.5 shadow-xl">
              {labels.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-400">No labels</p>
              ) : labels.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => { onBulkAssignLabel?.(label.id); setShowLabels(false); }}
                  className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-start text-sm text-gray-700 dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClearSelection}
          className="p-1 rounded-full hover:bg-white/20 text-white transition"
          title="Cancel"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  );
};
