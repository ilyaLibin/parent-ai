import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
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
    prompt TEXT,
    model TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    success INTEGER,
    error TEXT,
    steps_json TEXT,
    result_text TEXT,
    model TEXT,
    token_usage_json TEXT,
    FOREIGN KEY (task_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id, started_at);

  CREATE TABLE IF NOT EXISTS action_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    date TEXT NOT NULL,
    source_group_id TEXT,
    source_group_name TEXT,
    summary TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    dismissed INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_action_items_date ON action_items(date);
`);

// Migrate: add color column to action_items if missing
const actionColumns = db.pragma('table_info(action_items)') as { name: string }[];
const actionColNames = new Set(actionColumns.map((c) => c.name));
if (!actionColNames.has('color')) db.exec('ALTER TABLE action_items ADD COLUMN color TEXT');

// Migrate: add new columns to cron_jobs if missing (for existing databases)
const cronColumns = db.pragma('table_info(cron_jobs)') as { name: string }[];
const cronColNames = new Set(cronColumns.map((c) => c.name));
if (!cronColNames.has('prompt')) db.exec('ALTER TABLE cron_jobs ADD COLUMN prompt TEXT');
if (!cronColNames.has('model')) db.exec('ALTER TABLE cron_jobs ADD COLUMN model TEXT');

// Migrate: add tracked column to groups
const groupColumns = db.pragma('table_info(groups)') as { name: string }[];
const groupColNames = new Set(groupColumns.map((c) => c.name));
if (!groupColNames.has('tracked')) {
  db.exec('ALTER TABLE groups ADD COLUMN tracked INTEGER NOT NULL DEFAULT 0');
  // Only track groups that actually have messages
  db.exec('UPDATE groups SET tracked = 1 WHERE id IN (SELECT DISTINCT group_id FROM messages)');
}

// Seed tracked groups from env var (every startup)
const envTrackedIds = (process.env.TRACKED_GROUP_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

if (envTrackedIds.length > 0) {
  const seedTracked = db.prepare(`
    INSERT INTO groups (id, name, tracked, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET tracked = 1
  `);
  const now = Date.now();
  for (const id of envTrackedIds) {
    seedTracked.run(id, id, now);
  }
}

// Migrate: merge system_prompt + user_prompt → prompt (one-time)
if (cronColNames.has('system_prompt')) {
  // Concatenate system_prompt and user_prompt into prompt for any rows that have system_prompt but no prompt
  db.exec(`UPDATE cron_jobs SET prompt = COALESCE(system_prompt, '') || CASE WHEN user_prompt IS NOT NULL THEN char(10) || char(10) || user_prompt ELSE '' END WHERE system_prompt IS NOT NULL AND (prompt IS NULL OR prompt = '')`);
  // SQLite doesn't support DROP COLUMN before 3.35.0 — just leave old columns, they'll be ignored
}

// --- Seeding (runs once, tracked via _meta table) ---
db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)`);

const seeded = db.prepare(`SELECT value FROM _meta WHERE key = 'seeded_v2'`).get() as { value: string } | undefined;

// If this is an existing DB (has cron_jobs but no seed marker), mark as already seeded
// so we don't re-insert deleted tasks
const existingJobCount = (db.prepare('SELECT COUNT(*) as c FROM cron_jobs').get() as { c: number }).c;
if (!seeded && existingJobCount > 0) {
  db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)`).run('seeded_v2', String(Date.now()));
}

const shouldSeed = !db.prepare(`SELECT value FROM _meta WHERE key = 'seeded_v2'`).get();

if (shouldSeed) {
  const now = Date.now();

  const AVIV_DAILY_REPORT_PROMPT = `You are a school assistant for Aviv's parents. Your job is to:
1. Fetch recent messages from Aviv's school WhatsApp groups (group IDs: 120363331200450674@g.us, 120363327802106026@g.us)
2. If any messages contain images (type "image"), transcribe them — they often contain homework assignments or important notices
3. Look up the school schedule from the knowledge base (name: "aviv_school_schedule")
4. Combine all information with the school schedule to generate a clear, actionable daily report in Hebrew
5. Send the report via Telegram

## Context
- Aviv is in class ב1 (2nd grade)
- His main teacher is Vered (ורד)
- Today is: {{today}}
- Tomorrow is: {{tomorrow}}

## Report format (in Hebrew)
The Telegram message should include:
- 📚 *שיעורי בית* — homework assignments found in messages or images
- 📋 *מערכת שעות למחר* — tomorrow's lessons from the schedule
- 📌 *דברים להביא* — things to bring to school
- ⚠️ *הודעות חשובות* — important announcements or schedule changes
- ✅ *פעולות נדרשות* — action items for parents

Keep it short, clear, and in Hebrew. Use bullet points. Skip empty sections.
Use Telegram Markdown: *bold* for headers.

Generate the daily school report for tomorrow ({{tomorrow}}). Start by fetching messages from the last 24 hours from Aviv's school groups, then look up the schedule from knowledge.`;

  const TODAYS_SCHEDULE_PROMPT = `You are a school assistant for Aviv's parents. Aviv is in class ב1 (2nd grade).
Look up the school schedule from the knowledge base (name: "aviv_school_schedule"), extract today's lessons, and send a short Telegram message in Hebrew.

Format the message as a clear list with lesson number, subject, and teacher.
Add a short friendly greeting at the top. Keep it concise.
Use Telegram Markdown: *bold* for the header.

Today is {{today}} ({{date}}). Look up the school schedule from knowledge and send today's schedule to Telegram.`;

  db.prepare(`
    INSERT OR IGNORE INTO cron_jobs (name, schedule, endpoint, method, body, enabled, prompt, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('aviv-daily-report', '0 20 * * 0-4', '', 'POST', null, 0, AVIV_DAILY_REPORT_PROMPT, 'sonnet', now, now);

  db.prepare(`
    INSERT OR IGNORE INTO cron_jobs (name, schedule, endpoint, method, body, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('daily-summary', '0 20 * * *', '/summary/daily', 'POST', null, 0, now, now);

  db.prepare(`
    INSERT OR IGNORE INTO cron_jobs (name, schedule, endpoint, method, body, enabled, prompt, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('todays-schedule', '40 16 * * *', '', 'POST', null, 1, TODAYS_SCHEDULE_PROMPT, 'sonnet', now, now);

  db.prepare(`INSERT INTO _meta (key, value) VALUES (?, ?)`).run('seeded_v2', String(now));
}

// Seed knowledge from .md files — runs every startup, INSERT OR IGNORE won't overwrite existing entries
const KNOWLEDGE_DIR = join(__dirname, '..', 'knowledge');
try {
  const knowledgeNow = Date.now();
  const files = readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const name = basename(file, '.md');
    const content = readFileSync(join(KNOWLEDGE_DIR, file), 'utf-8');
    db.prepare(`INSERT OR IGNORE INTO knowledge (name, content, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(name, content, knowledgeNow, knowledgeNow);
  }
} catch {
  // Knowledge dir may not exist in all environments
}

// Migrate existing agent-based jobs that only have system_prompt but no prompt (runs every time, idempotent)
if (cronColNames.has('system_prompt')) {
  db.exec(`UPDATE cron_jobs SET prompt = COALESCE(system_prompt, '') || CASE WHEN user_prompt IS NOT NULL THEN char(10) || char(10) || user_prompt ELSE '' END WHERE system_prompt IS NOT NULL AND (prompt IS NULL OR prompt = '')`);
}

export interface Group {
  id: string;
  name: string;
  tracked: boolean;
  updated_at: number;
}

interface GroupRow {
  id: string;
  name: string;
  tracked: number;
  updated_at: number;
}

function rowToGroup(row: GroupRow): Group {
  return { ...row, tracked: row.tracked === 1 };
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
  return (db.prepare('SELECT * FROM groups ORDER BY name').all() as GroupRow[]).map(rowToGroup);
}

export function getGroupsByIds(ids: string[]): Group[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return (db.prepare(`SELECT * FROM groups WHERE id IN (${placeholders}) ORDER BY name`).all(...ids) as GroupRow[]).map(rowToGroup);
}

export function getGroupByName(name: string): Group | undefined {
  const row = db.prepare(
    'SELECT * FROM groups WHERE LOWER(name) LIKE LOWER(?)'
  ).get(`%${name}%`) as GroupRow | undefined;
  return row ? rowToGroup(row) : undefined;
}

export function getGroupById(id: string): Group | undefined {
  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRow | undefined;
  return row ? rowToGroup(row) : undefined;
}

export function isGroupTracked(groupId: string): boolean {
  const row = db.prepare('SELECT tracked FROM groups WHERE id = ?').get(groupId) as { tracked: number } | undefined;
  return row?.tracked === 1;
}

export function setGroupTracked(groupId: string, tracked: boolean): Group | undefined {
  const result = db.prepare('UPDATE groups SET tracked = ? WHERE id = ?').run(tracked ? 1 : 0, groupId);
  if (result.changes === 0) return undefined;
  return getGroupById(groupId);
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
  prompt: string | null;
  model: string | null;
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
  prompt: string | null;
  model: string | null;
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

export function createCronJob(job: { name: string; schedule: string; endpoint?: string; method?: string; body?: string | null; enabled?: boolean; prompt?: string | null; model?: string | null }): CronJob {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO cron_jobs (name, schedule, endpoint, method, body, enabled, prompt, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(job.name, job.schedule, job.endpoint || '', job.method || 'POST', job.body ?? null, job.enabled !== false ? 1 : 0, job.prompt ?? null, job.model ?? null, now, now);
  return getCronJob(result.lastInsertRowid as number)!;
}

export function updateCronJobById(id: number, updates: Partial<{ name: string; schedule: string; endpoint: string; method: string; body: string | null; enabled: boolean; prompt: string | null; model: string | null }>): CronJob | undefined {
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
  if (updates.prompt !== undefined) { fields.push('prompt = ?'); values.push(updates.prompt); }
  if (updates.model !== undefined) { fields.push('model = ?'); values.push(updates.model); }

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

// Knowledge CRUD
export interface Knowledge {
  id: number;
  name: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export function getKnowledgeList(): Omit<Knowledge, 'content'>[] {
  return db.prepare('SELECT id, name, created_at, updated_at FROM knowledge ORDER BY name').all() as Omit<Knowledge, 'content'>[];
}

export function getKnowledgeById(id: number): Knowledge | undefined {
  return db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id) as Knowledge | undefined;
}

export function getKnowledgeByName(name: string): Knowledge | undefined {
  return db.prepare('SELECT * FROM knowledge WHERE name = ?').get(name) as Knowledge | undefined;
}

export function createKnowledge(entry: { name: string; content: string }): Knowledge {
  const now = Date.now();
  const result = db.prepare('INSERT INTO knowledge (name, content, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(entry.name, entry.content, now, now);
  return getKnowledgeById(result.lastInsertRowid as number)!;
}

export function updateKnowledgeById(id: number, updates: Partial<{ name: string; content: string }>): Knowledge | undefined {
  const existing = getKnowledgeById(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.prepare(`UPDATE knowledge SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getKnowledgeById(id);
}

export function deleteKnowledgeById(id: number): boolean {
  return db.prepare('DELETE FROM knowledge WHERE id = ?').run(id).changes > 0;
}

// Task runs
export interface TaskRun {
  id: number;
  task_id: number;
  started_at: number;
  completed_at: number | null;
  success: number | null;
  error: string | null;
  steps_json: string | null;
  result_text: string | null;
  model: string | null;
  token_usage_json: string | null;
}

export function createTaskRun(run: { task_id: number; started_at: number; model?: string | null }): number {
  const result = db.prepare('INSERT INTO task_runs (task_id, started_at, model) VALUES (?, ?, ?)')
    .run(run.task_id, run.started_at, run.model ?? null);
  return result.lastInsertRowid as number;
}

export function updateTaskRunSteps(id: number, stepsJson: string): void {
  db.prepare('UPDATE task_runs SET steps_json = ? WHERE id = ?').run(stepsJson, id);
}

export function completeTaskRun(id: number, data: { completed_at: number; success: boolean; error?: string | null; steps_json?: string | null; result_text?: string | null; token_usage_json?: string | null }): void {
  db.prepare(`UPDATE task_runs SET completed_at = ?, success = ?, error = ?, steps_json = ?, result_text = ?, token_usage_json = ? WHERE id = ?`)
    .run(data.completed_at, data.success ? 1 : 0, data.error ?? null, data.steps_json ?? null, data.result_text ?? null, data.token_usage_json ?? null, id);
}

export function getTaskRuns(taskId?: number, limit = 50): TaskRun[] {
  if (taskId) {
    return db.prepare('SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?').all(taskId, limit) as TaskRun[];
  }
  return db.prepare('SELECT * FROM task_runs ORDER BY started_at DESC LIMIT ?').all(limit) as TaskRun[];
}

export function getTaskRun(id: number): TaskRun | undefined {
  return db.prepare('SELECT * FROM task_runs WHERE id = ?').get(id) as TaskRun | undefined;
}

export function getDailyMessageCounts(sinceTimestamp: number, groupIds?: string[]): { date: string; count: number }[] {
  if (groupIds && groupIds.length > 0) {
    const placeholders = groupIds.map(() => '?').join(',');
    return db.prepare(`
      SELECT DATE(timestamp / 1000, 'unixepoch', 'localtime') as date, COUNT(*) as count
      FROM messages WHERE timestamp >= ? AND group_id IN (${placeholders})
      GROUP BY date ORDER BY date
    `).all(sinceTimestamp, ...groupIds) as { date: string; count: number }[];
  }
  return db.prepare(`
    SELECT DATE(timestamp / 1000, 'unixepoch', 'localtime') as date, COUNT(*) as count
    FROM messages WHERE timestamp >= ?
    GROUP BY date ORDER BY date
  `).all(sinceTimestamp) as { date: string; count: number }[];
}

export function getCronJobByName(name: string): CronJob | undefined {
  const row = db.prepare('SELECT * FROM cron_jobs WHERE name = ?').get(name) as CronJobRow | undefined;
  return row ? rowToCronJob(row) : undefined;
}

// Action items
export interface ActionItem {
  id: number;
  description: string;
  date: string;
  source_group_id: string | null;
  source_group_name: string | null;
  summary: string | null;
  color: string | null;
  created_at: string;
  dismissed: boolean;
}

interface ActionItemRow {
  id: number;
  description: string;
  date: string;
  source_group_id: string | null;
  source_group_name: string | null;
  summary: string | null;
  color: string | null;
  created_at: string;
  dismissed: number;
}

function rowToActionItem(row: ActionItemRow): ActionItem {
  return { ...row, dismissed: row.dismissed === 1 };
}

export function getActionItems(from?: string, to?: string): ActionItem[] {
  const conditions = ['dismissed = 0'];
  const params: string[] = [];
  if (from) { conditions.push('date >= ?'); params.push(from); }
  if (to) { conditions.push('date <= ?'); params.push(to); }
  const where = conditions.join(' AND ');
  return (db.prepare(`SELECT * FROM action_items WHERE ${where} ORDER BY date ASC, id ASC`).all(...params) as ActionItemRow[]).map(rowToActionItem);
}

export function createActionItem(item: { description: string; date: string; source_group_id?: string | null; source_group_name?: string | null; summary?: string | null; color?: string | null }): ActionItem {
  const result = db.prepare(
    'INSERT INTO action_items (description, date, source_group_id, source_group_name, summary, color) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(item.description, item.date, item.source_group_id ?? null, item.source_group_name ?? null, item.summary ?? null, item.color ?? null);
  return rowToActionItem(db.prepare('SELECT * FROM action_items WHERE id = ?').get(result.lastInsertRowid) as ActionItemRow);
}

export function dismissActionItem(id: number): boolean {
  return db.prepare('UPDATE action_items SET dismissed = 1 WHERE id = ?').run(id).changes > 0;
}

export function deleteActionItem(id: number): boolean {
  return db.prepare('DELETE FROM action_items WHERE id = ?').run(id).changes > 0;
}

export { db };
