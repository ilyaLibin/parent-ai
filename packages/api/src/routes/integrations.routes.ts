import { Hono } from 'hono';
import { getIntegration, saveIntegration, deleteIntegration } from '@parent-ai/shared';

const integrations = new Hono();

integrations.get('/integrations/:type', (c) => {
  const type = c.req.param('type');
  const integration = getIntegration(type);
  if (!integration) return c.json({ error: 'Not found' }, 404);

  // Redact secrets in config
  const config = JSON.parse(integration.config_json);
  if (config.client_secret) {
    config.client_secret = config.client_secret.slice(0, 6) + '***';
  }

  return c.json({ ...integration, config_json: JSON.stringify(config), config });
});

integrations.post('/integrations/:type', async (c) => {
  const type = c.req.param('type');
  const body = await c.req.json();
  if (!body.config) return c.json({ error: 'config is required' }, 400);

  // Merge with existing config to preserve fields not sent (e.g. redacted client_secret)
  const existing = getIntegration(type);
  let config = body.config;
  if (existing) {
    const existingConfig = JSON.parse(existing.config_json);
    config = { ...existingConfig, ...config };
    // Remove fields that look redacted (contain ***)
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value.includes('***')) {
        config[key] = existingConfig[key];
      }
    }
  }

  const integration = saveIntegration(type, JSON.stringify(config), body.enabled !== false);
  return c.json(integration);
});

integrations.delete('/integrations/:type', (c) => {
  const type = c.req.param('type');
  const deleted = deleteIntegration(type);
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export { integrations };
