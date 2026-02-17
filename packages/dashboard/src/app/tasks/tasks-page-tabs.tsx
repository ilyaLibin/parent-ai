'use client';

import { useState } from 'react';
import { TasksGrid } from './tasks-grid';
import { RunsTable } from '../runs/runs-table';
import type { Task, TaskRun } from './page';

type Tab = 'tasks' | 'runs';

interface TasksPageTabsProps {
  tasks: Task[];
  lastRunMap: Record<number, TaskRun>;
  runs: TaskRun[];
  taskMap: Map<number, { id: number; name: string }>;
}

export function TasksPageTabs({ tasks, lastRunMap, runs, taskMap }: TasksPageTabsProps) {
  const [tab, setTab] = useState<Tab>('tasks');

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-2xl font-bold">Tasks</h2>
        <div className="flex rounded-lg overflow-hidden border border-border">
          <button
            onClick={() => setTab('tasks')}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'tasks'
                ? 'bg-accent text-white'
                : 'bg-raised text-fg-secondary hover:text-fg'
            }`}
          >
            tasks
          </button>
          <button
            onClick={() => setTab('runs')}
            className={`px-3 py-1 text-xs font-medium transition-colors border-l border-border ${
              tab === 'runs'
                ? 'bg-accent text-white'
                : 'bg-raised text-fg-secondary hover:text-fg'
            }`}
          >
            runs
          </button>
        </div>
      </div>

      {tab === 'tasks' ? (
        <TasksGrid initialTasks={tasks} lastRunMap={lastRunMap} />
      ) : (
        runs.length === 0 ? (
          <p className="text-fg-muted">No runs yet.</p>
        ) : (
          <RunsTable runs={runs} taskMap={taskMap} />
        )
      )}
    </div>
  );
}
