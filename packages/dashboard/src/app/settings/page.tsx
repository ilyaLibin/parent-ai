import { PageHeader } from '../components/page-header';
import { SettingsClient } from './settings-client';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

interface CalendarStatus {
  configured: boolean;
  connected: boolean;
  calendarId: string | null;
  expiresAt: number | null;
}

interface IntegrationConfig {
  config?: {
    client_id?: string;
    client_secret?: string;
    redirect_uri?: string;
    calendar_id?: string;
  };
}

async function getCalendarStatus(): Promise<CalendarStatus> {
  try {
    const res = await fetch(`${API_URL}/calendar/status`, { cache: 'no-store' });
    if (!res.ok) return { configured: false, connected: false, calendarId: null, expiresAt: null };
    return res.json();
  } catch {
    return { configured: false, connected: false, calendarId: null, expiresAt: null };
  }
}

async function getIntegrationConfig(): Promise<IntegrationConfig> {
  try {
    const res = await fetch(`${API_URL}/integrations/google_calendar`, { cache: 'no-store' });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export default async function SettingsPage() {
  const [status, integration] = await Promise.all([getCalendarStatus(), getIntegrationConfig()]);

  return (
    <div>
      <PageHeader title="Settings" />
      <SettingsClient
        initialStatus={status}
        initialConfig={integration.config || {}}
      />
    </div>
  );
}
