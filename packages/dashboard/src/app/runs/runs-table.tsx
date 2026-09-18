'use client';

import { useRouter } from 'next/navigation';

const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  haiku: { input: 0.80, output: 4.00 },
  sonnet: { input: 3.00, output: 15.00 },
  opus: { input: 15.00, output: 75.00 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
};

function estimateCost(model: string | null, tokens: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } | null): string | null {
  if (!tokens || !model) return null;
  const prices = PRICE_PER_M[model];
  if (!prices) return null;
  const cacheWrite = tokens.cache_creation_input_tokens || 0;
  const cacheRead = tokens.cache_read_input_tokens || 0;
  const nonCachedInput = tokens.input_tokens - cacheWrite - cacheRead;
  const cost = (nonCachedInput * prices.input + cacheWrite * prices.input * 1.25 + cacheRead * prices.input * 0.1 + tokens.output_tokens * prices.output) / 1_000_000;
  if (cost < 0.005) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

interface TaskRun {
  id: number;
  task_id: number;
  started_at: number;
  completed_at: number | null;
  success: number | null;
  error: string | null;
  model: string | null;
  token_usage_json: string | null;
  prompt: string | null;
}

interface Task {
  id: number;
  name: string;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('en-IL', { timeZone: 'Asia/Jerusalem' });
}

function formatDuration(start: number, end: number | null): string {
  if (!end) return 'running...';
  const s = Math.round((end - start) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function RunsTable({ runs, taskMap, showTask = true }: { runs: TaskRun[]; taskMap?: Map<number, Task>; showTask?: boolean }) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto card-raised rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-fg-muted text-xs uppercase tracking-wider">
            {showTask && <th className="py-3 px-4">Task</th>}
            <th className="py-3 px-4">Prompt</th>
            <th className="py-3 px-4">Started</th>
            <th className="py-3 px-4">Duration</th>
            <th className="py-3 px-4">Status</th>
            <th className="py-3 px-4">Tokens</th>
            <th className="py-3 px-4">Cost</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const task = taskMap?.get(run.task_id);
            const tokens = run.token_usage_json ? JSON.parse(run.token_usage_json) : null;
            return (
              <tr
                key={run.id}
                onClick={() => router.push(`/tasks/${run.task_id}/runs/${run.id}`)}
                className="border-b border-border-subtle hover:bg-surface-hover cursor-pointer transition-colors"
              >
                {showTask && (
                  <td className="py-3 px-4 font-bold text-accent">
                    {task?.name || `#${run.task_id}`}
                  </td>
                )}
                <td className="py-3 px-4 text-fg-secondary max-w-xs truncate" title={run.prompt || undefined} dir="auto">
                  {run.prompt ? run.prompt.split('\n')[0].slice(0, 80) : '-'}
                </td>
                <td className="py-3 px-4 text-fg-secondary">{formatTime(run.started_at)}</td>
                <td className="py-3 px-4 text-fg-muted">{formatDuration(run.started_at, run.completed_at)}</td>
                <td className="py-3 px-4">
                  {run.success === 1 ? (
                    <span className="text-success">ok</span>
                  ) : run.success === 0 ? (
                    <span className="text-error" title={run.error || undefined}>fail</span>
                  ) : (
                    <span className="text-warning animate-pulse">running</span>
                  )}
                </td>
                <td className="py-3 px-4 text-fg-muted text-xs">
                  {tokens ? `${tokens.input_tokens + tokens.output_tokens}` : '-'}
                </td>
                <td className="py-3 px-4 text-fg-muted text-xs">
                  {estimateCost(run.model, tokens) || '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
