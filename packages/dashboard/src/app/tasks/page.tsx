import { TasksPageTabs } from './tasks-page-tabs';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

export interface Task {
  id: number;
  name: string;
  schedule: string;
  endpoint: string;
  method: string;
  body: string | null;
  enabled: boolean;
  prompt: string | null;
  model: string | null;
  created_at: number;
  updated_at: number;
}

export interface TaskRun {
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

async function getTasks(): Promise<Task[]> {
  const res = await fetch(`${API_URL}/cron-jobs`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function getRuns(): Promise<TaskRun[]> {
  const res = await fetch(`${API_URL}/task-runs?limit=200`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function TasksPage() {
  const [tasks, runs] = await Promise.all([getTasks(), getRuns()]);

  // Build map of taskId -> latest run
  const lastRunMap: Record<number, TaskRun> = {};
  for (const run of runs) {
    if (!lastRunMap[run.task_id]) {
      lastRunMap[run.task_id] = run;
    }
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  return (
    <TasksPageTabs
      tasks={tasks}
      lastRunMap={lastRunMap}
      runs={runs}
      taskMap={taskMap}
    />
  );
}
