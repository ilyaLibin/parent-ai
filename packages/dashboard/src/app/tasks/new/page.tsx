import Link from 'next/link';
import { TaskForm } from './task-form';

export default function NewTaskPage() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/tasks" className="text-fg-muted hover:text-fg transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-xl font-bold">New Task</h2>
      </div>
      <TaskForm />
    </div>
  );
}
