'use client';

import { useEffect } from 'react';
import { MentionInput } from './mention-input';

function useBodyScrollLock() {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);
}

interface FullscreenEditorProps {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}

export function FullscreenEditor({ value, onChange, onClose }: FullscreenEditorProps) {
  useBodyScrollLock();

  return (
    <div className="fixed inset-0 z-50 bg-surface flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-sm font-medium text-fg">Prompt</span>
        <button
          onClick={onClose}
          className="btn-accent rounded-lg px-4 py-1.5 text-sm font-medium"
        >
          Done
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col min-h-0 p-4">
        <MentionInput
          value={value}
          onChange={onChange}
          autoFocus
          className="flex-1 w-full input-inset rounded-lg px-3 py-2 text-sm resize-none font-content"
          placeholder="Define what the agent should do — type @ to reference groups or knowledge..."
        />
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <p className="text-xs text-fg-muted">
          {'Supports: {{today}}, {{tomorrow}}, {{date}}, {{datetime}}, @mentions'}
        </p>
      </div>
    </div>
  );
}

interface FullscreenTextareaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  placeholder?: string;
}

export function FullscreenTextarea({ label, value, onChange, onClose, placeholder }: FullscreenTextareaProps) {
  useBodyScrollLock();

  return (
    <div className="fixed inset-0 z-50 bg-surface flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-sm font-medium text-fg">{label}</span>
        <button
          onClick={onClose}
          className="btn-accent rounded-lg px-4 py-1.5 text-sm font-medium"
        >
          Done
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0 p-4">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
          className="flex-1 w-full input-inset rounded-lg px-3 py-2 text-sm resize-none font-content"
          placeholder={placeholder}
          dir="auto"
        />
      </div>
    </div>
  );
}
