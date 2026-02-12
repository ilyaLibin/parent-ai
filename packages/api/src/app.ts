import { Hono } from 'hono';
import { health } from './routes/health.routes.js';
import { whatsapp } from './routes/whatsapp.routes.js';
import { summary } from './routes/summary.routes.js';

const app = new Hono();

// Request logging
app.use('*', async (c, next) => {
  const start = Date.now();
  console.log(`[api] --> ${c.req.method} ${c.req.path}`);
  await next();
  const ms = Date.now() - start;
  console.log(`[api] <-- ${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
});

app.onError((err, c) => {
  console.error(`[api] ERROR ${c.req.method} ${c.req.path}:`, err.message);
  return c.json({ error: err.message || 'Internal server error' }, 500);
});

app.route('/', health);
app.route('/', whatsapp);
app.route('/', summary);

export { app };
