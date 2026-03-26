import { Hono } from 'hono';
import { dailySummary, schoolSummary } from '../services/summary.service.js';

const summary = new Hono();

summary.post('/summary/daily', async (c) => {
  console.log('[api] Starting daily summary...');
  const result = await dailySummary();
  console.log(`[api] Daily summary done: ${result.groupsSummarized} groups, ${result.errors.length} errors`);
  return c.json(result);
});

summary.post('/summary/school', async (c) => {
  console.log('[api] Starting school summary...');
  const body = await c.req.json().catch(() => ({}));
  const result = await schoolSummary({
    groupIds: body.groupIds,
    promptFile: body.promptFile,
    scheduleFile: body.scheduleFile,
  });
  console.log(`[api] School summary done: ${result.groupsSummarized} groups, ${result.errors.length} errors`);
  return c.json(result);
});

export { summary };
