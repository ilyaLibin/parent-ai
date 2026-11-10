import { google } from 'googleapis';
import { getIntegrationToken, saveIntegrationToken } from '@parent-ai/shared';
import { getOAuth2Client } from './google-calendar.service.js';

// Read-only Gmail access, used to pick up one-time login codes (e.g. Harel's) that are
// emailed to the user. It reuses the Google OAuth client from the google_calendar
// integration but keeps its own token under 'gmail', because the mailbox that receives
// the codes isn't necessarily the account the calendar is connected with.
const TOKEN_TYPE = 'gmail';
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// Passed through OAuth `state` so the shared /calendar/callback knows to store a Gmail token.
export const GMAIL_OAUTH_STATE = 'gmail';

export function getGmailAuthUrl(loginHint?: string): string {
  return getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: GMAIL_OAUTH_STATE,
    login_hint: loginHint,
  });
}

export async function exchangeGmailCode(code: string) {
  const { tokens } = await getOAuth2Client().getToken(code);
  saveIntegrationToken(TOKEN_TYPE, {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token ?? null,
    token_type: tokens.token_type ?? 'Bearer',
    expiry_date: tokens.expiry_date ?? null,
    scope: tokens.scope ?? null,
  });
}

export function isGmailConnected(): boolean {
  return !!getIntegrationToken(TOKEN_TYPE);
}

function getGmailClient() {
  const token = getIntegrationToken(TOKEN_TYPE);
  if (!token) throw new Error('Gmail not connected — open /gmail/auth-url and approve read-only access');

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_type: token.token_type,
    expiry_date: token.expiry_date,
  });
  client.on('tokens', (newTokens) => {
    saveIntegrationToken(TOKEN_TYPE, {
      access_token: newTokens.access_token!,
      refresh_token: newTokens.refresh_token ?? token.refresh_token,
      token_type: newTokens.token_type ?? 'Bearer',
      expiry_date: newTokens.expiry_date ?? null,
      scope: newTokens.scope ?? null,
    });
  });
  return google.gmail({ version: 'v1', auth: client });
}

export async function getGmailAddress(): Promise<string | null> {
  const res = await getGmailClient().users.getProfile({ userId: 'me' });
  return res.data.emailAddress ?? null;
}

// Polls for a message from `from` that arrived after `sinceMs` and returns the first
// match of `codePattern` in its snippet (codes are in the first line, so the snippet is enough).
export async function waitForEmailCode(opts: {
  from: string;
  sinceMs: number;
  codePattern?: RegExp;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<string> {
  const gmail = getGmailClient();
  const pattern = opts.codePattern ?? /\b(\d{4,8})\b/;
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  // Gmail's after: only has second granularity; filter precisely on internalDate below.
  const afterSec = Math.floor(opts.sinceMs / 1000) - 60;

  while (Date.now() < deadline) {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: `from:${opts.from} after:${afterSec}`,
      maxResults: 5,
    });
    for (const { id } of list.data.messages ?? []) {
      const msg = await gmail.users.messages.get({ userId: 'me', id: id!, format: 'minimal' });
      if (Number(msg.data.internalDate) < opts.sinceMs - 5_000) continue;
      const match = msg.data.snippet?.match(pattern);
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 4_000));
  }
  throw new Error(`No code email from ${opts.from} within ${Math.round((opts.timeoutMs ?? 120_000) / 1000)}s`);
}
