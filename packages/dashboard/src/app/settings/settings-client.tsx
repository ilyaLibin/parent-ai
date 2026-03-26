'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

interface CalendarStatus {
  configured: boolean;
  connected: boolean;
  calendarId: string | null;
  expiresAt: number | null;
}

interface CalendarEntry {
  id: string;
  summary: string;
  primary: boolean;
}

interface Props {
  initialStatus: CalendarStatus;
  initialConfig: {
    client_id?: string;
    client_secret?: string;
    redirect_uri?: string;
    calendar_id?: string;
  };
}

export function SettingsClient({ initialStatus, initialConfig }: Props) {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState(initialStatus);

  // Config form
  const [clientId, setClientId] = useState(initialConfig.client_id || '');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(initialConfig.redirect_uri || '');
  const [saving, setSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  // Calendar selector
  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState(initialConfig.calendar_id || '');
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  // Toast for callback redirect
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (searchParams.get('connected') === 'true') {
      setToast('Google Calendar connected successfully');
      setStatus((s) => ({ ...s, connected: true }));
      // Load calendars after connection
      loadCalendars();
    }
    if (searchParams.get('error')) {
      setToast(`Error: ${searchParams.get('error')}`);
    }
  }, [searchParams]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  async function handleSaveConfig() {
    setSaving(true);
    try {
      const config: Record<string, string> = {
        client_id: clientId,
        redirect_uri: redirectUri,
      };
      // Only send secret if user typed a new one (not the redacted one)
      if (clientSecret && !clientSecret.includes('***')) {
        config.client_secret = clientSecret;
      } else if (initialConfig.client_secret) {
        // Keep the existing secret on the server — don't overwrite with redacted value
        // The server already has it; we just send the other fields
      }

      // If we have an existing secret on server, do a merge: fetch current, overlay
      if (!config.client_secret) {
        // Fetch current full config from a helper endpoint is not available,
        // so we need to send the secret. Require user to re-enter it.
        // Actually, let's handle this differently: always require secret for first save,
        // and for updates we merge server-side.
        // For simplicity: if no new secret provided and config exists, send without secret
        // and let the server merge.
      }

      await fetch('/api/integrations/google_calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });

      setConfigSaved(true);
      setStatus((s) => ({ ...s, configured: true }));
      setTimeout(() => setConfigSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    const res = await fetch('/api/calendar/auth-url');
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      setToast(data.error || 'Failed to get auth URL');
    }
  }

  async function handleDisconnect() {
    await fetch('/api/calendar/disconnect', { method: 'DELETE' });
    setStatus((s) => ({ ...s, connected: false, calendarId: null }));
    setCalendars([]);
    setSelectedCalendar('');
  }

  async function loadCalendars() {
    setLoadingCalendars(true);
    try {
      const res = await fetch('/api/calendar/calendars');
      if (res.ok) {
        const data = await res.json();
        setCalendars(data);
      }
    } finally {
      setLoadingCalendars(false);
    }
  }

  async function handleSelectCalendar(calendarId: string) {
    setSelectedCalendar(calendarId);
    await fetch('/api/calendar/select-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId }),
    });
    setStatus((s) => ({ ...s, calendarId }));
  }

  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div className="max-w-2xl space-y-8">
      {/* Toast */}
      {toast && (
        <div className={`px-4 py-2 rounded-lg text-sm ${toast.startsWith('Error') ? 'bg-red-500/10 text-error border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
          {toast}
        </div>
      )}

      {/* Google Calendar */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Google Calendar</h3>

        {/* Status badge */}
        <div className="flex items-center gap-2 mb-4">
          <span className={`inline-block w-2 h-2 rounded-full ${status.connected ? 'bg-green-400' : status.configured ? 'bg-yellow-400' : 'bg-fg-muted/30'}`} />
          <span className="text-sm text-fg-secondary">
            {status.connected ? 'Connected' : status.configured ? 'Configured — not connected' : 'Not configured'}
          </span>
          {status.calendarId && (
            <span className="text-xs text-fg-muted">({status.calendarId})</span>
          )}
        </div>

        {/* Setup guide */}
        <div className="rounded-lg border border-border bg-surface-secondary overflow-hidden">
          <button
            onClick={() => setGuideOpen(!guideOpen)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-fg-secondary hover:text-fg transition-colors"
          >
            <span>How to get Google Calendar credentials</span>
            <svg className={`w-4 h-4 transition-transform ${guideOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {guideOpen && (
            <div className="px-4 pb-4 text-sm text-fg-secondary space-y-3 border-t border-border pt-3">
              <ol className="list-decimal list-inside space-y-2">
                <li>
                  Go to the{' '}
                  <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    Google Cloud Console &rarr; Credentials
                  </a>
                </li>
                <li>Create a project (or select an existing one)</li>
                <li>
                  Enable the{' '}
                  <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    Google Calendar API
                  </a>
                </li>
                <li>
                  Go to <strong>Credentials</strong> &rarr; <strong>Create Credentials</strong> &rarr; <strong>OAuth client ID</strong>
                </li>
                <li>
                  Application type: <strong>Web application</strong>
                </li>
                <li>
                  Under <strong>Authorized redirect URIs</strong>, add your callback URL
                  <br />
                  <code className="text-xs bg-surface-hover px-1.5 py-0.5 rounded">
                    http://your-host:3033/calendar/callback
                  </code>
                </li>
                <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> into the form below</li>
                <li>Set the <strong>Redirect URI</strong> to the same callback URL you added in Google Cloud</li>
              </ol>
              <p className="text-xs text-fg-muted pt-1">
                If the app is in &quot;Testing&quot; mode in Google Cloud, add your Google account as a test user
                under <strong>OAuth consent screen</strong> &rarr; <strong>Test users</strong>.
              </p>
            </div>
          )}
        </div>

        {/* Config form */}
        <div className="space-y-3 p-4 rounded-lg border border-border bg-surface-secondary">
          <div>
            <label className="block text-xs text-fg-muted mb-1 uppercase tracking-wider">Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full input-inset rounded-lg px-3 py-2 text-sm"
              placeholder="your-client-id.apps.googleusercontent.com"
            />
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-1 uppercase tracking-wider">Client Secret</label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              className="w-full input-inset rounded-lg px-3 py-2 text-sm"
              placeholder={initialConfig.client_secret ? '••••••' : 'GOCSPX-...'}
            />
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-1 uppercase tracking-wider">Redirect URI</label>
            <input
              type="text"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              className="w-full input-inset rounded-lg px-3 py-2 text-sm"
              placeholder="http://localhost:3033/calendar/callback"
            />
          </div>
          <button
            onClick={handleSaveConfig}
            disabled={saving || !clientId.trim() || !redirectUri.trim()}
            className="btn-accent rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? '...' : configSaved ? 'Saved' : 'Save config'}
          </button>
        </div>

        {/* Connect / Disconnect */}
        {status.configured && (
          <div className="mt-4 flex items-center gap-3">
            {!status.connected ? (
              <button
                onClick={handleConnect}
                className="btn-accent rounded-lg px-4 py-2 text-sm font-medium"
              >
                Connect Google Calendar
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-error rounded-lg text-sm border border-red-500/20 transition-colors"
              >
                Disconnect
              </button>
            )}
          </div>
        )}

        {/* Calendar selector */}
        {status.connected && (
          <div className="mt-4 p-4 rounded-lg border border-border bg-surface-secondary">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs text-fg-muted uppercase tracking-wider">Calendar</label>
              <button
                onClick={loadCalendars}
                disabled={loadingCalendars}
                className="text-xs text-accent hover:text-accent/80 transition-colors"
              >
                {loadingCalendars ? 'Loading...' : 'Refresh list'}
              </button>
            </div>
            {calendars.length > 0 ? (
              <select
                value={selectedCalendar}
                onChange={(e) => handleSelectCalendar(e.target.value)}
                className="w-full input-inset rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select a calendar...</option>
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id!}>
                    {cal.summary}{cal.primary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-fg-muted">Click &quot;Refresh list&quot; to load calendars</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
