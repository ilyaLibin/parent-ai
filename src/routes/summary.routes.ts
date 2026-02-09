import { Hono } from 'hono';
import { dailySummary, avivSchoolSummary } from '../services/summary.service.js';

const summary = new Hono();

summary.post('/summary/daily', async (c) => {
  const result = await dailySummary();
  return c.json(result);
});

summary.post('/summary/aviv_school', async (c) => {
  const result = await avivSchoolSummary();
  return c.json(result);
});

export { summary };
