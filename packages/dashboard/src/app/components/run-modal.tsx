'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { RunSteps } from './run-steps';

interface TaskRun {
  id: number;
  task_id: number;
  started_at: number;
  completed_at: number | null;
  success: number | null;
  error: string | null;
  steps_json: string | null;
  model: string | null;
}

interface RunModalProps {
  taskId: number;
  taskName: string;
  open: boolean;
  onClose: () => void;
}

export function RunModal({ taskId, taskName, open, onClose }: RunModalProps) {
  const [status, setStatus] = useState<'triggering' | 'polling' | 'done'>('triggering');
  const [run, setRun] = useState<TaskRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggeredAtRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      cleanup();
      return;
    }

    setStatus('triggering');
    setRun(null);
    setError(null);
    triggeredAtRef.current = Date.now();

    fetch(`/api/task/${taskId}/execute`, { method: 'POST' }).catch(() => {
      setError('Failed to trigger task');
    });

    setStatus('polling');
    timerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/task-runs?taskId=${taskId}&limit=1`);
        if (!res.ok) return;
        const runs: TaskRun[] = await res.json();
        if (runs.length === 0) return;

        const latest = runs[0];
        if (latest.started_at < triggeredAtRef.current - 5000) return;

        const detailRes = await fetch(`/api/task-runs/${latest.id}`);
        if (!detailRes.ok) return;
        const detail: TaskRun = await detailRes.json();
        setRun(detail);

        if (detail.completed_at) {
          setStatus('done');
          cleanup();
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);

    return cleanup;
  }, [open, taskId, cleanup]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 card-raised rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-fg text-sm">{taskName}</h3>
            {status === 'done' && run ? (
              run.success === 1 ? (
                <span className="text-xs px-2 py-0.5 rounded border border-success/30 text-success bg-success/10">ok</span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded border border-error/30 text-error bg-error/10">fail</span>
              )
            ) : (
              <span className="text-xs px-2 py-0.5 rounded border border-warning/30 text-warning bg-warning/10 animate-pulse">running</span>
            )}
          </div>
          <button onClick={onClose} className="btn-raised rounded p-1.5 text-fg-muted hover:text-fg">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="bg-error/10 border border-error/20 rounded-lg p-3 mb-4 text-sm text-error">
              {error}
            </div>
          )}

          {!run && !error && (
            <p className="text-fg-muted text-sm animate-pulse">triggering task...</p>
          )}

          {run && <RunSteps stepsJson={run.steps_json} />}

          {run?.error && (
            <div className="bg-error/10 border border-error/20 rounded-lg p-3 mt-4 text-sm text-error">
              {run.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
