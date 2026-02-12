import cron from 'node-cron';
import { cronJobs } from './cron.config.js';

const API_BASE = process.env.API_URL || `http://localhost:${process.env.API_PORT || 3033}`;

let started = false;

export function startCronRunner(): void {
  if (started) return;
  started = true;

  for (const job of cronJobs) {
    if (job.enabled === false) continue;

    cron.schedule(job.schedule, async () => {
      const url = `${API_BASE}${job.endpoint}`;
      const method = job.method || 'POST';
      console.log(`[cron] ${job.name} -> ${method} ${job.endpoint}`);

      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: job.body ? JSON.stringify(job.body) : undefined,
        });
        const data = await res.json();
        console.log(`[cron] ${job.name} completed:`, data);
      } catch (err) {
        console.error(`[cron] ${job.name} failed:`, err);
      }
    });

    console.log(`  [cron] ${job.name} scheduled: ${job.schedule}`);
  }

  console.log(
    `[cron] Runner started (${cronJobs.filter((j) => j.enabled !== false).length} jobs)`
  );
}
