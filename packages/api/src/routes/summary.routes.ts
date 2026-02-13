import { Hono } from 'hono';
import { dailySummary, avivSchoolSummary } from '../services/summary.service.js';

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

export { summary };
