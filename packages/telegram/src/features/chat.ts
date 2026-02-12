import { Composer } from 'grammy';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { tool } from 'ai';
import { z } from 'zod';
import * as api from '../api-client.js';

export const chatFeature = new Composer();

const getSummaryTool = tool({
  description: 'Trigger a summary for all WhatsApp groups or specifically for Aviv school groups.',
  parameters: z.object({
    type: z.enum(['daily', 'aviv']).describe('"daily" for all groups, "aviv" for Aviv school agent report'),
  }),
  execute: async ({ type }) => {
    if (type === 'aviv') {
      return api.triggerDailyReport();
    }
    return api.triggerDailySummary();
  },
});

const getStatusTool = tool({
  description: 'Get system status including tracked groups count, total messages, and connection gaps.',
  parameters: z.object({}),
  execute: async () => api.getStatus(),
});

const getGroupsTool = tool({
  description: 'List all tracked WhatsApp groups with their message counts.',
  parameters: z.object({}),
  execute: async () => api.getGroups(),
});

chatFeature.on('message:text', async (ctx) => {
  // Ignore commands (they're handled by other features)
  if (ctx.message.text.startsWith('/')) return;

  console.log(`[bot] Chat from ${ctx.from?.first_name || 'unknown'}: "${ctx.message.text.substring(0, 80)}"`);
  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: `You are a personal assistant for a parent. You help manage information about their child's school.
You can:
- Generate summaries of WhatsApp group messages (use getSummary tool)
- Check system status (use getStatus tool)
- List tracked groups (use getGroups tool)

Respond concisely. If the user asks something unrelated, just chat naturally.
Respond in the same language the user writes in.`,
      prompt: ctx.message.text,
      tools: {
        getSummary: getSummaryTool,
        getStatus: getStatusTool,
        getGroups: getGroupsTool,
      },
      maxSteps: 5,
    });

    console.log(`[bot] Chat reply (${result.steps.length} steps): "${result.text?.substring(0, 80)}"`);
    await ctx.reply(result.text || 'Done!');
  } catch (err) {
    console.error('[bot] Chat error:', err);
    await ctx.reply(`Sorry, something went wrong: ${err instanceof Error ? err.message : String(err)}`);
  }
});
