import Link from 'next/link';
import { TaskForm } from './task-form';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

async function getTask(id: number) {
  const res = await fetch(`${API_URL}/cron-jobs/${id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const params = await searchParams;
  const fromId = params.from ? Number(params.from) : null;
  const source = fromId ? await getTask(fromId) : null;

  const duplicate = source
    ? {
        name: `${source.name} (copy)`,
        schedule: source.schedule,
        prompt: source.prompt,
        model: source.model,
        enabled: false,
        endpoint: source.endpoint,
        method: source.method,
        body: source.body,
      }
    : undefined;

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/tasks" className="text-fg-muted hover:text-fg transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-xl font-bold">{duplicate ? 'Duplicate Task' : 'New Task'}</h2>
      </div>
      <TaskForm initial={duplicate} />
    </div>
  );
}
