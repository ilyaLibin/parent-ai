'use client';

import { useState, useRef } from 'react';
import { MentionInput } from './mention-input';
import { RunSteps } from './run-steps';

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
  const [stepsJson, setStepsJson] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isImprove = type === 'improve-prompt';
  const label = isImprove ? 'Improve' : 'Generate';

  async function handleGenerate() {
    if (!instructions.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setStepsJson(null);

    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          instructions: instructions.trim(),
          currentContent: currentContent || undefined,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Request failed');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'steps') {
              setStepsJson(JSON.stringify(event.steps));
            } else if (event.type === 'done') {
              setResult(event.result);
              setStepsJson(JSON.stringify(event.steps));
            } else if (event.type === 'error') {
              throw new Error(event.error);
            }
          } catch (e: any) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Something went wrong');
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function handleApply() {
    if (result) {
      onApply(result);
      handleClose();
    }
  }

  function handleClose() {
    if (abortRef.current) abortRef.current.abort();
    setInstructions('');
    setResult(null);
    setStepsJson(null);
    setError(null);
    setLoading(false);
    onClose();
  }

  function handleRetry() {
    setResult(null);
    setStepsJson(null);
    setError(null);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative z-10 card-raised rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-fg text-sm">
              {isImprove ? 'Improve Prompt' : 'Generate Knowledge'}
            </h3>
            {loading && (
              <span className="text-xs px-2 py-0.5 rounded border border-warning/30 text-warning bg-warning/10 animate-pulse">
                running
              </span>
            )}
            {result && (
              <span className="text-xs px-2 py-0.5 rounded border border-success/30 text-success bg-success/10">
                done
              </span>
            )}
          </div>
          <button onClick={handleClose} className="btn-raised rounded p-1.5 text-fg-muted hover:text-fg">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Instructions input */}
          {!loading && !result && (
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
          )}

          {/* Generate button */}
          {!loading && !result && (
            <button
              onClick={handleGenerate}
              disabled={!instructions.trim()}
              className="self-start btn-accent rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              {label}
            </button>
          )}

          {/* Error */}
          {error && (
            <div className="bg-error/10 border border-error/20 rounded-lg p-3 text-sm text-error">
              {error}
            </div>
          )}

          {/* Live steps */}
          {stepsJson && <RunSteps stepsJson={stepsJson} />}

          {/* Action buttons when done */}
          {result && (
            <div className="flex gap-2 pt-2 border-t border-border">
              <button
                onClick={handleApply}
                className="btn-accent rounded-lg px-4 py-2 text-sm font-medium"
              >
                Apply
              </button>
              <button
                onClick={handleRetry}
                className="btn-raised rounded-lg px-4 py-2 text-sm font-medium"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
