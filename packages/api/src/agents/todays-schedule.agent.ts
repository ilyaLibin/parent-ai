import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sendTelegramTool } from './tools/send-telegram.tool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_PKG = join(__dirname, '..', '..', '..', 'shared');
const KNOWLEDGE_DIR = join(SHARED_PKG, 'knowledge');

const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export interface TodaysScheduleResult {
  success: boolean;
  steps: number;
  error?: string;
}

export async function runTodaysScheduleAgent(): Promise<TodaysScheduleResult> {
  const now = new Date();
  const todayDay = HEBREW_DAYS[now.getDay()];
  const schedule = readFileSync(join(KNOWLEDGE_DIR, 'aviv_school_schedule.md'), 'utf-8');

  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: `You are a school assistant for Aviv's parents. Aviv is in class ב1 (2nd grade).
Given the weekly schedule, extract today's lessons and send a short Telegram message in Hebrew.

Format the message as a clear list with lesson number, subject, and teacher.
Add a short friendly greeting at the top. Keep it concise.
Use Telegram Markdown: *bold* for the header.`,
      prompt: `Today is יום ${todayDay} (${now.toLocaleDateString('he-IL')}).

Here is the full weekly schedule:
${schedule}

Send today's schedule to Telegram.`,
      tools: {
        sendTelegram: sendTelegramTool,
      },
      maxSteps: 3,
    });

    return { success: true, steps: result.steps.length };
  } catch (err) {
    return {
      success: false,
      steps: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
