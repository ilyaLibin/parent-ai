import { Hono } from 'hono';
import { getCronJob, getTaskRuns, getTaskRun } from '@parent-ai/shared';
import { runGenericAgent } from '../agents/generic.agent.js';

const task = new Hono();

task.post('/task/:id/execute', async (c) => {
  const id = Number(c.req.param('id'));
  const job = getCronJob(id);
  if (!job) return c.json({ error: 'Task not found' }, 404);
  if (!job.prompt) return c.json({ error: 'Task has no prompt — not an agent task' }, 400);

  console.log(`[api] Executing task "${job.name}" (id=${id})...`);
  const result = await runGenericAgent({
    taskId: id,
    prompt: job.prompt,
    model: job.model,
  });

  console.log(`[api] Task "${job.name}" done: success=${result.success}, steps=${result.steps.length}`);
  return c.json(result);
});

task.get('/task-runs', (c) => {
  const taskId = c.req.query('taskId') ? Number(c.req.query('taskId')) : undefined;
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 50;
  const runs = getTaskRuns(taskId, limit);
  return c.json(runs);
});

task.get('/task-runs/:id', (c) => {
  const id = Number(c.req.param('id'));
  const run = getTaskRun(id);
  if (!run) return c.json({ error: 'Run not found' }, 404);
  return c.json(run);
});

export { task };
