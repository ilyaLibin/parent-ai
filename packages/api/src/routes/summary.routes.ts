import { Hono } from 'hono';
import { dailySummary, avivSchoolSummary } from '../services/summary.service.js';
import { runDailyReportAgent } from '../agents/daily-report.agent.js';
import { runTodaysScheduleAgent } from '../agents/todays-schedule.agent.js';

const summary = new Hono();

summary.post('/summary/daily', async (c) => {
  console.log('[api] Starting daily summary...');
  const result = await dailySummary();
  console.log(`[api] Daily summary done: ${result.groupsSummarized} groups, ${result.errors.length} errors`);
  return c.json(result);
});

summary.post('/summary/aviv_school', async (c) => {
  console.log('[api] Starting Aviv school summary...');
  const result = await avivSchoolSummary();
  console.log(`[api] Aviv school summary done: ${result.groupsSummarized} groups, ${result.errors.length} errors`);
  return c.json(result);
});

// Agent-powered daily report: fetches messages, transcribes images, sends Telegram
summary.post('/summary/agent/daily-report', async (c) => {
  console.log('[api] Starting daily report agent...');
  const result = await runDailyReportAgent();
  console.log(`[api] Daily report agent done: success=${result.success}, steps=${result.steps}${result.error ? `, error=${result.error}` : ''}`);
  return c.json(result);
});

// Today's schedule: sends today's lessons to Telegram
summary.post('/summary/todays', async (c) => {
  console.log('[api] Starting today\'s schedule agent...');
  const result = await runTodaysScheduleAgent();
  console.log(`[api] Today's schedule done: success=${result.success}, steps=${result.steps}${result.error ? `, error=${result.error}` : ''}`);
  return c.json(result);
});

export { summary };
