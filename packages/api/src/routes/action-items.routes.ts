import { Hono } from 'hono';
import {
  getActionItems,
  createActionItem,
  dismissActionItem,
  deleteActionItem,
} from '@parent-ai/shared';

export const actionItems = new Hono();

actionItems.get('/action-items', (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const items = getActionItems(from, to);
  return c.json(items);
});

actionItems.post('/action-items', async (c) => {
  const body = await c.req.json<{
    description: string;
    date: string;
    sourceGroupId?: string;
    sourceGroupName?: string;
    summary?: string;
    color?: string;
  }>();

  if (!body.description || !body.date) {
    return c.json({ error: 'description and date are required' }, 400);
  }

  const item = createActionItem({
    description: body.description,
    date: body.date,
    source_group_id: body.sourceGroupId,
    source_group_name: body.sourceGroupName,
    summary: body.summary,
    color: body.color,
  });
  return c.json(item, 201);
});

actionItems.patch('/action-items/:id/dismiss', (c) => {
  const id = Number(c.req.param('id'));
  const ok = dismissActionItem(id);
  if (!ok) return c.json({ error: 'Action item not found' }, 404);
  return c.json({ success: true });
});

actionItems.delete('/action-items/:id', (c) => {
  const id = Number(c.req.param('id'));
  const ok = deleteActionItem(id);
  if (!ok) return c.json({ error: 'Action item not found' }, 404);
  return c.json({ success: true });
});
