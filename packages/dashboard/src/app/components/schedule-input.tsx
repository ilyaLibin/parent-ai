'use client';

import { useState } from 'react';
import cronstrue from 'cronstrue';

interface ScheduleInputProps {
  value: string;
  onChange: (cron: string) => void;
}

function isValidCron(text: string): boolean {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => /^[\d,\-\*\/]+$/.test(p));
}

function describeSchedule(schedule: string): string {
  try {
    return cronstrue.toString(schedule, { use24HourTimeFormat: false });
  } catch {
    return '';
  }
}

export function ScheduleInput({ value, onChange }: ScheduleInputProps) {
  const [input, setInput] = useState(value);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function translate() {
    setError(null);
    setTranslating(true);
    try {
      const res = await fetch('/api/cron-jobs/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Translation failed');
      } else {
        setPreview(data.expression);
      }
    } catch {
      setError('Network error');
    } finally {
      setTranslating(false);
    }
  }

  function acceptPreview() {
    if (preview) {
      onChange(preview);
      setInput(preview);
      setPreview(null);
    }
  }

  function handleInputChange(text: string) {
    setInput(text);
    setPreview(null);
    setError(null);
    if (isValidCron(text)) {
      onChange(text);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="e.g. 0 20 * * 0-4 or 'Every weekday at 8 PM'"
          className="flex-1 input-inset rounded-lg px-3 py-2 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !translating && !isValidCron(input)) translate();
          }}
          disabled={translating}
        />
        {!isValidCron(input) && (
          <button
            onClick={translate}
            disabled={translating || !input.trim()}
            className="btn-raised rounded-lg px-3 py-2 text-sm disabled:opacity-50"
          >
            {translating ? '...' : 'Translate'}
          </button>
        )}
      </div>

      {preview && (
        <div className="flex gap-2 items-center">
          <code className="text-success bg-inset px-2 py-1 rounded text-xs border border-border">{preview}</code>
          <span className="text-xs text-fg-muted">{describeSchedule(preview)}</span>
          <button onClick={acceptPreview} className="text-success hover:opacity-80 text-xs font-medium">
            Accept
          </button>
          <button onClick={() => setPreview(null)} className="text-fg-muted hover:text-fg-secondary text-xs">
            Dismiss
          </button>
        </div>
      )}

      {!preview && isValidCron(value) && (
        <div className="text-xs text-fg-muted">{describeSchedule(value)}</div>
      )}

      {error && <div className="text-xs text-error">{error}</div>}
    </div>
  );
}
