import { RunsTable } from '../../../runs/runs-table';
import { PageHeader } from '../../../components/page-header';

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

async function getTask(id: string): Promise<Task | null> {
  const res = await fetch(`${API_URL}/cron-jobs/${id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function getRuns(taskId: string): Promise<TaskRun[]> {
  const res = await fetch(`${API_URL}/task-runs?taskId=${taskId}&limit=50`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function TaskRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [task, runs] = await Promise.all([getTask(id), getRuns(id)]);

  if (!task) return <p className="text-fg-muted">Task not found.</p>;

  return (
    <div>
      <PageHeader title={`${task.name} — runs`} backHref="/tasks" />

      {runs.length === 0 ? (
        <p className="text-fg-muted">No runs yet.</p>
      ) : (
        <RunsTable runs={runs} showTask={false} />
      )}
    </div>
  );
}
