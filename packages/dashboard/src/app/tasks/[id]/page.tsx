import { TaskForm } from '../new/task-form';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

async function getTask(id: string) {
  const res = await fetch(`${API_URL}/cron-jobs/${id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTask(id);

  if (!task) {
    return <p className="text-zinc-400">Task not found.</p>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Edit Task</h2>
      <TaskForm initial={task} />
    </div>
  );
}
