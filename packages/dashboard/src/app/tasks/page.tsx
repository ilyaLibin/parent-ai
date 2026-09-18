import { TasksPageTabs } from './tasks-page-tabs';
import type { MonthlyCost, ExpensiveTask } from './usage-panel';

const API_URL = process.env.API_URL || 'http://localhost:3033';

const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  haiku: { input: 0.80, output: 4.00 },
  sonnet: { input: 3.00, output: 15.00 },
  opus: { input: 15.00, output: 75.00 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
};

function estimateCostValue(model: string | null, tokens: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } | null): number {
  if (!tokens || !model) return 0;
  const prices = PRICE_PER_M[model];
  if (!prices) return 0;
  const cacheWrite = tokens.cache_creation_input_tokens || 0;
  const cacheRead = tokens.cache_read_input_tokens || 0;
  const nonCachedInput = tokens.input_tokens - cacheWrite - cacheRead;
  return (nonCachedInput * prices.input + cacheWrite * prices.input * 1.25 + cacheRead * prices.input * 0.1 + tokens.output_tokens * prices.output) / 1_000_000;
}

function monthKey(ts: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(ts);
}

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

interface RunStat {
  id: number;
  task_id: number;
  started_at: number;
  model: string | null;
  token_usage_json: string | null;
}

async function getRunStats(): Promise<RunStat[]> {
  const res = await fetch(`${API_URL}/task-runs/stats?sinceDays=400`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function TasksPage() {
  const [tasks, runs, stats] = await Promise.all([getTasks(), getRuns(), getRunStats()]);

  // Build map of taskId -> latest run
  const lastRunMap: Record<number, TaskRun> = {};
  for (const run of runs) {
    if (!lastRunMap[run.task_id]) {
      lastRunMap[run.task_id] = run;
    }
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Monthly cost (chronological, since getRunStats returns ascending started_at)
  const monthlyCostMap = new Map<string, number>();
  for (const run of stats) {
    const tokens = run.token_usage_json ? JSON.parse(run.token_usage_json) : null;
    const key = monthKey(run.started_at);
    monthlyCostMap.set(key, (monthlyCostMap.get(key) || 0) + estimateCostValue(run.model, tokens));
  }
  const monthlyCost: MonthlyCost[] = Array.from(monthlyCostMap.entries()).map(([month, cost]) => ({ month, cost }));

  // Most expensive tasks this month
  const currentMonth = monthKey(Date.now());
  const thisMonthByTask = new Map<number, { cost: number; runCount: number }>();
  for (const run of stats) {
    if (monthKey(run.started_at) !== currentMonth) continue;
    const tokens = run.token_usage_json ? JSON.parse(run.token_usage_json) : null;
    const cost = estimateCostValue(run.model, tokens);
    const existing = thisMonthByTask.get(run.task_id) || { cost: 0, runCount: 0 };
    thisMonthByTask.set(run.task_id, { cost: existing.cost + cost, runCount: existing.runCount + 1 });
  }
  const expensiveTasks: ExpensiveTask[] = Array.from(thisMonthByTask.entries())
    .map(([taskId, agg]) => ({ taskId, taskName: taskMap.get(taskId)?.name || `#${taskId}`, ...agg }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5);

  return (
    <TasksPageTabs
      tasks={tasks}
      lastRunMap={lastRunMap}
      runs={runs}
      taskMap={taskMap}
      monthlyCost={monthlyCost}
      expensiveTasks={expensiveTasks}
    />
  );
}
