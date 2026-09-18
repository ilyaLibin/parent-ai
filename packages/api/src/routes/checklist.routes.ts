import { Hono } from 'hono';
import { getChecklistItemById, setChecklistItemChecked, setActionItemDone, createChecklistItem } from '@parent-ai/shared';
import { setTaskStatus as setGTaskStatus } from '../services/google-tasks.service.js';

export const checklist = new Hono();

checklist.post('/checklist-items', async (c) => {
  const body = await c.req.json<{ label: string; entityType?: string; entityId?: string }>();
  if (!body.label) return c.json({ error: 'label is required' }, 400);
  const item = createChecklistItem({ label: body.label, entity_type: body.entityType ?? null, entity_id: body.entityId ?? null });
  return c.json(item, 201);
});

checklist.get('/checklist-items', (c) => {
  const idsParam = c.req.query('ids');
  if (!idsParam) return c.json({ error: 'ids query param is required (comma-separated)' }, 400);
  const ids = idsParam.split(',').map(Number).filter((n) => !Number.isNaN(n));
  const items = ids.map((id) => getChecklistItemById(id)).filter((item) => !!item);
  return c.json(items);
});

checklist.post('/checklist-items/:id/toggle', async (c) => {
  const id = Number(c.req.param('id'));
  const item = getChecklistItemById(id);
  if (!item) return c.json({ error: 'Checklist item not found' }, 404);

  const nextChecked = !item.checked;

  if (item.entity_type === 'action_item' && item.entity_id) {
    setActionItemDone(Number(item.entity_id), nextChecked);
  } else if (item.entity_type === 'google_tasks_task' && item.entity_id) {
    try {
      await setGTaskStatus(item.entity_id, nextChecked);
    } catch (err) {
      return c.json({ error: `Failed to sync Google Task: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
  }

  const updated = setChecklistItemChecked(id, nextChecked);
  return c.json({ success: true, id: updated!.id, label: updated!.label, checked: updated!.checked });
});
