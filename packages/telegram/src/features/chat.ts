import { Composer } from 'grammy';
import * as api from '../api-client.js';

export const chatFeature = new Composer();

chatFeature.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const prompt = ctx.message.text;
  console.log(`[bot] Chat from ${ctx.from?.first_name || 'unknown'}: "${prompt.substring(0, 80)}"`);

  try {
    const result = await api.runAgent(prompt);

    const reply = result.resultText || (result.success ? 'Done!' : `Error: ${result.error}`);
    console.log(`[bot] Agent reply: "${reply.substring(0, 80)}"`);
    await ctx.reply(reply);
  } catch (err) {
    console.error('[bot] Chat error:', err);
    await ctx.reply(`Sorry, something went wrong: ${err instanceof Error ? err.message : String(err)}`);
  }
});
