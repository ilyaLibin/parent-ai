import type { FunctionDeclaration } from '@google/genai';
import { getGeminiClient, GEMINI_MODEL } from '../services/gemini.service.js';
import {
  getMessages,
  getGroups,
  getGroupsByIds,
  getMessageRawJson,
  downloadMedia,
  getKnowledgeList,
  getKnowledgeByName,
  createKnowledge,
  updateKnowledgeById,
  createActionItem,
  getActionItems,
  createCronJob,
  scheduleMessage,
  getPendingMessages,
  cancelScheduledMessage,
  type Group,
} from '@parent-ai/shared';
import { sendTelegram, sendTelegramAudio } from '../services/telegram.service.js';
import { createCalendarEvent as createGCalEvent, listEvents as listGCalEvents } from '../services/google-calendar.service.js';
import { createTask as createGTask, listTasks as listGTasks } from '../services/google-tasks.service.js';

const FAMILY_TIMEZONE = 'Asia/Jerusalem';

// The model (and its own date-grounding context) works in naive Asia/Jerusalem
// datetime strings with no UTC offset. `new Date(naiveString)` is NOT safe for that —
// its interpretation depends on the runtime's own system timezone (UTC in Docker,
// but whatever the dev machine happens to be locally), silently landing hours off.
// Compute the real Asia/Jerusalem offset for that moment and attach it explicitly.
function parseFamilyLocalDateTime(dateTimeStr: string): Date {
  if (/[Zz]$|[+-]\d{2}:\d{2}$/.test(dateTimeStr)) {
    return new Date(dateTimeStr); // already carries explicit timezone info
  }
  const anchor = new Date(`${dateTimeStr}Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: FAMILY_TIMEZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(anchor);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const offset = tzName.replace('GMT', '') || '+00:00';
  return new Date(`${dateTimeStr}${offset}`);
}

export const toolDefinitions: FunctionDeclaration[] = [
  {
    name: 'getMessages',
    description:
      'Fetch WhatsApp messages from tracked groups within a time range. Returns messages with sender, content, type, and timestamp. Messages with type "image" contain an image that can be transcribed using the transcribeImage tool.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        groupIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific group IDs to fetch. If omitted, fetches from all tracked groups.',
        },
        hoursBack: {
          type: 'number',
          description: 'How many hours back to fetch messages. Defaults to 24.',
        },
      },
      required: [],
    },
  },
  {
    name: 'transcribeImage',
    description:
      'Download and transcribe an image from a WhatsApp message. Use this when a message has type "image" to extract text or describe the image content (e.g., homework photos, schedules, announcements).',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID of the image message to transcribe.',
        },
        context: {
          type: 'string',
          description: 'Optional context about what to look for in the image.',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'sendTelegram',
    description:
      'Send a formatted message to the user via Telegram. Use this to deliver the final report or summary. Supports Markdown formatting.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'The message text to send. Supports Telegram Markdown formatting.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'sendTelegramAudio',
    description:
      'Convert text to speech and send it as an audio message to the user via Telegram. Use this when the user asks for a voice/audio message or when audio delivery is more appropriate. The TTS engine only supports English (and a few other non-Hebrew languages) — it cannot speak Hebrew. If the response would otherwise be in Hebrew or another unsupported language, translate the text to English before passing it to this tool.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'The text to convert to speech and send as audio. Must be in English — translate first if the natural response would be in Hebrew or another language, since the TTS engine cannot pronounce it.',
        },
        voice: {
          type: 'string',
          description: 'TTS voice to use. Defaults to "af_heart". Options include: af_heart, af_bella, af_nicole, af_sarah, am_adam, am_michael, etc.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'listKnowledge',
    description: 'List all available knowledge entries by name.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'getKnowledge',
    description: 'Get the content of a knowledge entry by name.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'The name of the knowledge entry to retrieve.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'saveKnowledge',
    description:
      'Create or update a knowledge base entry by name. If an entry with this name already exists, its content is fully replaced — use getKnowledge first if you need to merge with or preserve existing content rather than overwrite it. Use this when the user explicitly asks to update/save something to the knowledge base (e.g. a school schedule extracted from a photo). Special case: the entry named "system_prompt" is auto-injected into every future run as a standing instruction — use it (getKnowledge first, then append, never blindly overwrite) whenever the user asks you to remember a preference or behave differently going forward, not just for reference documents.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'The knowledge entry name (e.g. "aviv_school_schedule"). If it already exists, its content is replaced; otherwise a new entry is created.',
        },
        content: {
          type: 'string',
          description: 'The full markdown content to save.',
        },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'getActionItems',
    description:
      'Get existing action items, optionally filtered by date range. Use this before creating new action items to avoid duplicates.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string',
          description: 'Start date filter in YYYY-MM-DD format.',
        },
        to: {
          type: 'string',
          description: 'End date filter in YYYY-MM-DD format.',
        },
      },
      required: [],
    },
  },
  {
    name: 'createActionItem',
    description:
      'Create an action item extracted from WhatsApp messages. Use this to save tasks, events, deadlines, or things parents need to do.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string',
          description: 'Clear description of the action item.',
        },
        date: {
          type: 'string',
          description: 'The date this action item is for, in YYYY-MM-DD format.',
        },
        sourceGroupId: {
          type: 'string',
          description: 'WhatsApp group ID the item was extracted from.',
        },
        sourceGroupName: {
          type: 'string',
          description: 'Human-readable name of the source group.',
        },
        summary: {
          type: 'string',
          description: 'Summary of the message or exchange the item was extracted from.',
        },
        color: {
          type: 'string',
          description: 'Color hex code for the action item. Use the "Action Item colors" knowledge entry to determine the correct color based on the source group.',
        },
      },
      required: ['description', 'date'],
    },
  },
  {
    name: 'createScheduledTask',
    description:
      "Create a new recurring scheduled agent task (shown on the dashboard's Tasks page) — e.g. a daily/weekly report, reminder, or automated check that runs on its own on a cron schedule. This is DIFFERENT from createTask (Google Tasks to-do items) and createCalendarEvent (one-off calendar events) — use this only when the user wants something to run repeatedly and unattended. For safety, the task is always created DISABLED — it will not run until a human reviews and enables it in the dashboard. Always tell the user the reviewUrl from the result so they can enable it.",
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'A short unique identifier for the task, e.g. "weekly-homework-check" (lowercase, hyphenated, no spaces).',
        },
        schedule: {
          type: 'string',
          description: 'A 5-field cron expression (minute hour day-of-month month day-of-week), e.g. "0 20 * * 0" for every Sunday at 8pm.',
        },
        prompt: {
          type: 'string',
          description: 'The full instructions for the agent to follow each time this task runs. Can use template variables {{today}}, {{tomorrow}}, {{date}}, {{datetime}}.',
        },
      },
      required: ['name', 'schedule', 'prompt'],
    },
  },
  {
    name: 'scheduleWhatsAppMessage',
    description:
      'Schedule a WhatsApp text message to be sent to a specific contact at a future (or near-immediate) time. Only use this in the WhatsApp message-scheduler chat, targeting a contact that was just shared via a contact card earlier in this conversation — never invent, guess, or reuse a phone number/JID from anywhere else. If the user\'s request includes the message text in quotes, use that exact text verbatim as messageText — do not paraphrase, reword, or "improve" it unless they explicitly ask you to fix grammar or add something.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        recipientId: {
          type: 'string',
          description: 'The WhatsApp JID of the recipient, from a contact shared earlier in this conversation (e.g. "9725...@s.whatsapp.net").',
        },
        recipientName: {
          type: 'string',
          description: 'The recipient\'s display name, from the shared contact.',
        },
        messageText: {
          type: 'string',
          description: 'The exact message text to send.',
        },
        scheduledAt: {
          type: 'string',
          description: 'Datetime for when to send, in the same format as the current date/time given above (local Asia/Jerusalem time, no UTC offset, e.g. "2026-09-17T09:23:00"). Resolve relative times ("in 5 minutes", "tomorrow at 9am") against that current date/time.',
        },
      },
      required: ['recipientId', 'messageText', 'scheduledAt'],
    },
  },
  {
    name: 'listScheduledWhatsAppMessages',
    description: 'List pending (not yet sent) scheduled WhatsApp messages, including their id (needed for cancelScheduledWhatsAppMessage). Use this before cancelling, or when the user asks what\'s scheduled.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'cancelScheduledWhatsAppMessage',
    description: 'Cancel a pending scheduled WhatsApp message by id (from listScheduledWhatsAppMessages). Has no effect if it was already sent — check the result and tell the user if it was too late.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'number',
          description: 'The scheduled message id to cancel.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'getCalendarEvents',
    description:
      'List events from the family Google Calendar within a date range. Use this to answer questions like "what do I have today", "what\'s happening this week", or "when is the next birthday". Recurring events (e.g. yearly birthdays) are automatically expanded into their individual occurrences within the range.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format.',
        },
        to: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (inclusive). Use the same value as "from" to query a single day.',
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'createCalendarEvent',
    description:
      'Create a Google Calendar event. Use this when the user asks to schedule something or when an action item should be added to the calendar.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        summary: {
          type: 'string',
          description: 'Event title.',
        },
        description: {
          type: 'string',
          description: 'Optional event description or details.',
        },
        startDate: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format for all-day events, or ISO 8601 datetime for timed events.',
        },
        endDate: {
          type: 'string',
          description: 'Optional end date/datetime. Defaults to the same as startDate.',
        },
        isAllDay: {
          type: 'boolean',
          description: 'Whether this is an all-day event (true) or has specific times (false).',
        },
        color: {
          type: 'string',
          description: 'Optional Google Calendar color name (e.g. "tomato", "banana", "sage") or numeric color ID (1-11).',
        },
      },
      required: ['summary', 'startDate', 'isAllDay'],
    },
  },
  {
    name: 'createTask',
    description:
      "Create a to-do entry on the family's Google Tasks list. Use this for reminders and to-dos that don't have a specific date/time (unlike createCalendarEvent, which is for scheduled events).",
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'The task title.',
        },
        notes: {
          type: 'string',
          description: 'Optional additional details for the task.',
        },
        due: {
          type: 'string',
          description: 'Optional due date in YYYY-MM-DD format (Google Tasks only supports a due date, not a due time).',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'listTasks',
    description: "List existing to-do entries on the family's Google Tasks list. Use this before creating a task to avoid duplicates.",
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        showCompleted: {
          type: 'boolean',
          description: 'Whether to include already-completed tasks. Defaults to false.',
        },
      },
      required: [],
    },
  },
];

const toolImplementations: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async getMessages(args) {
    const groupIds = args.groupIds as string[] | undefined;
    const hoursBack = (args.hoursBack as number) || 24;
    const now = Date.now();
    const since = now - hoursBack * 60 * 60 * 1000;

    const groups: Group[] = groupIds ? getGroupsByIds(groupIds) : getGroups().filter((g) => g.tracked);

    const result = groups.map((g) => {
      const messages = getMessages(g.id, since, now);
      return {
        groupId: g.id,
        groupName: g.name,
        messages: messages.map((m) => ({
          id: m.id,
          sender: m.sender_name || m.sender_id.split('@')[0],
          content: m.content || `[${m.message_type}]`,
          type: m.message_type,
          time: new Date(m.timestamp).toISOString(),
        })),
      };
    });

    const totalMessages = result.reduce((sum, g) => sum + g.messages.length, 0);
    return { totalMessages, groups: result };
  },

  async transcribeImage(args) {
    const messageId = args.messageId as string;
    const context = args.context as string | undefined;

    const rawJson = getMessageRawJson(messageId);
    if (!rawJson) {
      return { success: false, error: `Message ${messageId} not found or has no raw data.` };
    }

    let imageBuffer: Buffer;
    try {
      imageBuffer = await downloadMedia(rawJson);
    } catch (err) {
      return {
        success: false,
        error: `Failed to download image: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const base64 = imageBuffer.toString('base64');
    const prompt = context
      ? `Extract all text and important information from this image. Context: ${context}. If the image contains Hebrew text, transcribe it in Hebrew.`
      : `Extract all text and important information from this image. If it contains Hebrew text, transcribe it in Hebrew. Describe any visual content that provides useful information.`;

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64 } },
            { text: prompt },
          ],
        },
      ],
    });

    return { success: true, transcription: response.text || '' };
  },

  async sendTelegram(args) {
    const text = args.text as string;
    try {
      await sendTelegram(text);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Failed to send Telegram message: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async sendTelegramAudio(args) {
    const text = args.text as string;
    const voice = (args.voice as string) || 'af_heart';
    try {
      await sendTelegramAudio(text, voice);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Failed to send audio: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async listKnowledge() {
    const entries = getKnowledgeList();
    return { entries: entries.map((e) => ({ name: e.name, updated_at: e.updated_at })) };
  },

  async getKnowledge(args) {
    const name = args.name as string;
    const entry = getKnowledgeByName(name);
    if (!entry) {
      return { success: false, error: `Knowledge entry "${name}" not found.` };
    }
    return { success: true, name: entry.name, content: entry.content };
  },

  async saveKnowledge(args) {
    const name = args.name as string;
    const content = args.content as string;
    const existing = getKnowledgeByName(name);
    if (existing) {
      const updated = updateKnowledgeById(existing.id, { content });
      return { success: true, id: updated!.id, name: updated!.name, action: 'updated' };
    }
    const created = createKnowledge({ name, content });
    return { success: true, id: created.id, name: created.name, action: 'created' };
  },

  async getActionItems(args) {
    const from = args.from as string | undefined;
    const to = args.to as string | undefined;
    const items = getActionItems(from, to);
    return { count: items.length, items: items.map((i) => ({ id: i.id, description: i.description, date: i.date, sourceGroupName: i.source_group_name })) };
  },

  async createScheduledTask(args) {
    try {
      const job = createCronJob({
        name: args.name as string,
        schedule: args.schedule as string,
        prompt: args.prompt as string,
        enabled: false,
      });
      const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
      return {
        success: true,
        id: job.id,
        name: job.name,
        enabled: false,
        reviewUrl: `${dashboardUrl}/tasks/${job.id}`,
      };
    } catch (err) {
      return { success: false, error: `Failed to create scheduled task: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async scheduleWhatsAppMessage(args) {
    try {
      const id = scheduleMessage(
        args.recipientId as string,
        (args.recipientName as string) || null,
        args.messageText as string,
        parseFamilyLocalDateTime(args.scheduledAt as string)
      );
      return { success: true, id };
    } catch (err) {
      return { success: false, error: `Failed to schedule message: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async listScheduledWhatsAppMessages() {
    const pending = getPendingMessages();
    return {
      count: pending.length,
      messages: pending.map((m) => ({
        id: m.id,
        recipientName: m.recipient_name,
        messageText: m.message_text,
        scheduledAt: new Date(m.scheduled_at).toISOString(),
      })),
    };
  },

  async cancelScheduledWhatsAppMessage(args) {
    const cancelled = cancelScheduledMessage(args.id as number);
    return cancelled
      ? { success: true }
      : { success: false, error: 'Not found, or already sent — too late to cancel.' };
  },

  async getCalendarEvents(args) {
    try {
      const events = await listGCalEvents({
        from: args.from as string,
        to: args.to as string,
      });
      return { count: events.length, events };
    } catch (err) {
      return { success: false, error: `Failed to fetch calendar events: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async createCalendarEvent(args) {
    try {
      const result = await createGCalEvent({
        summary: args.summary as string,
        description: args.description as string | undefined,
        startDate: args.startDate as string,
        endDate: args.endDate as string | undefined,
        isAllDay: args.isAllDay as boolean,
        color: args.color as string | undefined,
      });
      return { success: true, eventId: result.eventId, htmlLink: result.htmlLink };
    } catch (err) {
      return { success: false, error: `Failed to create calendar event: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async createTask(args) {
    try {
      const result = await createGTask({
        title: args.title as string,
        notes: args.notes as string | undefined,
        due: args.due as string | undefined,
      });
      return { success: true, taskId: result.taskId, title: result.title };
    } catch (err) {
      return { success: false, error: `Failed to create task: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async listTasks(args) {
    try {
      const items = await listGTasks({ showCompleted: args.showCompleted as boolean | undefined });
      return { count: items.length, items };
    } catch (err) {
      return { success: false, error: `Failed to list tasks: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async createActionItem(args) {
    const item = createActionItem({
      description: args.description as string,
      date: args.date as string,
      source_group_id: args.sourceGroupId as string | undefined,
      source_group_name: args.sourceGroupName as string | undefined,
      summary: args.summary as string | undefined,
      color: args.color as string | undefined,
    });
    return { success: true, id: item.id, description: item.description, date: item.date };
  },
};

export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const impl = toolImplementations[name];
  if (!impl) {
    return { error: `Unknown tool: ${name}` };
  }
  try {
    return await impl(args);
  } catch (err) {
    return { error: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
