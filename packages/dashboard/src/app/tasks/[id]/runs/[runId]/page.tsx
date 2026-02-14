import Link from 'next/link';
import { RunDetail } from './run-detail';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

interface Task {
  id: number;
  name: string;
}

interface TaskRun {
  id: number;
  task_id: number;
  started_at: number;
  completed_at: number | null;
  success: number | null;
  error: string | null;
  steps_json: string | null;
  result_text: string | null;
  model: string | null;
  token_usage_json: string | null;
}

async function getTask(id: string): Promise<Task | null> {
  const res = await fetch(`${API_URL}/cron-jobs/${id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function getRun(runId: string): Promise<TaskRun | null> {
  const res = await fetch(`${API_URL}/task-runs/${runId}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
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

export default async function RunDetailPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const [task, run] = await Promise.all([getTask(id), getRun(runId)]);

  if (!task || !run) return <p className="text-fg-muted">Not found.</p>;

  const tokens = run.token_usage_json ? JSON.parse(run.token_usage_json) : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/tasks/${id}/runs`} className="text-fg-muted hover:text-fg transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-xl font-bold">{task.name} — run #{run.id}</h2>
      </div>

      <div className="flex flex-wrap gap-4 mb-6 text-sm card-raised rounded-lg px-4 py-3">
        <div>
          <span className="text-fg-muted text-xs uppercase tracking-wider">status </span>
          {run.success === 1 ? (
            <span className="text-success font-medium">ok</span>
          ) : run.success === 0 ? (
            <span className="text-error font-medium">fail</span>
          ) : (
            <span className="text-warning font-medium">running</span>
          )}
        </div>
        <div>
          <span className="text-fg-muted text-xs uppercase tracking-wider">model </span>
          <span>{run.model || '-'}</span>
        </div>
        <div>
          <span className="text-fg-muted text-xs uppercase tracking-wider">started </span>
          <span>{formatTime(run.started_at)}</span>
        </div>
        <div>
          <span className="text-fg-muted text-xs uppercase tracking-wider">duration </span>
          <span>{formatDuration(run.started_at, run.completed_at)}</span>
        </div>
        {tokens && (
          <div>
            <span className="text-fg-muted text-xs uppercase tracking-wider">tokens </span>
            <span>{tokens.input_tokens} in / {tokens.output_tokens} out</span>
          </div>
        )}
      </div>

      {run.error && (
        <div className="bg-error/10 border border-error/20 rounded-lg p-3 mb-6 text-sm text-error">
          {run.error}
        </div>
      )}

      <RunDetail stepsJson={run.steps_json} />
    </div>
  );
}
