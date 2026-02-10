import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getMessagesTool } from './tools/get-messages.tool.js';
import { transcribeImageTool } from './tools/transcribe-image.tool.js';
import { sendTelegramTool } from './tools/send-telegram.tool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_PKG = join(__dirname, '..', '..', '..', 'shared');
const KNOWLEDGE_DIR = join(SHARED_PKG, 'knowledge');

const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const AVIV_SCHOOL_GROUPS = [
  '120363331200450674@g.us',
  '120363327802106026@g.us',
];

export interface DailyReportResult {
  success: boolean;
  steps: number;
  error?: string;
}

export async function runDailyReportAgent(): Promise<DailyReportResult> {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayDay = HEBREW_DAYS[now.getDay()];
  const tomorrowDay = HEBREW_DAYS[tomorrow.getDay()];

  const schedule = readFileSync(join(KNOWLEDGE_DIR, 'aviv_school_schedule.md'), 'utf-8');

  const systemPrompt = `You are a school assistant for Aviv's parents. Your job is to:
1. Fetch recent messages from Aviv's school WhatsApp groups
2. If any messages contain images (type "image"), transcribe them — they often contain homework assignments or important notices
3. Combine all information with the school schedule to generate a clear, actionable daily report in Hebrew
4. Send the report via Telegram

## Context
- Aviv is in class ב1 (2nd grade)
- His main teacher is Vered (ורד)
- Today is: יום ${todayDay} (${now.toLocaleDateString('he-IL')})
- Tomorrow is: יום ${tomorrowDay} (${tomorrow.toLocaleDateString('he-IL')})

## Tomorrow's schedule
${schedule.split(`### יום ${getTomorrowHebrewDayChar(tomorrow.getDay())}`)[1]?.split('###')[0]?.trim() || 'No schedule found for tomorrow.'}

## Full weekly schedule (for reference)
${schedule}

## Report format (in Hebrew)
The Telegram message should include:
- 📚 **שיעורי בית** — homework assignments found in messages or images
- 📋 **מערכת שעות למחר** — tomorrow's lessons from the schedule
- 📌 **דברים להביא** — things to bring to school
- ⚠️ **הודעות חשובות** — important announcements or schedule changes
- ✅ **פעולות נדרשות** — action items for parents

Keep it short, clear, and in Hebrew. Use bullet points. Skip empty sections.
Use Telegram Markdown: *bold* for headers, no special escaping needed.`;

  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: systemPrompt,
      prompt: `Generate the daily school report for tomorrow (יום ${tomorrowDay}). Start by fetching messages from the last 24 hours from Aviv's school groups.`,
      tools: {
        getMessages: getMessagesTool,
        transcribeImage: transcribeImageTool,
        sendTelegram: sendTelegramTool,
      },
      maxSteps: 10,
    });

    return {
      success: true,
      steps: result.steps.length,
    };
  } catch (err) {
    return {
      success: false,
      steps: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function getTomorrowHebrewDayChar(dayOfWeek: number): string {
  const dayChars = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'שבת'];
  return dayChars[dayOfWeek] || 'א';
}
