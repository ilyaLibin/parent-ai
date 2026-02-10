import { Composer } from 'grammy';
import * as api from '../api-client.js';

export const statusFeature = new Composer();

statusFeature.command('status', async (ctx) => {
  try {
    const status = await api.getStatus();
    let text = `*System Status*\n`;
    text += `Groups tracked: ${status.groupCount}\n`;
    text += `Total messages: ${status.totalMessages}\n`;

    if (status.gaps.length > 0) {
      text += `\nConnection gaps (last 24h): ${status.gaps.length}\n`;
      for (const gap of status.gaps) {
        const start = new Date(gap.start).toLocaleTimeString();
        const end = new Date(gap.end).toLocaleTimeString();
        text += `  ${start} - ${end} (${gap.duration_minutes} min)\n`;
      }
    } else {
      text += `\nNo connection gaps in last 24h`;
    }

    await ctx.reply(text);
  } catch (err) {
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

statusFeature.command('groups', async (ctx) => {
  try {
    const data = await api.getGroups();
    if (data.groups.length === 0) {
      await ctx.reply('No tracked groups found.');
      return;
    }

    let text = `*Tracked Groups (${data.groups.length})*\n\n`;
    for (const g of data.groups) {
      text += `${g.name}\n  Messages: ${g.messageCount}\n\n`;
    }
    await ctx.reply(text);
  } catch (err) {
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});
