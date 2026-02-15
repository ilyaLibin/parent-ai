'use client';

import { useState } from 'react';
import { MentionInput } from './mention-input';

interface ImproveModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (text: string) => void;
  type: 'improve-prompt' | 'generate-knowledge';
  currentContent?: string;
}

export function ImproveModal({ open, onClose, onApply, type, currentContent }: ImproveModalProps) {
  const [instructions, setInstructions] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isImprove = type === 'improve-prompt';
  const label = isImprove ? 'Improve' : 'Generate';

  async function handleGenerate() {
    if (!instructions.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          instructions: instructions.trim(),
          currentContent: currentContent || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Request failed');
      }

      const data = await res.json();
      setResult(data.result);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function handleApply() {
    if (result) {
      onApply(result);
      handleClose();
    }
  }

  function handleClose() {
    setInstructions('');
    setResult(null);
    setError(null);
    setLoading(false);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative z-10 card-raised rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="font-bold text-fg text-sm">
            {isImprove ? 'Improve Prompt' : 'Generate Knowledge'}
          </h3>
          <button onClick={handleClose} className="btn-raised rounded p-1.5 text-fg-muted hover:text-fg">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Instructions input */}
          <div className="flex flex-col gap-1">
            <label className="block text-xs text-fg-muted uppercase tracking-wider">
              {isImprove ? 'How should the prompt be improved?' : 'What knowledge should be generated?'}
            </label>
            <MentionInput
              value={instructions}
              onChange={setInstructions}
              className="w-full input-inset rounded-lg px-3 py-2 text-sm resize-none min-h-[80px]"
              placeholder={
                isImprove
                  ? 'e.g. Make it more concise, add @knowledge reference...'
                  : 'e.g. Create a schedule for @group based on...'
              }
            />
          </div>

          {/* Generate button */}
          {!result && (
            <button
              onClick={handleGenerate}
              disabled={loading || !instructions.trim()}
              className="self-start btn-accent rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Working...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  {label}
                </>
              )}
            </button>
          )}

          {/* Error */}
          {error && (
            <div className="bg-error/10 border border-error/20 rounded-lg p-3 text-sm text-error">
              {error}
            </div>
          )}

          {/* Result preview */}
          {result && (
            <div className="flex flex-col gap-2">
              <label className="block text-xs text-fg-muted uppercase tracking-wider">Result</label>
              <pre className="w-full input-inset rounded-lg px-3 py-2 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                {result}
              </pre>
              <div className="flex gap-2">
                <button
                  onClick={handleApply}
                  className="btn-accent rounded-lg px-4 py-2 text-sm font-medium"
                >
                  Apply
                </button>
                <button
                  onClick={() => { setResult(null); setError(null); }}
                  className="btn-raised rounded-lg px-4 py-2 text-sm font-medium"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
