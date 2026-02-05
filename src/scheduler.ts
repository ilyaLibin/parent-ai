import cron from 'node-cron';
import { getDueMessages, markMessageSent, markMessageFailed } from './db.js';
import { getSocket } from './server.js';

let isRunning = false;

export function startScheduler(): void {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    if (isRunning) return; // Prevent overlapping runs
    isRunning = true;

    try {
      await processDueMessages();
    } catch (error) {
      console.error('Scheduler error:', error);
    } finally {
      isRunning = false;
    }
  });

  console.log('⏰ Scheduler started (checking every minute)');
}

async function processDueMessages(): Promise<void> {
  const socket = getSocket();
  if (!socket) {
    return; // Not connected, will retry next minute
  }

  const dueMessages = getDueMessages();

  for (const msg of dueMessages) {
    try {
      console.log(`📤 Sending scheduled message to ${msg.recipient_name || msg.recipient_id}...`);

      await socket.sendMessage(msg.recipient_id, { text: msg.message_text });

      markMessageSent(msg.id);
      console.log(`✅ Scheduled message sent to ${msg.recipient_name || msg.recipient_id}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      markMessageFailed(msg.id, errorMsg);
      console.error(`❌ Failed to send scheduled message: ${errorMsg}`);
    }
  }
}

// Also expose a function to process immediately (for testing)
export async function processNow(): Promise<void> {
  await processDueMessages();
}
