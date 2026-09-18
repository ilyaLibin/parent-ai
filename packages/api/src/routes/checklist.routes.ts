import { Hono } from 'hono';
import { getChecklistItemById, setChecklistItemChecked, setActionItemDone } from '@parent-ai/shared';
import { setTaskStatus as setGTaskStatus } from '../services/google-tasks.service.js';

export const checklist = new Hono();

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
