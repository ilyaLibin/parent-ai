import { TaskForm } from './task-form';
import { PageHeader } from '../../components/page-header';

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
      <PageHeader title="Tasks" backHref="/tasks" />
      <TaskForm initial={duplicate} />
    </div>
  );
}
