import { Composer } from 'grammy';
import * as api from '../api-client.js';

export const summaryFeature = new Composer();

summaryFeature.command('summary', async (ctx) => {
  await ctx.reply('Generating daily summary for all groups...');
  try {
    const result = await api.triggerDailySummary();
    let reply = `Done! ${result.groupsSummarized} group(s) summarized.`;
    if (result.errors.length > 0) {
      reply += `\n\nErrors:\n${result.errors.join('\n')}`;
    }
    await ctx.reply(reply);
  } catch (err) {
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

summaryFeature.command('today', async (ctx) => {
  await ctx.reply('Checking today\'s schedule...');
  try {
    const result = await api.triggerTodaysSchedule();
    if (result.success) {
      await ctx.reply(`Schedule sent! (${result.steps} steps)`);
    } else {
      await ctx.reply(`Failed: ${result.error}`);
    }
  } catch (err) {
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

summaryFeature.command('aviv', async (ctx) => {
  await ctx.reply('Generating Aviv school daily report (agent mode)...');
  try {
    const result = await api.triggerDailyReport();
    if (result.success) {
      await ctx.reply(`Report generated and sent! (${result.steps} steps)`);
    } else {
      await ctx.reply(`Report failed: ${result.error}`);
    }
  } catch (err) {
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});
