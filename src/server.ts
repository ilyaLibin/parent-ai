import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WASocket } from '@whiskeysockets/baileys';
import { getGroups, getMessageCount, getConnectionGaps, resolveGroup } from './db.js';

const PORT = process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 3033;

let socket: WASocket | null = null;

export function setSocket(sock: WASocket) {
  socket = sock;
}

export function getSocket(): WASocket | null {
  return socket;
}

async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function phoneToJid(phone: string): string {
  const cleaned = phone.replace(/[^\d]/g, '');
  return `${cleaned}@s.whatsapp.net`;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  // Health check
  if (path === '/health' && method === 'GET') {
    return json(res, {
      status: 'ok',
      connected: socket !== null,
      timestamp: Date.now(),
    });
  }

  // Send message
  if (path === '/send' && method === 'POST') {
    if (!socket) {
      return json(res, { success: false, error: 'Not connected to WhatsApp' }, 503);
    }

    try {
      const body = await parseBody(req);
      const { to, message } = body as { to?: string; message?: string };

      if (!to || !message) {
        return json(res, { success: false, error: 'Missing "to" or "message" field' }, 400);
      }

      // Normalize recipient
      let recipientId = to;
      if (!recipientId.includes('@')) {
        recipientId = phoneToJid(recipientId);
      }

      const result = await socket.sendMessage(recipientId, { text: message });

      return json(res, {
        success: true,
        messageId: result?.key?.id,
        to: recipientId,
      });
    } catch (error) {
      return json(res, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }, 500);
    }
  }

  // List groups
  if (path === '/groups' && method === 'GET') {
    const groups = getGroups().map((g) => ({
      ...g,
      messageCount: getMessageCount(g.id),
    }));
    return json(res, { groups });
  }

  // Get status
  if (path === '/status' && method === 'GET') {
    const hours = parseInt(url.searchParams.get('hours') || '24', 10);
    const gaps = getConnectionGaps(hours);
    const groups = getGroups();
    const totalMessages = groups.reduce((sum, g) => sum + getMessageCount(g.id), 0);

    return json(res, {
      connected: socket !== null,
      gaps,
      groupCount: groups.length,
      totalMessages,
    });
  }

  // Resolve group (check if exists)
  if (path === '/resolve-group' && method === 'GET') {
    const identifier = url.searchParams.get('id');
    if (!identifier) {
      return json(res, { success: false, error: 'Missing "id" parameter' }, 400);
    }
    const group = resolveGroup(identifier);
    return json(res, { found: !!group, group });
  }

  // 404
  return json(res, { error: 'Not found' }, 404);
}

export function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        console.error('Server error:', err);
        json(res, { error: 'Internal server error' }, 500);
      });
    });

    server.listen(PORT, () => {
      console.log(`🌐 API server running on http://localhost:${PORT}`);
      resolve();
    });
  });
}
