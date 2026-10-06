import { google } from 'googleapis';
import {
  getIntegration,
  getIntegrationToken,
  saveIntegrationToken,
} from '@parent-ai/shared';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks',
];

const FAMILY_TIMEZONE = 'Asia/Jerusalem';

// Computes the UTC offset (e.g. "+03:00") in effect for FAMILY_TIMEZONE on a given
// YYYY-MM-DD date, so we can build RFC3339 timestamps that correctly account for DST.
function getUtcOffset(dateStr: string): string {
  const anchor = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: FAMILY_TIMEZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(anchor);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  return tzName.replace('GMT', '') || '+00:00';
}

interface GoogleIntegrationConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  calendar_id?: string;
  task_list_id?: string;
}

// Shared across Calendar and Tasks — both use the same OAuth client/token,
// stored under the 'google_calendar' integration row.
export function getGoogleConfig(): GoogleIntegrationConfig {
  const integration = getIntegration('google_calendar');
  if (!integration) throw new Error('Google integration not configured');
  return JSON.parse(integration.config_json);
}

const getConfig = getGoogleConfig;

export function getOAuth2Client() {
  const config = getConfig();
  return new google.auth.OAuth2(config.client_id, config.client_secret, config.redirect_uri);
}

export function getAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  saveIntegrationToken('google_calendar', {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token ?? null,
    token_type: tokens.token_type ?? 'Bearer',
    expiry_date: tokens.expiry_date ?? null,
    scope: tokens.scope ?? null,
  });
  return tokens;
}

// Shared across Calendar and Tasks — same OAuth client/token.
export function getAuthorizedGoogleClient() {
  const client = getOAuth2Client();
  const token = getIntegrationToken('google_calendar');
  if (!token) throw new Error('Google account not connected — no tokens found');

  client.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_type: token.token_type,
    expiry_date: token.expiry_date,
  });

  // Auto-refresh and persist new tokens
  client.on('tokens', (newTokens) => {
    saveIntegrationToken('google_calendar', {
      access_token: newTokens.access_token!,
      refresh_token: newTokens.refresh_token ?? token.refresh_token,
      token_type: newTokens.token_type ?? 'Bearer',
      expiry_date: newTokens.expiry_date ?? null,
      scope: newTokens.scope ?? null,
    });
  });

  return client;
}

export function getCalendarClient() {
  return google.calendar({ version: 'v3', auth: getAuthorizedGoogleClient() });
}

export async function listCalendars() {
  const calendar = getCalendarClient();
  const res = await calendar.calendarList.list();
  return (res.data.items || []).map((cal) => ({
    id: cal.id,
    summary: cal.summary,
    primary: cal.primary || false,
  }));
}

export async function createCalendarEvent(params: {
  summary: string;
  description?: string;
  startDate: string;
  endDate?: string;
  isAllDay: boolean;
  color?: string;
  recurrenceRule?: string;
}) {
  const config = getConfig();
  const calendarId = config.calendar_id || 'primary';
  const calendar = getCalendarClient();

  // Google Calendar colorId mapping (1-11)
  const colorMap: Record<string, string> = {
    lavender: '1', sage: '2', grape: '3', flamingo: '4',
    banana: '5', tangerine: '6', peacock: '7', graphite: '8',
    blueberry: '9', basil: '10', tomato: '11',
  };

  const event: Record<string, unknown> = {
    summary: params.summary,
    description: params.description,
  };

  if (params.color) {
    const colorId = colorMap[params.color.toLowerCase()] || params.color;
    if (/^\d+$/.test(colorId)) event.colorId = colorId;
  }

  const timeZone = FAMILY_TIMEZONE;

  if (params.isAllDay) {
    event.start = { date: params.startDate, timeZone };
    event.end = { date: params.endDate || params.startDate, timeZone };
  } else {
    event.start = { dateTime: params.startDate, timeZone };
    event.end = { dateTime: params.endDate || params.startDate, timeZone };
  }

  if (params.recurrenceRule) {
    const rule = params.recurrenceRule.trim();
    event.recurrence = [rule.toUpperCase().startsWith('RRULE:') ? rule : `RRULE:${rule}`];
  }

  const res = await calendar.events.insert({
    calendarId,
    requestBody: event,
  });

  return {
    eventId: res.data.id,
    htmlLink: res.data.htmlLink,
  };
}

export async function listEvents(params: { from: string; to: string }) {
  const config = getConfig();
  const calendarId = config.calendar_id || 'primary';
  const calendar = getCalendarClient();

  const timeMin = `${params.from}T00:00:00${getUtcOffset(params.from)}`;
  const timeMax = `${params.to}T23:59:59${getUtcOffset(params.to)}`;

  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true, // expands recurring events (e.g. yearly birthdays) into occurrences
    orderBy: 'startTime',
    maxResults: 250,
  });

  return (res.data.items || []).map((e) => ({
    id: e.id,
    summary: e.summary || '(no title)',
    description: e.description || undefined,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    isAllDay: !!e.start?.date,
    location: e.location || undefined,
  }));
}
