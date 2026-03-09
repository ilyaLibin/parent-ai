import { Hono } from 'hono';
import { health } from './routes/health.routes.js';
import { whatsapp } from './routes/whatsapp.routes.js';
import { summary } from './routes/summary.routes.js';
import { cron } from './routes/cron.routes.js';
import { task } from './routes/task.routes.js';
import { knowledge } from './routes/knowledge.routes.js';
import { actionItems } from './routes/action-items.routes.js';
import { ai } from './routes/ai.routes.js';
import { integrations } from './routes/integrations.routes.js';
import { calendar } from './routes/calendar.routes.js';
import { renovation } from './routes/renovation.routes.js';

const app = new Hono();

// Request logging
app.use('*', async (c, next) => {
  const silent = c.req.method === 'GET' && c.req.path === '/cron-jobs';
  const start = Date.now();
  if (!silent) console.log(`[api] --> ${c.req.method} ${c.req.path}`);
  await next();
  const ms = Date.now() - start;
  if (!silent) console.log(`[api] <-- ${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
});

app.onError((err, c) => {
  console.error(`[api] ERROR ${c.req.method} ${c.req.path}:`, err.message);
  return c.json({ error: err.message || 'Internal server error' }, 500);
});

app.route('/', health);
app.route('/', whatsapp);
app.route('/', summary);
app.route('/', cron);
app.route('/', task);
app.route('/', knowledge);
app.route('/', actionItems);
app.route('/', ai);
app.route('/', integrations);
app.route('/', calendar);
app.route('/', renovation);

export { app };
