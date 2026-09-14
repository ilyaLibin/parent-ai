import { Hono } from 'hono';
import { getCronJob, getCronJobs, createCronJob, getTaskRuns, getTaskRun } from '@parent-ai/shared';
import { runGenericAgent } from '../agents/generic.agent.js';

const task = new Hono();

const TELEGRAM_CHAT_TASK = 'telegram-chat';

function getOrCreateChatTaskId(): number {
  const existing = getCronJobs().find((j) => j.name === TELEGRAM_CHAT_TASK);
  if (existing) return existing.id;
  const job = createCronJob({ name: TELEGRAM_CHAT_TASK, schedule: '', enabled: false, model: 'haiku' });
  return job.id;
}

let chatTaskId: number | null = null;

task.post('/agent/run', async (c) => {
  const body = await c.req.json<{
    prompt?: string;
    image?: { data: string; mediaType: string };
    audio?: { data: string; mediaType: string };
  }>();
  if (!body.prompt && !body.image && !body.audio) {
    return c.json({ error: 'prompt, image, or audio is required' }, 400);
  }

  if (!chatTaskId) chatTaskId = getOrCreateChatTaskId();

  let prompt = body.prompt;
  if (!prompt) {
    prompt = body.audio
      ? 'Listen to this voice message and do what it asks. If it asks to schedule or add something, use the appropriate tool.'
      : 'Describe what this image shows. If it depicts a scheduled event (e.g. a flyer, schedule, or invitation), create a calendar event for it.';
  }

  console.log(`[api] Ad-hoc agent run${body.image ? ' (with image)' : ''}${body.audio ? ' (with audio)' : ''}: "${prompt.substring(0, 80)}"`);
  const result = await runGenericAgent({
    taskId: chatTaskId,
    prompt,
    model: 'haiku',
    image: body.image,
    audio: body.audio,
  });

  console.log(`[api] Ad-hoc agent done: success=${result.success}, steps=${result.steps.length}`);
  return c.json(result);
});

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
