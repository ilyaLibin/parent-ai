import 'dotenv/config';
import { Command } from 'commander';
import { summarizeGroup, formatSummaryForDisplay } from './summarize.js';
import { getGroups, getMessageCount, getConnectionGaps, saveGroup } from './db.js';
import * as api from './api-client.js';
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';

const program = new Command();

program
  .name('parent-ai')
  .description('WhatsApp group message tracker with AI summaries')
  .version('1.0.0');

program
  .command('summarize')
  .description('Generate a summary for a group')
  .requiredOption('-g, --group <id-or-name>', 'Group ID (e.g., 120363...@g.us) or name (partial match)')
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
      console.log(`    ID: ${group.id}`);
      console.log(`    Messages: ${count} | Last update: ${lastUpdate}`);
      console.log();
    }
  });

program
  .command('status')
  .description('Show connection status and any gaps')
  .option('-h, --hours <hours>', 'Hours to look back', '24')
  .action(async (options) => {
    const hours = parseInt(options.hours, 10);

    // Check if listener is running
    const health = await api.checkHealth();

    console.log(`\n📊 Status:\n`);

    if (health.success && health.data) {
      console.log(`  🌐 Listener: ${health.data.connected ? '✅ Connected' : '⚠️  Disconnected'}`);
    } else {
      console.log(`  🌐 Listener: ❌ Not running (${health.error})`);
    }

    const gaps = getConnectionGaps(hours);

    console.log(`\n📈 Connection History (last ${hours} hours):\n`);

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

program
  .command('send')
  .description('Send a message to a contact or group (requires listener to be running)')
  .requiredOption('-t, --to <recipient>', 'Recipient: phone number, contact JID, or group ID')
  .requiredOption('-m, --message <text>', 'Message text to send')
  .action(async (options) => {
    try {
      // Determine recipient JID for display
      let recipientId = options.to;
      if (!recipientId.includes('@')) {
        recipientId = api.phoneToJid(recipientId);
        console.log(`📱 Resolved phone to: ${recipientId}`);
      }

      console.log(`\n📤 Sending message to ${recipientId}...`);

      const result = await api.sendMessage(options.to, options.message);

      if (result.success) {
        console.log(`✅ Message sent successfully!`);
        console.log(`   Message ID: ${result.messageId}`);
      } else {
        console.error(`❌ Failed to send: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('discover')
  .description('Connect to WhatsApp and list all groups (Note: will disconnect running listener)')
  .action(async () => {
    console.log('\n🔍 Connecting to discover groups...\n');
    console.log('⚠️  Note: This will temporarily disconnect the running listener.\n');

    const { state, saveCreds } = await useMultiFileAuthState('./auth_state');
    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        console.log('✅ Connected! Fetching groups...\n');

        try {
          // Get all groups
          const groups = await sock.groupFetchAllParticipating();
          const groupList = Object.values(groups);

          console.log(`Found ${groupList.length} groups:\n`);
          console.log('─'.repeat(70));

          for (const group of groupList) {
            // Save to DB for later reference
            saveGroup(group.id, group.subject);

            console.log(`📱 ${group.subject}`);
            console.log(`   ID: ${group.id}`);
            console.log(`   Participants: ${group.participants.length}`);
            console.log('─'.repeat(70));
          }

          console.log('\n💡 Add group IDs to TRACKED_GROUP_IDS in .env:');
          console.log('   TRACKED_GROUP_IDS=120363xxx@g.us,120363yyy@g.us\n');

          sock.end(undefined);
          process.exit(0);
        } catch (err) {
          console.error('Error fetching groups:', err);
          sock.end(undefined);
          process.exit(1);
        }
      }

      if (update.connection === 'close') {
        console.error('❌ Connection closed before fetching groups');
        process.exit(1);
      }
    });
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
