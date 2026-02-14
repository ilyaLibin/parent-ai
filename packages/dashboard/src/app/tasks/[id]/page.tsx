import Link from 'next/link';
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
    return <p className="text-fg-muted">Task not found.</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/tasks" className="text-fg-muted hover:text-fg transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-xl font-bold">Edit Task</h2>
      </div>
      <TaskForm initial={task} />
    </div>
  );
}
