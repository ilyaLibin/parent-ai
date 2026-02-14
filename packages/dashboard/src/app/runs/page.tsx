import { RunsTable } from './runs-table';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

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

export default async function RunsPage() {
  const [runs, tasks] = await Promise.all([getRuns(), getTasks()]);
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Task Runs</h2>

      {runs.length === 0 ? (
        <p className="text-fg-muted">No runs yet.</p>
      ) : (
        <RunsTable runs={runs} taskMap={taskMap} />
      )}
    </div>
  );
}
