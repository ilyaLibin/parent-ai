import { Hono } from 'hono';
import { getGeminiClient, GEMINI_MODEL } from '../services/gemini.service.js';
import {
  getCronJobs,
  getCronJob,
  getCronJobByName,
  createCronJob,
  updateCronJobById,
  deleteCronJobById,
} from '@parent-ai/shared';

const cron = new Hono();

cron.get('/cron-jobs', (c) => {
  const name = c.req.query('name');
  if (name) {
    const job = getCronJobByName(name);
    return c.json(job ? [job] : []);
  }
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
  if (!body.name || !body.schedule) {
    return c.json({ error: 'name and schedule are required' }, 400);
  }
  if (!body.prompt && !body.endpoint) {
    return c.json({ error: 'Either prompt (agent task) or endpoint (legacy task) is required' }, 400);
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
    const ai = getGeminiClient();
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: input,
      config: {
        systemInstruction:
          'You convert natural language schedule descriptions into 5-field cron expressions. Reply with ONLY the cron expression, nothing else. No explanation, no backticks, no extra text.',
      },
    });

    const expression = (res.text || '').trim();

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
