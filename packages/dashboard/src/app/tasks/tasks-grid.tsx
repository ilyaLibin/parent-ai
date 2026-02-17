'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import cronstrue from 'cronstrue';
import { CronExpressionParser } from 'cron-parser';
import type { Task, TaskRun } from './page';
import { RunModal } from '../components/run-modal';

function describeSchedule(schedule: string): string {
  try {
    return cronstrue.toString(schedule, { use24HourTimeFormat: false });
  } catch {
    return schedule;
  }
}

function nextRun(schedule: string): string | null {
  try {
    const interval = CronExpressionParser.parse(schedule, { tz: 'Asia/Jerusalem' });
    const next = interval.next().toDate();
    const now = new Date();
    const diffMs = next.getTime() - now.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffM = Math.floor((diffMs % 3600000) / 60000);
    const time = next.toLocaleString('en-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    if (diffH < 1) return `in ${diffM}m (${time})`;
    if (diffH < 24) return `in ${diffH}h ${diffM}m (${time})`;
    return time;
  } catch {
    return null;
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TasksGrid({ initialTasks, lastRunMap }: { initialTasks: Task[]; lastRunMap: Record<number, TaskRun> }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [modalTask, setModalTask] = useState<Task | null>(null);

  async function toggleEnabled(e: React.MouseEvent, task: Task) {
    e.stopPropagation();
    const res = await fetch(`/api/cron-jobs/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !task.enabled }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/tasks/new"
          className="inline-block btn-accent rounded-lg px-4 py-2 text-sm font-medium"
        >
          + new task
        </Link>
      </div>

      {tasks.length === 0 ? (
        <p className="text-fg-muted">No tasks found.</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const isAgent = !!task.prompt;
            const lastRun = lastRunMap[task.id];
            return (
              <div
                key={task.id}
                onClick={() => router.push(`/tasks/${task.id}`)}
                className="card-raised rounded-lg px-5 py-4 cursor-pointer hover:border-accent/40 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-fg truncate text-sm">{task.name}</div>
                    <div className="text-xs text-fg-secondary mt-0.5">
                      {describeSchedule(task.schedule)}
                      {task.enabled && nextRun(task.schedule) && (
                        <span className="text-fg-muted ml-2">· next: {nextRun(task.schedule)}</span>
                      )}
                    </div>
                    {lastRun && (
                      <div className="text-xs text-fg-muted mt-1">
                        last: {timeAgo(lastRun.started_at)}
                        {lastRun.success === 1 && <span className="text-success ml-1">· ok</span>}
                        {lastRun.success === 0 && <span className="text-error ml-1">· fail</span>}
                        {lastRun.success === null && <span className="text-warning ml-1">· running</span>}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isAgent && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setModalTask(task); }}
                        className="btn-raised rounded p-1.5 text-fg-muted hover:text-fg"
                        title="Test Run"
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                    )}
                    <Link
                      href={`/tasks/new?from=${task.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="btn-raised rounded p-1.5 text-fg-muted hover:text-fg"
                      title="Duplicate"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </Link>
                    <Link
                      href={`/tasks/${task.id}/runs`}
                      onClick={(e) => e.stopPropagation()}
                      className="btn-raised rounded p-1.5 text-fg-muted hover:text-fg"
                      title="View runs"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </Link>
                    <button
                      onClick={(e) => toggleEnabled(e, task)}
                      className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${
                        task.enabled ? 'bg-success' : 'bg-surface-hover border border-border'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${
                          task.enabled ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalTask && (
        <RunModal
          taskId={modalTask.id}
          taskName={modalTask.name}
          open={!!modalTask}
          onClose={() => setModalTask(null)}
        />
      )}
    </div>
  );
}
