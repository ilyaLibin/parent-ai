import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DB_PATH || './data/messages.db';

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db: DatabaseType = new Database(DB_PATH);

// Enable WAL mode for better concurrent read/write performance
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT,
    content TEXT,
    message_type TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    raw_json TEXT,
    FOREIGN KEY (group_id) REFERENCES groups(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_group_time
    ON messages(group_id, timestamp);

  CREATE INDEX IF NOT EXISTS idx_messages_timestamp
    ON messages(timestamp);

  CREATE TABLE IF NOT EXISTS connection_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id TEXT NOT NULL,
    recipient_name TEXT,
    message_text TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    sent_at INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_scheduled_status_time
    ON scheduled_messages(status, scheduled_at);

  CREATE TABLE IF NOT EXISTS cron_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    schedule TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'POST',
    body TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// Seed default cron jobs (only on first boot — INSERT OR IGNORE respects UNIQUE name)
const now = Date.now();
db.prepare(`
  INSERT OR IGNORE INTO cron_jobs (name, schedule, endpoint, method, body, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run('aviv-daily-report', '0 20 * * 0-4', '/summary/agent/daily-report', 'POST', null, 0, now, now);

db.prepare(`
  INSERT OR IGNORE INTO cron_jobs (name, schedule, endpoint, method, body, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run('daily-summary', '0 20 * * *', '/summary/daily', 'POST', null, 0, now, now);

db.prepare(`
  INSERT OR IGNORE INTO cron_jobs (name, schedule, endpoint, method, body, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run('todays-schedule', '40 16 * * *', '/summary/todays', 'POST', null, 1, now, now);

export interface Group {
  id: string;
  name: string;
  updated_at: number;
}

export interface Message {
  id: string;
  group_id: string;
  sender_id: string;
  sender_name: string | null;
  content: string | null;
  message_type: string;
  timestamp: number;
}

// Prepared statements for performance
const upsertGroup = db.prepare(`
  INSERT INTO groups (id, name, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    updated_at = excluded.updated_at
`);

const upsertMessage = db.prepare(`
  INSERT INTO messages (id, group_id, sender_id, sender_name, content, message_type, timestamp, raw_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`);

const logConnection = db.prepare(`
  INSERT INTO connection_log (event, timestamp, details)
  VALUES (?, ?, ?)
`);

export function saveGroup(id: string, name: string): void {
  upsertGroup.run(id, name, Date.now());
}

export function saveMessage(msg: Message & { raw_json?: string }): boolean {
  const result = upsertMessage.run(
    msg.id,
    msg.group_id,
    msg.sender_id,
    msg.sender_name,
    msg.content,
    msg.message_type,
    msg.timestamp,
    msg.raw_json || null
  );
  return result.changes > 0; // true if inserted, false if already existed
}

export function logConnectionEvent(event: string, details?: string): void {
  logConnection.run(event, Date.now(), details || null);
}

export function getGroups(): Group[] {
  return db.prepare('SELECT * FROM groups ORDER BY name').all() as Group[];
}

export function getGroupsByIds(ids: string[]): Group[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM groups WHERE id IN (${placeholders}) ORDER BY name`).all(...ids) as Group[];
}

export function getGroupByName(name: string): Group | undefined {
  return db.prepare(
    'SELECT * FROM groups WHERE LOWER(name) LIKE LOWER(?)'
  ).get(`%${name}%`) as Group | undefined;
}

export function getGroupById(id: string): Group | undefined {
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as Group | undefined;
}

// Resolve group by ID or name - ID takes precedence if it looks like a group ID
export function resolveGroup(identifier: string): Group | undefined {
  if (identifier.endsWith('@g.us')) {
    return getGroupById(identifier);
  }
  return getGroupByName(identifier);
}

export function getMessages(
  groupId: string,
  startTime: number,
  endTime: number
): Message[] {
  return db.prepare(`
    SELECT id, group_id, sender_id, sender_name, content, message_type, timestamp
    FROM messages
    WHERE group_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(groupId, startTime, endTime) as Message[];
}

export function getMessagesByGroupName(
  groupName: string,
  startTime: number,
  endTime: number
): Message[] {
  return db.prepare(`
    SELECT m.id, m.group_id, m.sender_id, m.sender_name, m.content, m.message_type, m.timestamp
    FROM messages m
    JOIN groups g ON m.group_id = g.id
    WHERE LOWER(g.name) LIKE LOWER(?)
      AND m.timestamp >= ? AND m.timestamp <= ?
    ORDER BY m.timestamp ASC
  `).all(`%${groupName}%`, startTime, endTime) as Message[];
}

// Get messages by group identifier (ID or name)
export function getMessagesByGroup(
  identifier: string,
  startTime: number,
  endTime: number
): { group: Group | undefined; messages: Message[] } {
  const group = resolveGroup(identifier);
  if (!group) {
    return { group: undefined, messages: [] };
  }
  const messages = getMessages(group.id, startTime, endTime);
  return { group, messages };
}

export function getMessageCount(groupId: string): number {
  const result = db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE group_id = ?'
  ).get(groupId) as { count: number };
  return result.count;
}

export function getConnectionGaps(hoursBack: number = 24): { start: number; end: number; duration_minutes: number }[] {
  const since = Date.now() - hoursBack * 60 * 60 * 1000;
  const logs = db.prepare(`
    SELECT event, timestamp FROM connection_log
    WHERE timestamp >= ?
    ORDER BY timestamp ASC
  `).all(since) as { event: string; timestamp: number }[];

  const gaps: { start: number; end: number; duration_minutes: number }[] = [];
  let lastDisconnect: number | null = null;

  for (const log of logs) {
    if (log.event === 'disconnected') {
      lastDisconnect = log.timestamp;
    } else if (log.event === 'connected' && lastDisconnect) {
      const duration = (log.timestamp - lastDisconnect) / 1000 / 60;
      if (duration > 1) { // Only log gaps > 1 minute
        gaps.push({
          start: lastDisconnect,
          end: log.timestamp,
          duration_minutes: Math.round(duration)
        });
      }
      lastDisconnect = null;
    }
  }

  return gaps;
}

// Scheduled messages
export interface ScheduledMessage {
  id: number;
  recipient_id: string;
  recipient_name: string | null;
  message_text: string;
  scheduled_at: number;
  created_at: number;
  sent_at: number | null;
  status: 'pending' | 'sent' | 'failed';
  error: string | null;
}

const insertScheduledMessage = db.prepare(`
  INSERT INTO scheduled_messages (recipient_id, recipient_name, message_text, scheduled_at, created_at, status)
  VALUES (?, ?, ?, ?, ?, 'pending')
`);

export function scheduleMessage(
  recipientId: string,
  recipientName: string | null,
  messageText: string,
  scheduledAt: Date
): number {
  const result = insertScheduledMessage.run(
    recipientId,
    recipientName,
    messageText,
    scheduledAt.getTime(),
    Date.now()
  );
  return result.lastInsertRowid as number;
}

export function getDueMessages(): ScheduledMessage[] {
  return db.prepare(`
    SELECT * FROM scheduled_messages
    WHERE status = 'pending' AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
  `).all(Date.now()) as ScheduledMessage[];
}

export function markMessageSent(id: number): void {
  db.prepare(`
    UPDATE scheduled_messages
    SET status = 'sent', sent_at = ?
    WHERE id = ?
  `).run(Date.now(), id);
}

export function markMessageFailed(id: number, error: string): void {
  db.prepare(`
    UPDATE scheduled_messages
    SET status = 'failed', error = ?
    WHERE id = ?
  `).run(error, id);
}

export function getPendingMessages(): ScheduledMessage[] {
  return db.prepare(`
    SELECT * FROM scheduled_messages
    WHERE status = 'pending'
    ORDER BY scheduled_at ASC
  `).all() as ScheduledMessage[];
}

export function getMessageRawJson(messageId: string): string | null {
  const row = db.prepare('SELECT raw_json FROM messages WHERE id = ?').get(messageId) as { raw_json: string | null } | undefined;
  return row?.raw_json ?? null;
}

// Cron jobs
export interface CronJob {
  id: number;
  name: string;
  schedule: string;
  endpoint: string;
  method: string;
  body: string | null;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

interface CronJobRow {
  id: number;
  name: string;
  schedule: string;
  endpoint: string;
  method: string;
  body: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function rowToCronJob(row: CronJobRow): CronJob {
  return { ...row, enabled: row.enabled === 1 };
}

export function getCronJobs(enabledOnly?: boolean): CronJob[] {
  const rows = enabledOnly
    ? db.prepare('SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY id').all() as CronJobRow[]
    : db.prepare('SELECT * FROM cron_jobs ORDER BY id').all() as CronJobRow[];
  return rows.map(rowToCronJob);
}

export function getCronJob(id: number): CronJob | undefined {
  const row = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJobRow | undefined;
  return row ? rowToCronJob(row) : undefined;
}

export function createCronJob(job: { name: string; schedule: string; endpoint: string; method?: string; body?: string | null; enabled?: boolean }): CronJob {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO cron_jobs (name, schedule, endpoint, method, body, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(job.name, job.schedule, job.endpoint, job.method || 'POST', job.body ?? null, job.enabled !== false ? 1 : 0, now, now);
  return getCronJob(result.lastInsertRowid as number)!;
}

export function updateCronJobById(id: number, updates: Partial<{ name: string; schedule: string; endpoint: string; method: string; body: string | null; enabled: boolean }>): CronJob | undefined {
  const existing = getCronJob(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.schedule !== undefined) { fields.push('schedule = ?'); values.push(updates.schedule); }
  if (updates.endpoint !== undefined) { fields.push('endpoint = ?'); values.push(updates.endpoint); }
  if (updates.method !== undefined) { fields.push('method = ?'); values.push(updates.method); }
  if (updates.body !== undefined) { fields.push('body = ?'); values.push(updates.body); }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.prepare(`UPDATE cron_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getCronJob(id);
}

export function deleteCronJobById(id: number): boolean {
  const result = db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
  return result.changes > 0;
}

export { db };
