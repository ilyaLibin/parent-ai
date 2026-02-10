import { Hono } from 'hono';
import {
  getGroups,
  getMessages,
  getMessageCount,
  getConnectionGaps,
  resolveGroup,
} from '@parent-ai/shared';

const whatsapp = new Hono();

whatsapp.get('/groups', (c) => {
  const groups = getGroups().map((g) => ({
    ...g,
    messageCount: getMessageCount(g.id),
  }));
  return c.json({ groups });
});

whatsapp.get('/status', (c) => {
  const hours = parseInt(c.req.query('hours') || '24', 10);
  const gaps = getConnectionGaps(hours);
  const groups = getGroups();
  const totalMessages = groups.reduce((sum, g) => sum + getMessageCount(g.id), 0);

  return c.json({
    gaps,
    groupCount: groups.length,
    totalMessages,
  });
});

whatsapp.get('/resolve-group', (c) => {
  const identifier = c.req.query('id');
  if (!identifier) {
    return c.json({ success: false, error: 'Missing "id" parameter' }, 400);
  }
  const group = resolveGroup(identifier);
  return c.json({ found: !!group, group });
});

whatsapp.get('/messages', (c) => {
  const hours = parseInt(c.req.query('hours') || '24', 10);
  const now = Date.now();
  const since = now - hours * 60 * 60 * 1000;

  const groups = getGroups();
  const result = groups
    .map((g) => {
      const messages = getMessages(g.id, since, now);
      if (messages.length === 0) return null;
      return {
        groupId: g.id,
        groupName: g.name,
        messageCount: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          sender: m.sender_name || m.sender_id.split('@')[0],
          content: m.content,
          type: m.message_type,
          time: new Date(m.timestamp).toISOString(),
        })),
      };
    })
    .filter(Boolean);

  return c.json({ hours, groups: result });
});

export { whatsapp };
