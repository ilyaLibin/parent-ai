import { RunDetail } from './run-detail';
import { PageHeader } from '../../../../components/page-header';

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

const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  haiku: { input: 0.80, output: 4.00 },
  sonnet: { input: 3.00, output: 15.00 },
  opus: { input: 15.00, output: 75.00 },
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

export default async function RunDetailPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const [task, run] = await Promise.all([getTask(id), getRun(runId)]);

  if (!task || !run) return <p className="text-fg-muted">Not found.</p>;

  const tokens = run.token_usage_json ? JSON.parse(run.token_usage_json) : null;

  return (
    <div>
      <PageHeader title={`Run #${run.id}`} backHref={`/tasks/${id}/runs`} />

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
            <span>{tokens.input_tokens} in / {tokens.output_tokens} out{tokens.cache_read_input_tokens ? ` (${tokens.cache_read_input_tokens} cached)` : ''}</span>
          </div>
        )}
        {estimateCost(run.model, tokens) && (
          <div>
            <span className="text-fg-muted text-xs uppercase tracking-wider">cost </span>
            <span>{estimateCost(run.model, tokens)}</span>
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
