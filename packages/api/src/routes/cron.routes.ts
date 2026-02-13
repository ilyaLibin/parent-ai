import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import {
  getCronJobs,
  getCronJob,
  createCronJob,
  updateCronJobById,
  deleteCronJobById,
} from '@parent-ai/shared';

const anthropic = new Anthropic();
const cron = new Hono();

cron.get('/cron-jobs', (c) => {
  const enabledOnly = c.req.query('enabled') === 'true';
  const jobs = getCronJobs(enabledOnly);
  return c.json(jobs);
});

cron.get('/cron-jobs/:id', (c) => {
  const id = Number(c.req.param('id'));
  const job = getCronJob(id);
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json(job);
});

cron.post('/cron-jobs', async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.schedule || !body.endpoint) {
    return c.json({ error: 'name, schedule, and endpoint are required' }, 400);
  }
  const job = createCronJob(body);
  return c.json(job, 201);
});

cron.put('/cron-jobs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const job = updateCronJobById(id, body);
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json(job);
});

cron.delete('/cron-jobs/:id', (c) => {
  const id = Number(c.req.param('id'));
  const deleted = deleteCronJobById(id);
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

function isValidCron(text: string): boolean {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => /^[\d,\-\*\/]+$/.test(p));
}

cron.post('/cron-jobs/ai', async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) {
    return c.json({ error: 'text is required' }, 400);
  }

  const input = text.trim();

  if (isValidCron(input)) {
    return c.json({ expression: input });
  }

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      system:
        'You convert natural language schedule descriptions into 5-field cron expressions. Reply with ONLY the cron expression, nothing else. No explanation, no backticks, no extra text.',
      messages: [{ role: 'user', content: input }],
    });

    const expression = (res.content[0] as { type: 'text'; text: string }).text.trim();

    if (!isValidCron(expression)) {
      return c.json({ error: 'Failed to generate a valid cron expression' }, 422);
    }

    return c.json({ expression });
  } catch (err: any) {
    console.error('[ai] cron-expression error:', err.message);
    return c.json({ error: 'AI translation failed' }, 500);
  }
});

export { cron };
