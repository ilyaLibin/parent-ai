import Anthropic from '@anthropic-ai/sdk';
import {
  getMessages,
  getGroups,
  getGroupsByIds,
  getMessageRawJson,
  downloadMedia,
  getKnowledgeList,
  getKnowledgeByName,
  type Group,
} from '@parent-ai/shared';
import { sendTelegram } from '../services/telegram.service.js';

const anthropic = new Anthropic();

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'getMessages',
    description:
      'Fetch WhatsApp messages from tracked groups within a time range. Returns messages with sender, content, type, and timestamp. Messages with type "image" contain an image that can be transcribed using the transcribeImage tool.',
    input_schema: {
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
    input_schema: {
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
    input_schema: {
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
    name: 'listKnowledge',
    description: 'List all available knowledge entries by name.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'getKnowledge',
    description: 'Get the content of a knowledge entry by name.',
    input_schema: {
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
];

const toolImplementations: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async getMessages(args) {
    const groupIds = args.groupIds as string[] | undefined;
    const hoursBack = (args.hoursBack as number) || 24;
    const now = Date.now();
    const since = now - hoursBack * 60 * 60 * 1000;

    const groups: Group[] = groupIds ? getGroupsByIds(groupIds) : getGroups();

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

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return { success: true, transcription: text };
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
