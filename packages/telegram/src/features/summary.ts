import { Composer } from 'grammy';
import * as api from '../api-client.js';

export const summaryFeature = new Composer();

summaryFeature.command('summary', async (ctx) => {
  console.log(`[bot] /summary from ${ctx.from?.first_name || 'unknown'}`);
  await ctx.reply('Generating daily summary for all groups...');
  try {
    const result = await api.triggerDailySummary();
    console.log(`[bot] /summary done: ${result.groupsSummarized} groups`);
    let reply = `Done! ${result.groupsSummarized} group(s) summarized.`;
    if (result.errors.length > 0) {
      reply += `\n\nErrors:\n${result.errors.join('\n')}`;
    }
    await ctx.reply(reply);
  } catch (err) {
    console.error('[bot] /summary error:', err);
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

summaryFeature.command('today', async (ctx) => {
  console.log(`[bot] /today from ${ctx.from?.first_name || 'unknown'}`);
  await ctx.reply('Checking today\'s schedule...');
  try {
    const result = await api.executeTaskByName('todays-schedule');
    if (result.success) {
      console.log(`[bot] /today done: ${result.steps?.length ?? 0} steps`);
      await ctx.reply(`Schedule sent!`);
    } else {
      console.error(`[bot] /today failed: ${result.error}`);
      await ctx.reply(`Failed: ${result.error}`);
    }
  } catch (err) {
    console.error('[bot] /today error:', err);
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

summaryFeature.command('report', async (ctx) => {
  console.log(`[bot] /report from ${ctx.from?.first_name || 'unknown'}`);
  await ctx.reply('Generating school daily report (agent mode)...');
  try {
    const result = await api.executeTaskByName('school-daily-report');
    if (result.success) {
      console.log(`[bot] /report done: ${result.steps?.length ?? 0} steps`);
      await ctx.reply(`Report generated and sent!`);
    } else {
      console.error(`[bot] /report failed: ${result.error}`);
      await ctx.reply(`Report failed: ${result.error}`);
    }
  } catch (err) {
    console.error('[bot] /report error:', err);
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});
