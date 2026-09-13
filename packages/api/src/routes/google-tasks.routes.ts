import { Hono } from 'hono';
import { getIntegration, saveIntegration } from '@parent-ai/shared';
import { listTaskLists } from '../services/google-tasks.service.js';

const googleTasks = new Hono();

googleTasks.get('/tasks/tasklists', async (c) => {
  try {
    const lists = await listTaskLists();
    return c.json(lists);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to list task lists' }, 400);
  }
});

googleTasks.post('/tasks/select-tasklist', async (c) => {
  const body = await c.req.json();
  if (!body.taskListId) return c.json({ error: 'taskListId is required' }, 400);

  const integration = getIntegration('google_calendar');
  if (!integration) return c.json({ error: 'Google integration not configured' }, 400);

  const config = JSON.parse(integration.config_json);
  config.task_list_id = body.taskListId;
  saveIntegration('google_calendar', JSON.stringify(config));

  return c.json({ ok: true, taskListId: body.taskListId });
});

export { googleTasks };
