import 'dotenv/config';
import { connectToWhatsApp } from './connection.js';
import { setupMessageListener } from './listener.js';

console.log(`
╔═══════════════════════════════════════════════════╗
║           Parent AI - WhatsApp Tracker            ║
╠═══════════════════════════════════════════════════╣
║  Connecting to WhatsApp...                        ║
║  First time? Scan the QR code with your phone.   ║
╚═══════════════════════════════════════════════════╝
`);

async function main() {
  try {
    await connectToWhatsApp({
      onConnected: (sock) => {
        setupMessageListener(sock);
        console.log('\n🎯 Ready! Messages from tracked groups will be stored.\n');
        console.log('Commands:');
        console.log('  npm run summarize -- -g "Group Name" -p day   # Summarize last 24h');
        console.log('  npm run summarize -- -g "Group Name" -p week  # Summarize last week');
        console.log('  npx tsx src/cli.ts groups                    # List tracked groups');
        console.log('  npx tsx src/cli.ts status                    # Check connection status');
        console.log('\nPress Ctrl+C to stop.\n');
      },
      onDisconnected: (reason) => {
        console.log(`Disconnection reason: ${reason}`);
      },
    });
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
