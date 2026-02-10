import { tool } from 'ai';
import { z } from 'zod';
import { getMessages, getGroups, getGroupsByIds, type Group } from '@parent-ai/shared';

export const getMessagesTool = tool({
  description:
    'Fetch WhatsApp messages from tracked groups within a time range. Returns messages with sender, content, type, and timestamp. Messages with type "image" contain an image that can be transcribed using the transcribeImage tool.',
  parameters: z.object({
    groupIds: z
      .array(z.string())
      .optional()
      .describe('Specific group IDs to fetch. If omitted, fetches from all tracked groups.'),
    hoursBack: z
      .number()
      .default(24)
      .describe('How many hours back to fetch messages. Defaults to 24.'),
  }),
  execute: async ({ groupIds, hoursBack }) => {
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
});
