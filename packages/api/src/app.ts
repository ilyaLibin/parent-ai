import { Hono } from 'hono';
import { health } from './routes/health.routes.js';
import { whatsapp } from './routes/whatsapp.routes.js';
import { summary } from './routes/summary.routes.js';

const app = new Hono();

app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: err.message || 'Internal server error' }, 500);
});

app.route('/', health);
app.route('/', whatsapp);
app.route('/', summary);

export { app };
