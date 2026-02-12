import { CronExpressionParser } from 'cron-parser';

const API_BASE = process.env.API_URL || `http://localhost:${process.env.API_PORT || 3033}`;
const POLL_INTERVAL = 60_000; // 60 seconds

interface CronJob {
  id: number;
  name: string;
  schedule: string;
  endpoint: string;
  method: string;
  body: string | null;
  enabled: boolean;
}

function matchesCurrentMinute(schedule: string): boolean {
  try {
    const interval = CronExpressionParser.parse(schedule);
    const prev = interval.prev().toDate();
    const diff = Date.now() - prev.getTime();
    // prev() falls within the current 60s window
    return diff >= 0 && diff < POLL_INTERVAL;
  } catch {
    return false;
  }
}

async function fetchEnabledJobs(): Promise<CronJob[]> {
  const res = await fetch(`${API_BASE}/cron-jobs?enabled=true`);
  if (!res.ok) throw new Error(`Failed to fetch cron jobs: ${res.status}`);
  return res.json();
}

async function fireJob(job: CronJob): Promise<void> {
  const url = `${API_BASE}${job.endpoint}`;
  console.log(`[cron] ${job.name} -> ${job.method} ${job.endpoint}`);
  try {
    const res = await fetch(url, {
      method: job.method,
      headers: { 'Content-Type': 'application/json' },
      body: job.body ?? undefined,
    });
    const data = await res.json();
    console.log(`[cron] ${job.name} completed:`, data);
  } catch (err) {
    console.error(`[cron] ${job.name} failed:`, err);
  }
}

async function tick(): Promise<void> {
  try {
    const jobs = await fetchEnabledJobs();
    for (const job of jobs) {
      if (matchesCurrentMinute(job.schedule)) {
        fireJob(job); // fire-and-forget
      }
    }
  } catch (err) {
    console.error('[cron] poll error:', err);
  }
}

export function startCronRunner(): void {
  console.log(`[cron] Polling ${API_BASE}/cron-jobs every ${POLL_INTERVAL / 1000}s`);
  tick(); // run immediately on start
  setInterval(tick, POLL_INTERVAL);
}
