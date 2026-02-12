import { Hono } from 'hono';
import {
  getCronJobs,
  getCronJob,
  createCronJob,
  updateCronJobById,
  deleteCronJobById,
} from '@parent-ai/shared';

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

export { cron };
