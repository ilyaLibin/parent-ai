import { Hono } from 'hono';
import {
  getGroups,
  getMessages,
  getMessageCount,
  getConnectionGaps,
  getDailyMessageCounts,
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

whatsapp.get('/messages/daily-counts', (c) => {
  const days = parseInt(c.req.query('days') || '30', 10);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const groupIdsParam = c.req.query('groupIds');
  const groupIds = groupIdsParam ? groupIdsParam.split(',').filter(Boolean) : undefined;
  const counts = getDailyMessageCounts(since, groupIds);
  return c.json({ counts });
});

whatsapp.get('/messages', (c) => {
  const fromParam = c.req.query('from');
  const toParam = c.req.query('to');

  let since: number;
  let until: number;

  if (fromParam && toParam) {
    since = parseInt(fromParam, 10);
    until = parseInt(toParam, 10);
  } else {
    const hours = parseInt(c.req.query('hours') || '24', 10);
    until = Date.now();
    since = until - hours * 60 * 60 * 1000;
  }

  const groups = getGroups();
  const result = groups
    .map((g) => {
      const messages = getMessages(g.id, since, until);
      const lastMessageTime = messages.length > 0 ? messages[messages.length - 1].timestamp : 0;
      return {
        groupId: g.id,
        groupName: g.name,
        messageCount: messages.length,
        lastMessageTime,
        messages: messages.map((m) => ({
          id: m.id,
          sender: m.sender_name || m.sender_id.split('@')[0],
          content: m.content,
          type: m.message_type,
          time: new Date(m.timestamp).toISOString(),
        })),
      };
    })
    .sort((a, b) => {
      // Groups with messages on top, sorted by most recent message
      if (a.messageCount === 0 && b.messageCount === 0) return 0;
      if (a.messageCount === 0) return 1;
      if (b.messageCount === 0) return -1;
      return b.lastMessageTime - a.lastMessageTime;
    });

  return c.json({ from: since, to: until, groups: result });
});

export { whatsapp };
