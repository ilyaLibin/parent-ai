import { google } from 'googleapis';
import {
  getIntegration,
  getIntegrationToken,
  saveIntegrationToken,
} from '@parent-ai/shared';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];

interface GoogleCalendarConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  calendar_id?: string;
}

function getConfig(): GoogleCalendarConfig {
  const integration = getIntegration('google_calendar');
  if (!integration) throw new Error('Google Calendar integration not configured');
  return JSON.parse(integration.config_json);
}

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

export function getCalendarClient() {
  const client = getOAuth2Client();
  const token = getIntegrationToken('google_calendar');
  if (!token) throw new Error('Google Calendar not connected — no tokens found');

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

  return google.calendar({ version: 'v3', auth: client });
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

  const timeZone = 'Asia/Jerusalem';

  if (params.isAllDay) {
    event.start = { date: params.startDate, timeZone };
    event.end = { date: params.endDate || params.startDate, timeZone };
  } else {
    event.start = { dateTime: params.startDate, timeZone };
    event.end = { dateTime: params.endDate || params.startDate, timeZone };
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
