import { Hono } from 'hono';

const health = new Hono();

health.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: Date.now(),
  });
});

export { health };
