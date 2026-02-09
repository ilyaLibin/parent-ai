import { Hono } from 'hono';
import { getSocket, requireSocket } from '../services/whatsapp.service.js';
import {
  getGroups,
  getMessages,
  getMessageCount,
  getConnectionGaps,
  resolveGroup,
  getDueMessages,
  markMessageSent,
  markMessageFailed,
} from '../db.js';

const whatsapp = new Hono();

function phoneToJid(phone: string): string {
  const cleaned = phone.replace(/[^\d]/g, '');
  return `${cleaned}@s.whatsapp.net`;
}

whatsapp.post('/send', async (c) => {
  const sock = requireSocket();
  const { to, message } = await c.req.json<{ to?: string; message?: string }>();

  if (!to || !message) {
    return c.json({ success: false, error: 'Missing "to" or "message" field' }, 400);
  }

  let recipientId = to;
  if (!recipientId.includes('@')) {
    recipientId = phoneToJid(recipientId);
  }

  const result = await sock.sendMessage(recipientId, { text: message });
  return c.json({ success: true, messageId: result?.key?.id, to: recipientId });
});

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
    connected: getSocket() !== null,
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

whatsapp.post('/send/scheduled', async (c) => {
  const sock = getSocket();
  if (!sock) {
    return c.json({ processed: 0, reason: 'not connected' });
  }

  const dueMessages = getDueMessages();
  let sent = 0;
  let failed = 0;

  for (const msg of dueMessages) {
    try {
      await sock.sendMessage(msg.recipient_id, { text: msg.message_text });
      markMessageSent(msg.id);
      console.log(`[scheduled] Sent to ${msg.recipient_name || msg.recipient_id}`);
      sent++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      markMessageFailed(msg.id, errorMsg);
      console.error(`[scheduled] Failed: ${errorMsg}`);
      failed++;
    }
  }

  return c.json({ processed: dueMessages.length, sent, failed });
});

export { whatsapp };
