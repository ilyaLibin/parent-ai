import { TasksGrid } from './tasks-grid';

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
  system_prompt: string | null;
  user_prompt: string | null;
  model: string | null;
  created_at: number;
  updated_at: number;
}

async function getTasks(): Promise<Task[]> {
  const res = await fetch(`${API_URL}/cron-jobs`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function TasksPage() {
  const tasks = await getTasks();
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Tasks</h2>
      <TasksGrid initialTasks={tasks} />
    </div>
  );
}
