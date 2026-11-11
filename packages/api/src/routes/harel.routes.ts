import { Hono } from 'hono';
import {
  runHarelReport,
  loadSnapshots,
  buildHarelReport,
  previousSnapshot,
  getHarelSessionStatus,
  keepHarelSessionAlive,
} from '../services/harel.service.js';
import { getGmailAuthUrl, isGmailConnected, getGmailAddress } from '../services/gmail.service.js';
import { sendTelegram } from '../services/telegram.service.js';

const harel = new Hono();

// Logs in to Harel, saves a snapshot and (unless {"send":false}) sends the report to Telegram.
// This is what the monthly cron job calls.
harel.post('/harel/report', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const { snapshot, report } = await runHarelReport();
    if (body.send !== false) await sendTelegram(report, 'HTML');
    return c.json({ success: true, total: snapshot.total, accounts: snapshot.accounts.length, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (body.send !== false) {
      await sendTelegram(`⚠️ בדיקת החסכונות בהראל נכשלה: ${message}`, 'HTML').catch(() => {});
    }
    return c.json({ success: false, error: message }, 500);
  }
});

// Last saved snapshot and its report, without logging in.
harel.get('/harel/latest', (c) => {
  const snapshots = loadSnapshots();
  const latest = snapshots.at(-1);
  if (!latest) return c.json({ error: 'No snapshot yet — POST /harel/report first' }, 404);
  return c.json({ snapshot: latest, report: buildHarelReport(latest, previousSnapshot(latest, snapshots)) });
});

// Saved Harel session: when it was created and last confirmed alive. POST checks it now.
harel.get('/harel/session', (c) => c.json(getHarelSessionStatus()));
harel.post('/harel/session/check', async (c) => c.json({ alive: await keepHarelSessionAlive(), ...getHarelSessionStatus() }));

harel.get('/gmail/auth-url', (c) => {
  try {
    return c.json({ url: getGmailAuthUrl(c.req.query('login_hint')) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to generate auth URL' }, 400);
  }
});

harel.get('/gmail/status', async (c) => {
  if (!isGmailConnected()) return c.json({ connected: false });
  try {
    return c.json({ connected: true, email: await getGmailAddress() });
  } catch (err) {
    return c.json({ connected: true, error: err instanceof Error ? err.message : String(err) });
  }
});

export { harel };
