import { Hono } from 'hono';
import { getSocket } from '../services/whatsapp.service.js';

const health = new Hono();

health.get('/health', (c) => {
  return c.json({
    status: 'ok',
    connected: getSocket() !== null,
    timestamp: Date.now(),
  });
});

export { health };
