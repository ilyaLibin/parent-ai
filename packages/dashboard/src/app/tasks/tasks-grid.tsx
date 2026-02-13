'use client';

import { useState } from 'react';
import Link from 'next/link';
import cronstrue from 'cronstrue';
import { CronExpressionParser } from 'cron-parser';
import type { Task } from './page';

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

export function TasksGrid({ initialTasks }: { initialTasks: Task[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [runningId, setRunningId] = useState<number | null>(null);

  async function toggleEnabled(task: Task) {
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

  async function runNow(task: Task) {
    setRunningId(task.id);
    try {
      await fetch(`/api/task/${task.id}/execute`, { method: 'POST' });
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/tasks/new"
          className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
        >
          + New Task
        </Link>
      </div>

      {tasks.length === 0 ? (
        <p className="text-zinc-400">No tasks found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tasks.map((task) => {
            const isAgent = !!task.system_prompt;
            return (
              <div
                key={task.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/tasks/${task.id}`} className="text-lg font-semibold hover:text-blue-400 transition-colors">
                    {task.name}
                  </Link>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isAgent ? 'bg-purple-900/50 text-purple-300' : 'bg-zinc-800 text-zinc-400'}`}>
                    {isAgent ? 'Agent' : 'Legacy'}
                  </span>
                </div>

                <div className="text-sm text-zinc-400">
                  <div>{describeSchedule(task.schedule)}</div>
                  {task.enabled && nextRun(task.schedule) && (
                    <div className="text-green-400/70 text-xs mt-1">Next: {nextRun(task.schedule)}</div>
                  )}
                </div>

                {isAgent && task.model && (
                  <div className="text-xs text-zinc-500">Model: {task.model}</div>
                )}

                <div className="flex items-center gap-3 mt-auto pt-2 border-t border-zinc-800/50">
                  <button
                    onClick={() => toggleEnabled(task)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${
                      task.enabled ? 'bg-green-600' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        task.enabled ? 'left-5' : 'left-0.5'
                      }`}
                    />
                  </button>

                  {isAgent && (
                    <button
                      onClick={() => runNow(task)}
                      disabled={runningId === task.id}
                      className="text-xs text-blue-400 hover:text-blue-300 disabled:text-zinc-600 disabled:cursor-not-allowed"
                    >
                      {runningId === task.id ? 'Running...' : 'Run Now'}
                    </button>
                  )}

                  <Link
                    href={`/tasks/${task.id}/runs`}
                    className="text-xs text-zinc-400 hover:text-zinc-300 ml-auto"
                  >
                    Runs
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
