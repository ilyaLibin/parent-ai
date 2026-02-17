import { Hono } from 'hono';
import { getIntegration, getIntegrationToken, saveIntegration, deleteIntegrationToken } from '@parent-ai/shared';
import {
  getAuthUrl,
  exchangeCodeForTokens,
  listCalendars,
} from '../services/google-calendar.service.js';

const calendar = new Hono();

calendar.get('/calendar/auth-url', (c) => {
  try {
    const url = getAuthUrl();
    return c.json({ url });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to generate auth URL' }, 400);
  }
});

calendar.get('/calendar/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'Missing code parameter' }, 400);

  try {
    await exchangeCodeForTokens(code);
    // Redirect to dashboard settings page
    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
    return c.redirect(`${dashboardUrl}/settings?connected=true`);
  } catch (err) {
    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
    return c.redirect(`${dashboardUrl}/settings?error=${encodeURIComponent(err instanceof Error ? err.message : 'Token exchange failed')}`);
  }
});

calendar.get('/calendar/status', (c) => {
  const integration = getIntegration('google_calendar');
  const token = getIntegrationToken('google_calendar');

  if (!integration) {
    return c.json({ configured: false, connected: false });
  }

  const config = JSON.parse(integration.config_json);
  return c.json({
    configured: true,
    connected: !!token,
    calendarId: config.calendar_id || null,
    expiresAt: token?.expiry_date || null,
  });
});

calendar.get('/calendar/calendars', async (c) => {
  try {
    const calendars = await listCalendars();
    return c.json(calendars);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to list calendars' }, 400);
  }
});

calendar.post('/calendar/select-calendar', async (c) => {
  const body = await c.req.json();
  if (!body.calendarId) return c.json({ error: 'calendarId is required' }, 400);

  const integration = getIntegration('google_calendar');
  if (!integration) return c.json({ error: 'Google Calendar not configured' }, 400);

  const config = JSON.parse(integration.config_json);
  config.calendar_id = body.calendarId;
  saveIntegration('google_calendar', JSON.stringify(config));

  return c.json({ ok: true, calendarId: body.calendarId });
});

calendar.delete('/calendar/disconnect', (c) => {
  deleteIntegrationToken('google_calendar');
  return c.json({ ok: true });
});

export { calendar };
