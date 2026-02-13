import { Composer } from 'grammy';
import Anthropic from '@anthropic-ai/sdk';
import * as api from '../api-client.js';

export const chatFeature = new Composer();

const anthropic = new Anthropic();

const tools: Anthropic.Tool[] = [
  {
    name: 'getSummary',
    description: 'Trigger a summary for all WhatsApp groups or specifically for Aviv school groups.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['daily', 'aviv'],
          description: '"daily" for all groups, "aviv" for Aviv school agent report',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'getStatus',
    description: 'Get system status including tracked groups count, total messages, and connection gaps.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'getGroups',
    description: 'List all tracked WhatsApp groups with their message counts.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'getSummary':
      if (args.type === 'aviv') return api.executeTaskByName('aviv-daily-report');
      return api.triggerDailySummary();
    case 'getStatus':
      return api.getStatus();
    case 'getGroups':
      return api.getGroups();
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

chatFeature.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  console.log(`[bot] Chat from ${ctx.from?.first_name || 'unknown'}: "${ctx.message.text.substring(0, 80)}"`);
  try {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: ctx.message.text },
    ];

    let finalText = '';

    for (let i = 0; i < 5; i++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: `You are a personal assistant for a parent. You help manage information about their child's school.
You can:
- Generate summaries of WhatsApp group messages (use getSummary tool)
- Check system status (use getStatus tool)
- List tracked groups (use getGroups tool)

Respond concisely. If the user asks something unrelated, just chat naturally.
Respond in the same language the user writes in.`,
        tools,
        messages,
      });

      // Collect text from response
      for (const block of response.content) {
        if (block.type === 'text') {
          finalText = block.text;
        }
      }

      if (response.stop_reason !== 'tool_use') break;

      // Execute tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await executeTool(block.name, block.input as Record<string, unknown>);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      messages.push({ role: 'assistant', content: response.content as Anthropic.ContentBlockParam[] });
      messages.push({ role: 'user', content: toolResults });
    }

    console.log(`[bot] Chat reply: "${finalText?.substring(0, 80)}"`);
    await ctx.reply(finalText || 'Done!');
  } catch (err) {
    console.error('[bot] Chat error:', err);
    await ctx.reply(`Sorry, something went wrong: ${err instanceof Error ? err.message : String(err)}`);
  }
});
