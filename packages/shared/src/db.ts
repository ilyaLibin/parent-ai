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

  CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL UNIQUE,
    config_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS renovation_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4f46e5',
    sort_order INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS renovation_workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    offer_price REAL,
    stage TEXT NOT NULL DEFAULT 'contact',
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (job_id) REFERENCES renovation_jobs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_renovation_workers_job ON renovation_workers(job_id);

  CREATE TABLE IF NOT EXISTS renovation_phases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4f46e5',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (job_id) REFERENCES renovation_jobs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_renovation_phases_job ON renovation_phases(job_id);

  CREATE TABLE IF NOT EXISTS renovation_phase_deps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phase_id INTEGER NOT NULL,
    depends_on_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (phase_id) REFERENCES renovation_phases(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_id) REFERENCES renovation_phases(id) ON DELETE CASCADE,
    UNIQUE(phase_id, depends_on_id)
  );
  CREATE INDEX IF NOT EXISTS idx_renovation_phase_deps_phase ON renovation_phase_deps(phase_id);
  CREATE INDEX IF NOT EXISTS idx_renovation_phase_deps_dep ON renovation_phase_deps(depends_on_id);

  CREATE TABLE IF NOT EXISTS integration_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_type TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type TEXT NOT NULL DEFAULT 'Bearer',
    expiry_date INTEGER,
    scope TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
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

// Migrate: add sort_order column to renovation_jobs
const renovationJobColumns = db.pragma('table_info(renovation_jobs)') as { name: string }[];
const renovationJobColNames = new Set(renovationJobColumns.map((c) => c.name));
if (!renovationJobColNames.has('sort_order')) {
  db.exec('ALTER TABLE renovation_jobs ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  // Set initial sort_order based on existing start_date order
  const existingJobs = db.prepare('SELECT id FROM renovation_jobs ORDER BY start_date ASC').all() as { id: number }[];
  existingJobs.forEach((j, i) => db.prepare('UPDATE renovation_jobs SET sort_order = ? WHERE id = ?').run(i, j.id));
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

// Integrations
export interface Integration {
  id: number;
  type: string;
  config_json: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

interface IntegrationRow {
  id: number;
  type: string;
  config_json: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function rowToIntegration(row: IntegrationRow): Integration {
  return { ...row, enabled: row.enabled === 1 };
}

export function getIntegration(type: string): Integration | undefined {
  const row = db.prepare('SELECT * FROM integrations WHERE type = ?').get(type) as IntegrationRow | undefined;
  return row ? rowToIntegration(row) : undefined;
}

export function saveIntegration(type: string, configJson: string, enabled = true): Integration {
  const now = Date.now();
  db.prepare(`
    INSERT INTO integrations (type, config_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(type) DO UPDATE SET config_json = excluded.config_json, enabled = excluded.enabled, updated_at = excluded.updated_at
  `).run(type, configJson, enabled ? 1 : 0, now, now);
  return getIntegration(type)!;
}

export function deleteIntegration(type: string): boolean {
  const result = db.prepare('DELETE FROM integrations WHERE type = ?').run(type);
  db.prepare('DELETE FROM integration_tokens WHERE integration_type = ?').run(type);
  return result.changes > 0;
}

export interface IntegrationToken {
  id: number;
  integration_type: string;
  access_token: string;
  refresh_token: string | null;
  token_type: string;
  expiry_date: number | null;
  scope: string | null;
  created_at: number;
  updated_at: number;
}

export function getIntegrationToken(type: string): IntegrationToken | undefined {
  return db.prepare('SELECT * FROM integration_tokens WHERE integration_type = ?').get(type) as IntegrationToken | undefined;
}

export function saveIntegrationToken(type: string, token: { access_token: string; refresh_token?: string | null; token_type?: string; expiry_date?: number | null; scope?: string | null }): IntegrationToken {
  const now = Date.now();
  db.prepare(`
    INSERT INTO integration_tokens (integration_type, access_token, refresh_token, token_type, expiry_date, scope, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(integration_type) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, token_type = excluded.token_type, expiry_date = excluded.expiry_date, scope = excluded.scope, updated_at = excluded.updated_at
  `).run(type, token.access_token, token.refresh_token ?? null, token.token_type ?? 'Bearer', token.expiry_date ?? null, token.scope ?? null, now, now);
  return getIntegrationToken(type)!;
}

export function deleteIntegrationToken(type: string): boolean {
  return db.prepare('DELETE FROM integration_tokens WHERE integration_type = ?').run(type).changes > 0;
}

// Renovation jobs & workers
export interface RenovationJob {
  id: number;
  name: string;
  category: string;
  start_date: string;
  end_date: string;
  color: string;
  sort_order: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface RenovationJobWithWorker extends RenovationJob {
  accepted_worker_name: string | null;
  accepted_worker_price: number | null;
  worker_count: number;
  contact_count: number;
  contacted_count: number;
  offer_count: number;
  has_accepted_worker: boolean;
  max_worker_stage: string | null;
}

export interface RenovationWorker {
  id: number;
  job_id: number;
  name: string;
  phone: string | null;
  offer_price: number | null;
  stage: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

const STAGE_ORDER = ['contact', 'contacted', 'offer', 'accepted'];

function deriveMaxStage(rows: { stage: string }[]): string | null {
  if (rows.length === 0) return null;
  let max = -1;
  for (const r of rows) {
    const idx = STAGE_ORDER.indexOf(r.stage);
    if (idx > max) max = idx;
  }
  return max >= 0 ? STAGE_ORDER[max] : null;
}

export function getRenovationJobs(): RenovationJobWithWorker[] {
  const jobs = db.prepare(`
    SELECT j.*,
      aw.name as accepted_worker_name,
      aw.offer_price as accepted_worker_price,
      (SELECT COUNT(*) FROM renovation_workers WHERE job_id = j.id) as worker_count,
      (SELECT COUNT(*) FROM renovation_workers WHERE job_id = j.id AND stage = 'contact') as contact_count,
      (SELECT COUNT(*) FROM renovation_workers WHERE job_id = j.id AND stage = 'contacted') as contacted_count,
      (SELECT COUNT(*) FROM renovation_workers WHERE job_id = j.id AND stage = 'offer') as offer_count
    FROM renovation_jobs j
    LEFT JOIN renovation_workers aw ON aw.job_id = j.id AND aw.stage = 'accepted'
    ORDER BY j.sort_order ASC, j.start_date ASC
  `).all() as (RenovationJob & { accepted_worker_name: string | null; accepted_worker_price: number | null; worker_count: number; contact_count: number; contacted_count: number; offer_count: number })[];

  // Get max stage per job
  const stageRows = db.prepare('SELECT job_id, stage FROM renovation_workers').all() as { job_id: number; stage: string }[];
  const stagesByJob = new Map<number, { stage: string }[]>();
  for (const r of stageRows) {
    if (!stagesByJob.has(r.job_id)) stagesByJob.set(r.job_id, []);
    stagesByJob.get(r.job_id)!.push(r);
  }

  return jobs.map(r => ({
    ...r,
    has_accepted_worker: r.accepted_worker_name !== null,
    max_worker_stage: deriveMaxStage(stagesByJob.get(r.id) || []),
  }));
}

export function getRenovationJob(id: number): RenovationJobWithWorker | undefined {
  const row = db.prepare(`
    SELECT j.*,
      aw.name as accepted_worker_name,
      aw.offer_price as accepted_worker_price,
      (SELECT COUNT(*) FROM renovation_workers WHERE job_id = j.id) as worker_count,
      (SELECT COUNT(*) FROM renovation_workers WHERE job_id = j.id AND stage = 'contact') as contact_count,
      (SELECT COUNT(*) FROM renovation_workers WHERE job_id = j.id AND stage = 'contacted') as contacted_count,
      (SELECT COUNT(*) FROM renovation_workers WHERE job_id = j.id AND stage = 'offer') as offer_count
    FROM renovation_jobs j
    LEFT JOIN renovation_workers aw ON aw.job_id = j.id AND aw.stage = 'accepted'
    WHERE j.id = ?
  `).get(id) as (RenovationJob & { accepted_worker_name: string | null; accepted_worker_price: number | null; worker_count: number; contact_count: number; contacted_count: number; offer_count: number }) | undefined;
  if (!row) return undefined;
  const stages = db.prepare('SELECT stage FROM renovation_workers WHERE job_id = ?').all(id) as { stage: string }[];
  return { ...row, has_accepted_worker: row.accepted_worker_name !== null, max_worker_stage: deriveMaxStage(stages) };
}

export function createRenovationJob(job: { name: string; category: string; start_date: string; end_date: string; color?: string; notes?: string }): RenovationJobWithWorker {
  const now = Date.now();
  const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM renovation_jobs').get() as { m: number | null })?.m ?? -1;
  const result = db.prepare(
    'INSERT INTO renovation_jobs (name, category, start_date, end_date, color, sort_order, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(job.name, job.category, job.start_date, job.end_date, job.color ?? '#4f46e5', maxOrder + 1, job.notes ?? null, now, now);
  return getRenovationJob(Number(result.lastInsertRowid))!;
}

export function updateRenovationJob(id: number, updates: Partial<{ name: string; category: string; start_date: string; end_date: string; color: string; sort_order: number; notes: string }>): RenovationJobWithWorker | undefined {
  const fields: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) { fields.push(`${key} = ?`); values.push(val); }
  }
  if (fields.length === 0) return getRenovationJob(id);
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  const changes = db.prepare(`UPDATE renovation_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes;
  return changes > 0 ? getRenovationJob(id) : undefined;
}

export function deleteRenovationJob(id: number): boolean {
  return db.prepare('DELETE FROM renovation_jobs WHERE id = ?').run(id).changes > 0;
}

export function reorderRenovationJobs(orderedIds: number[]): void {
  const stmt = db.prepare('UPDATE renovation_jobs SET sort_order = ?, updated_at = ? WHERE id = ?');
  const now = Date.now();
  const tx = db.transaction(() => {
    orderedIds.forEach((id, i) => stmt.run(i, now, id));
  });
  tx();
}

export function getRenovationWorkers(jobId: number): RenovationWorker[] {
  return db.prepare('SELECT * FROM renovation_workers WHERE job_id = ? ORDER BY created_at ASC').all(jobId) as RenovationWorker[];
}

export function createRenovationWorker(worker: { job_id: number; name: string; phone?: string; offer_price?: number; stage?: string; notes?: string }): RenovationWorker {
  const now = Date.now();
  const result = db.prepare(
    'INSERT INTO renovation_workers (job_id, name, phone, offer_price, stage, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(worker.job_id, worker.name, worker.phone ?? null, worker.offer_price ?? null, worker.stage ?? 'contact', worker.notes ?? null, now, now);
  return db.prepare('SELECT * FROM renovation_workers WHERE id = ?').get(result.lastInsertRowid) as RenovationWorker;
}

export function updateRenovationWorker(id: number, updates: Partial<{ name: string; phone: string; offer_price: number; stage: string; notes: string }>): RenovationWorker | undefined {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) { fields.push(`${key} = ?`); values.push(val); }
  }
  if (fields.length === 0) return db.prepare('SELECT * FROM renovation_workers WHERE id = ?').get(id) as RenovationWorker | undefined;
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  const changes = db.prepare(`UPDATE renovation_workers SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes;
  return changes > 0 ? db.prepare('SELECT * FROM renovation_workers WHERE id = ?').get(id) as RenovationWorker : undefined;
}

export function deleteRenovationWorker(id: number): boolean {
  return db.prepare('DELETE FROM renovation_workers WHERE id = ?').run(id).changes > 0;
}

// Renovation phases
export interface RenovationPhase {
  id: number;
  job_id: number;
  name: string;
  start_date: string;
  end_date: string;
  color: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export function getRenovationPhases(jobId: number): RenovationPhase[] {
  return db.prepare('SELECT * FROM renovation_phases WHERE job_id = ? ORDER BY sort_order ASC, start_date ASC').all(jobId) as RenovationPhase[];
}

export function getAllRenovationPhases(): RenovationPhase[] {
  return db.prepare('SELECT * FROM renovation_phases ORDER BY sort_order ASC, start_date ASC').all() as RenovationPhase[];
}

export function createRenovationPhase(phase: { job_id: number; name: string; start_date: string; end_date: string; color?: string; sort_order?: number }): RenovationPhase {
  const now = Date.now();
  const result = db.prepare(
    'INSERT INTO renovation_phases (job_id, name, start_date, end_date, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(phase.job_id, phase.name, phase.start_date, phase.end_date, phase.color ?? '#4f46e5', phase.sort_order ?? 0, now, now);
  recalcJobDatesFromPhases(phase.job_id);
  return db.prepare('SELECT * FROM renovation_phases WHERE id = ?').get(result.lastInsertRowid) as RenovationPhase;
}

export function updateRenovationPhase(id: number, updates: Partial<{ name: string; start_date: string; end_date: string; color: string; sort_order: number }>): RenovationPhase | undefined {
  const phase = db.prepare('SELECT * FROM renovation_phases WHERE id = ?').get(id) as RenovationPhase | undefined;
  if (!phase) return undefined;
  const fields: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) { fields.push(`${key} = ?`); values.push(val); }
  }
  if (fields.length === 0) return phase;
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  db.prepare(`UPDATE renovation_phases SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  recalcJobDatesFromPhases(phase.job_id);
  return db.prepare('SELECT * FROM renovation_phases WHERE id = ?').get(id) as RenovationPhase;
}

export function deleteRenovationPhase(id: number): boolean {
  const phase = db.prepare('SELECT job_id FROM renovation_phases WHERE id = ?').get(id) as { job_id: number } | undefined;
  const deleted = db.prepare('DELETE FROM renovation_phases WHERE id = ?').run(id).changes > 0;
  if (deleted && phase) recalcJobDatesFromPhases(phase.job_id);
  return deleted;
}

// ── Phase dependencies (finish-to-start) ──

export interface PhaseDependency {
  id: number;
  phase_id: number;
  depends_on_id: number;
  created_at: number;
}

export function getAllPhaseDependencies(): PhaseDependency[] {
  return db.prepare('SELECT * FROM renovation_phase_deps').all() as PhaseDependency[];
}

export function createPhaseDependency(phaseId: number, dependsOnId: number): PhaseDependency | null {
  if (phaseId === dependsOnId) return null;
  // Check for cycles: dependsOnId must not be reachable from phaseId
  if (wouldCreateCycle(phaseId, dependsOnId)) return null;
  const now = Date.now();
  try {
    const result = db.prepare(
      'INSERT INTO renovation_phase_deps (phase_id, depends_on_id, created_at) VALUES (?, ?, ?)'
    ).run(phaseId, dependsOnId, now);
    return db.prepare('SELECT * FROM renovation_phase_deps WHERE id = ?').get(result.lastInsertRowid) as PhaseDependency;
  } catch {
    return null; // UNIQUE constraint violation
  }
}

export function deletePhaseDependency(id: number): boolean {
  return db.prepare('DELETE FROM renovation_phase_deps WHERE id = ?').run(id).changes > 0;
}

export function deletePhaseDependencyByPair(phaseId: number, dependsOnId: number): boolean {
  return db.prepare('DELETE FROM renovation_phase_deps WHERE phase_id = ? AND depends_on_id = ?').run(phaseId, dependsOnId).changes > 0;
}

function wouldCreateCycle(phaseId: number, dependsOnId: number): boolean {
  // BFS from phaseId following forward deps — if we reach dependsOnId, it's a cycle
  const deps = db.prepare('SELECT phase_id, depends_on_id FROM renovation_phase_deps').all() as { phase_id: number; depends_on_id: number }[];
  const forward = new Map<number, number[]>();
  for (const d of deps) {
    if (!forward.has(d.depends_on_id)) forward.set(d.depends_on_id, []);
    forward.get(d.depends_on_id)!.push(d.phase_id);
  }
  const visited = new Set<number>();
  const queue = [phaseId];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    if (cur === dependsOnId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const successors = forward.get(cur) || [];
    queue.push(...successors);
  }
  return false;
}

function recalcJobDatesFromPhases(jobId: number): void {
  const phases = db.prepare('SELECT start_date, end_date FROM renovation_phases WHERE job_id = ?').all(jobId) as { start_date: string; end_date: string }[];
  if (phases.length === 0) return; // no phases — keep job dates as-is
  const starts = phases.map(p => p.start_date).sort();
  const ends = phases.map(p => p.end_date).sort();
  db.prepare('UPDATE renovation_jobs SET start_date = ?, end_date = ?, updated_at = ? WHERE id = ?')
    .run(starts[0], ends[ends.length - 1], Date.now(), jobId);
}

export { db };
