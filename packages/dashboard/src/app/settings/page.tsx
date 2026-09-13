import { PageHeader } from '../components/page-header';
import { SettingsClient } from './settings-client';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

interface CalendarStatus {
  configured: boolean;
  connected: boolean;
  calendarId: string | null;
  taskListId: string | null;
  expiresAt: number | null;
}

interface IntegrationConfig {
  config?: {
    client_id?: string;
    client_secret?: string;
    redirect_uri?: string;
    calendar_id?: string;
    task_list_id?: string;
    api_key?: string;
  };
}

async function getCalendarStatus(): Promise<CalendarStatus> {
  try {
    const res = await fetch(`${API_URL}/calendar/status`, { cache: 'no-store' });
    if (!res.ok) return { configured: false, connected: false, calendarId: null, taskListId: null, expiresAt: null };
    return res.json();
  } catch {
    return { configured: false, connected: false, calendarId: null, taskListId: null, expiresAt: null };
  }
}

async function getIntegrationConfig(type: string): Promise<IntegrationConfig> {
  try {
    const res = await fetch(`${API_URL}/integrations/${type}`, { cache: 'no-store' });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export default async function SettingsPage() {
  const [status, integration, geminiIntegration] = await Promise.all([
    getCalendarStatus(),
    getIntegrationConfig('google_calendar'),
    getIntegrationConfig('gemini'),
  ]);

  return (
    <div>
      <PageHeader title="Settings" />
      <SettingsClient
        initialStatus={status}
        initialConfig={integration.config || {}}
        initialGeminiConfig={geminiIntegration.config || {}}
      />
    </div>
  );
}
