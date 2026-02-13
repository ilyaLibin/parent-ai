import Link from 'next/link';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

interface TaskRun {
  id: number;
  task_id: number;
  started_at: number;
  completed_at: number | null;
  success: number | null;
  error: string | null;
  model: string | null;
  token_usage_json: string | null;
}

interface Task {
  id: number;
  name: string;
}

async function getRuns(): Promise<TaskRun[]> {
  const res = await fetch(`${API_URL}/task-runs?limit=100`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function getTasks(): Promise<Task[]> {
  const res = await fetch(`${API_URL}/cron-jobs`, { cache: 'no-store' });
  if (!res.ok) return [];
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

export default async function RunsPage() {
  const [runs, tasks] = await Promise.all([getRuns(), getTasks()]);
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Task Runs</h2>

      {runs.length === 0 ? (
        <p className="text-zinc-400">No runs yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-400">
                <th className="py-3 px-4">Task</th>
                <th className="py-3 px-4">Started</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Model</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Tokens</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const task = taskMap.get(run.task_id);
                const tokens = run.token_usage_json ? JSON.parse(run.token_usage_json) : null;
                return (
                  <tr key={run.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                    <td className="py-3 px-4 font-medium">
                      {task ? (
                        <Link href={`/tasks/${task.id}`} className="text-blue-400 hover:text-blue-300">
                          {task.name}
                        </Link>
                      ) : (
                        <span className="text-zinc-500">#{run.task_id}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-zinc-300">{formatTime(run.started_at)}</td>
                    <td className="py-3 px-4 text-zinc-400">{formatDuration(run.started_at, run.completed_at)}</td>
                    <td className="py-3 px-4 text-zinc-400">{run.model || '-'}</td>
                    <td className="py-3 px-4">
                      {run.success === 1 ? (
                        <span className="text-green-400">Success</span>
                      ) : run.success === 0 ? (
                        <span className="text-red-400" title={run.error || undefined}>Failed</span>
                      ) : (
                        <span className="text-yellow-400 animate-pulse">Running</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-zinc-500 text-xs">
                      {tokens ? `${tokens.input_tokens + tokens.output_tokens}` : '-'}
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/tasks/${run.task_id}/runs/${run.id}`}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
