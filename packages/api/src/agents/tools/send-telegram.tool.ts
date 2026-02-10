import { tool } from 'ai';
import { z } from 'zod';
import { sendTelegram } from '../../services/telegram.service.js';

export const sendTelegramTool = tool({
  description:
    'Send a formatted message to the user via Telegram. Use this to deliver the final report or summary. Supports Markdown formatting.',
  parameters: z.object({
    text: z.string().describe('The message text to send. Supports Telegram Markdown formatting.'),
  }),
  execute: async ({ text }) => {
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
});
