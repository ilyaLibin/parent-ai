import 'dotenv/config';
import { Command } from 'commander';
import { summarizeGroup, formatSummaryForDisplay } from './summarize.js';
import { getGroups, getMessageCount, getConnectionGaps } from './db.js';

const program = new Command();

program
  .name('parent-ai')
  .description('WhatsApp group message tracker with AI summaries')
  .version('1.0.0');

program
  .command('summarize')
  .description('Generate a summary for a group')
  .requiredOption('-g, --group <name>', 'Group name (partial match)')
  .option('-p, --period <period>', 'Time period: day, week, or custom', 'day')
  .option('--from <date>', 'Start date (YYYY-MM-DD or ISO)')
  .option('--to <date>', 'End date (YYYY-MM-DD or ISO)')
  .action(async (options) => {
    try {
      const { start, end } = parsePeriod(options.period, options.from, options.to);

      console.log(`\n🔍 Generating summary for "${options.group}"...`);
      console.log(`   Period: ${start.toLocaleString()} - ${end.toLocaleString()}\n`);

      const result = await summarizeGroup(options.group, start, end);

      if (result.messageCount === 0) {
        console.log(`❌ No messages found for "${options.group}" in the specified period.`);
        console.log(`   Make sure the group name matches and messages have been collected.`);
        return;
      }

      console.log(formatSummaryForDisplay(result));
    } catch (error) {
      console.error('Error generating summary:', error);
      process.exit(1);
    }
  });

program
  .command('groups')
  .description('List all tracked groups')
  .action(() => {
    const groups = getGroups();

    if (groups.length === 0) {
      console.log('\n❌ No groups found. Start the listener first to collect data.\n');
      return;
    }

    console.log('\n📱 Tracked Groups:\n');
    for (const group of groups) {
      const count = getMessageCount(group.id);
      const lastUpdate = new Date(group.updated_at).toLocaleString();
      console.log(`  • ${group.name}`);
      console.log(`    Messages: ${count} | Last update: ${lastUpdate}`);
      console.log();
    }
  });

program
  .command('status')
  .description('Show connection status and any gaps')
  .option('-h, --hours <hours>', 'Hours to look back', '24')
  .action((options) => {
    const hours = parseInt(options.hours, 10);
    const gaps = getConnectionGaps(hours);

    console.log(`\n📊 Connection Status (last ${hours} hours):\n`);

    if (gaps.length === 0) {
      console.log('  ✅ No significant connection gaps detected.\n');
    } else {
      console.log(`  ⚠️  ${gaps.length} connection gap(s) detected:\n`);
      for (const gap of gaps) {
        const start = new Date(gap.start).toLocaleString();
        const end = new Date(gap.end).toLocaleString();
        console.log(`    • ${start} - ${end} (${gap.duration_minutes} min)`);
      }
      console.log();
    }

    const groups = getGroups();
    console.log(`  📱 Groups being tracked: ${groups.length}`);
    const totalMessages = groups.reduce((sum, g) => sum + getMessageCount(g.id), 0);
    console.log(`  💬 Total messages stored: ${totalMessages}\n`);
  });

function parsePeriod(
  period: string,
  fromStr?: string,
  toStr?: string
): { start: Date; end: Date } {
  const now = new Date();
  let start: Date;
  let end: Date = now;

  if (fromStr && toStr) {
    start = new Date(fromStr);
    end = new Date(toStr);
    // If end is a date without time, set to end of day
    if (toStr.length === 10) {
      end.setHours(23, 59, 59, 999);
    }
  } else if (fromStr) {
    start = new Date(fromStr);
  } else {
    switch (period) {
      case 'day':
        start = new Date(now);
        start.setDate(start.getDate() - 1);
        break;
      case 'week':
        start = new Date(now);
        start.setDate(start.getDate() - 7);
        break;
      case 'today':
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        break;
      default:
        // Try to parse as number of days
        const days = parseInt(period, 10);
        if (!isNaN(days)) {
          start = new Date(now);
          start.setDate(start.getDate() - days);
        } else {
          throw new Error(`Invalid period: ${period}. Use: day, week, today, or number of days`);
        }
    }
  }

  return { start: start!, end };
}

program.parse();
