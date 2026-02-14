'use client';

import { useRouter } from 'next/navigation';

interface TaskRun {
  id: number;
  task_id: number;
  started_at: number;
  completed_at: number | null;
  success: number | null;
  error: string | null;
  token_usage_json: string | null;
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
            <th className="py-3 px-4">Started</th>
            <th className="py-3 px-4">Duration</th>
            <th className="py-3 px-4">Status</th>
            <th className="py-3 px-4">Tokens</th>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
