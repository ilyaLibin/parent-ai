import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getGroups, getGroupsByIds } from '../db.js';
import { summarizeGroup, SummaryResult } from '../summarize.js';
import { sendTelegram } from './telegram.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = join(__dirname, '..', 'knowledge');

// Aviv's school group IDs (first two tracked groups)
const AVIV_SCHOOL_GROUPS = [
  '120363331200450674@g.us',
  '120363327802106026@g.us',
];

const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// --- Flexible range summary ---

export interface RangeSummaryParams {
  groupIds?: string[];
  hoursBack?: number;
  startTime?: Date;
  endTime?: Date;
  customPrompt?: string;
}

export async function rangeSummary(params: RangeSummaryParams): Promise<{
  groupsSummarized: number;
  errors: string[];
}> {
  const now = new Date();
  const endTime = params.endTime ?? now;
  const startTime = params.startTime ?? new Date(now.getTime() - (params.hoursBack ?? 24) * 60 * 60 * 1000);

  const groups = params.groupIds
    ? getGroupsByIds(params.groupIds)
    : getGroups();

  const errors: string[] = [];
  let count = 0;

  for (const group of groups) {
    try {
      const result = await summarizeGroup(group.id, startTime, endTime, {
        customPrompt: params.customPrompt,
      });
      if (result.messageCount === 0) continue;

      const text = formatSummaryForTelegram(result);
      await sendTelegram(text);
      count++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${group.name}: ${msg}`);
    }
  }

  return { groupsSummarized: count, errors };
}

// --- Daily summary (all groups, default prompt) ---

export async function dailySummary() {
  return rangeSummary({ hoursBack: 24 });
}

// --- Aviv school summary ---

export async function avivSchoolSummary() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayDay = HEBREW_DAYS[now.getDay()];
  const tomorrowDay = HEBREW_DAYS[tomorrow.getDay()];

  const promptTemplate = readFileSync(join(KNOWLEDGE_DIR, 'aviv_school_prompt.md'), 'utf-8');
  const schedule = readFileSync(join(KNOWLEDGE_DIR, 'aviv_school_schedule.md'), 'utf-8');

  const prompt = promptTemplate
    .replace('{{today}}', `יום ${todayDay} (${now.toLocaleDateString('he-IL')})`)
    .replace('{{tomorrow}}', `יום ${tomorrowDay} (${tomorrow.toLocaleDateString('he-IL')})`)
    .replace('{{schedule}}', schedule);

  return rangeSummary({
    groupIds: AVIV_SCHOOL_GROUPS,
    hoursBack: 24,
    customPrompt: prompt,
  });
}

// --- Formatting ---

function formatSummaryForTelegram(result: SummaryResult): string {
  let text = `*${escapeMarkdown(result.groupName)}*\n`;
  text += `${result.messageCount} messages | ${result.period.start.toLocaleDateString()} - ${result.period.end.toLocaleDateString()}\n\n`;
  text += escapeMarkdown(result.summary);

  if (result.actionItems.length > 0) {
    text += `\n\n*Action Items:*\n`;
    text += result.actionItems.map((item) => `- ${escapeMarkdown(item)}`).join('\n');
  }

  if (result.keyTopics.length > 0) {
    text += `\n\n*Topics:* ${result.keyTopics.map(escapeMarkdown).join(', ')}`;
  }

  return text;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
