import { Hono } from 'hono';
import {
  getRenovationJobs,
  getRenovationJob,
  createRenovationJob,
  updateRenovationJob,
  deleteRenovationJob,
  getRenovationWorkers,
  createRenovationWorker,
  updateRenovationWorker,
  deleteRenovationWorker,
  reorderRenovationJobs,
  getRenovationPhases,
  getAllRenovationPhases,
  createRenovationPhase,
  updateRenovationPhase,
  deleteRenovationPhase,
  getIntegration,
  saveIntegration,
} from '@parent-ai/shared';

const renovation = new Hono();

// Jobs
renovation.get('/renovation/jobs', (c) => {
  return c.json(getRenovationJobs());
});

renovation.get('/renovation/jobs/:id', (c) => {
  const id = Number(c.req.param('id'));
  const job = getRenovationJob(id);
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json(job);
});

renovation.post('/renovation/jobs', async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.category || !body.start_date || !body.end_date) {
    return c.json({ error: 'name, category, start_date, and end_date are required' }, 400);
  }
  const job = createRenovationJob(body);
  return c.json(job, 201);
});

renovation.put('/renovation/jobs/reorder', async (c) => {
  const body = await c.req.json();
  if (!Array.isArray(body.orderedIds)) {
    return c.json({ error: 'orderedIds array is required' }, 400);
  }
  reorderRenovationJobs(body.orderedIds);
  return c.json({ ok: true });
});

renovation.put('/renovation/jobs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const job = updateRenovationJob(id, body);
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json(job);
});

renovation.delete('/renovation/jobs/:id', (c) => {
  const id = Number(c.req.param('id'));
  const deleted = deleteRenovationJob(id);
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// Workers
renovation.get('/renovation/jobs/:id/workers', (c) => {
  const jobId = Number(c.req.param('id'));
  return c.json(getRenovationWorkers(jobId));
});

renovation.post('/renovation/jobs/:id/workers', async (c) => {
  const jobId = Number(c.req.param('id'));
  const body = await c.req.json();
  if (!body.name) {
    return c.json({ error: 'name is required' }, 400);
  }
  const worker = createRenovationWorker({ ...body, job_id: jobId });
  return c.json(worker, 201);
});

renovation.put('/renovation/workers/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const worker = updateRenovationWorker(id, body);
  if (!worker) return c.json({ error: 'Not found' }, 404);
  return c.json(worker);
});

renovation.delete('/renovation/workers/:id', (c) => {
  const id = Number(c.req.param('id'));
  const deleted = deleteRenovationWorker(id);
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// Phases
renovation.get('/renovation/jobs/:id/phases', (c) => {
  const jobId = Number(c.req.param('id'));
  return c.json(getRenovationPhases(jobId));
});

renovation.get('/renovation/phases', (c) => {
  return c.json(getAllRenovationPhases());
});

renovation.post('/renovation/jobs/:id/phases', async (c) => {
  const jobId = Number(c.req.param('id'));
  const body = await c.req.json();
  if (!body.start_date || !body.end_date) {
    return c.json({ error: 'start_date and end_date are required' }, 400);
  }
  if (body.name === undefined) body.name = '';
  const phase = createRenovationPhase({ ...body, job_id: jobId });
  return c.json(phase, 201);
});

renovation.put('/renovation/phases/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const phase = updateRenovationPhase(id, body);
  if (!phase) return c.json({ error: 'Not found' }, 404);
  return c.json(phase);
});

renovation.delete('/renovation/phases/:id', (c) => {
  const id = Number(c.req.param('id'));
  const deleted = deleteRenovationPhase(id);
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// Project settings (stored in integrations table as type 'renovation_settings')
const SETTINGS_TYPE = 'renovation_settings';
const DEFAULT_SETTINGS = { project_start: null, project_end: null, project_name: null, hide_prices: false };

renovation.get('/renovation/settings', (c) => {
  const row = getIntegration(SETTINGS_TYPE);
  if (!row) return c.json(DEFAULT_SETTINGS);
  try {
    return c.json(JSON.parse(row.config_json));
  } catch {
    return c.json(DEFAULT_SETTINGS);
  }
});

renovation.put('/renovation/settings', async (c) => {
  const body = await c.req.json();
  const settings = {
    project_start: body.project_start ?? null,
    project_end: body.project_end ?? null,
    project_name: body.project_name ?? null,
    hide_prices: body.hide_prices ?? false,
  };
  saveIntegration(SETTINGS_TYPE, JSON.stringify(settings));
  return c.json(settings);
});

export { renovation };
