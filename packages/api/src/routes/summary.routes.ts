import { Hono } from 'hono';
import { dailySummary, avivSchoolSummary } from '../services/summary.service.js';
import { runDailyReportAgent } from '../agents/daily-report.agent.js';
import { runTodaysScheduleAgent } from '../agents/todays-schedule.agent.js';

const summary = new Hono();

summary.post('/summary/daily', async (c) => {
  const result = await dailySummary();
  return c.json(result);
});

summary.post('/summary/aviv_school', async (c) => {
  const result = await avivSchoolSummary();
  return c.json(result);
});

// Agent-powered daily report: fetches messages, transcribes images, sends Telegram
summary.post('/summary/agent/daily-report', async (c) => {
  const result = await runDailyReportAgent();
  return c.json(result);
});

// Today's schedule: sends today's lessons to Telegram
summary.post('/summary/todays', async (c) => {
  const result = await runTodaysScheduleAgent();
  return c.json(result);
});

export { summary };
