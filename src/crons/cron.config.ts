export interface CronJob {
  name: string;
  schedule: string;
  endpoint: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  enabled?: boolean;
}

export const cronJobs: CronJob[] = [
  {
    name: 'aviv-school-summary',
    schedule: '0 20 * * 0-4', // Sun-Thu at 8 PM (school nights)
    endpoint: '/summary/aviv_school',
    method: 'POST',
  },
  {
    name: 'daily-summary',
    schedule: '0 20 * * *', // every day at 8 PM
    endpoint: '/summary/daily',
    method: 'POST',
  },
  {
    name: 'scheduled-messages',
    schedule: '* * * * *', // every minute
    endpoint: '/send/scheduled',
    method: 'POST',
  },
];
