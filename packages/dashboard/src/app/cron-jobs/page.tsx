import { CronJobsTable } from './cron-jobs-table';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

export interface CronJob {
  id: number;
  name: string;
  schedule: string;
  endpoint: string;
  method: string;
  body: string | null;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

async function getCronJobs(): Promise<CronJob[]> {
  const res = await fetch(`${API_URL}/cron-jobs`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function CronJobsPage() {
  const jobs = await getCronJobs();
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Cron Jobs</h2>
      <CronJobsTable initialJobs={jobs} />
    </div>
  );
}
