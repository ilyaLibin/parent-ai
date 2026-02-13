import { Hono } from 'hono';
import {
  getKnowledgeList,
  getKnowledgeById,
  createKnowledge,
  updateKnowledgeById,
  deleteKnowledgeById,
} from '@parent-ai/shared';

const knowledge = new Hono();

knowledge.get('/knowledge', (c) => {
  return c.json(getKnowledgeList());
});

knowledge.get('/knowledge/:id', (c) => {
  const id = Number(c.req.param('id'));
  const entry = getKnowledgeById(id);
  if (!entry) return c.json({ error: 'Not found' }, 404);
  return c.json(entry);
});

knowledge.post('/knowledge', async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.content) {
    return c.json({ error: 'name and content are required' }, 400);
  }
  const entry = createKnowledge(body);
  return c.json(entry, 201);
});

knowledge.put('/knowledge/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const entry = updateKnowledgeById(id, body);
  if (!entry) return c.json({ error: 'Not found' }, 404);
  return c.json(entry);
});

knowledge.delete('/knowledge/:id', (c) => {
  const id = Number(c.req.param('id'));
  const deleted = deleteKnowledgeById(id);
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export { knowledge };
