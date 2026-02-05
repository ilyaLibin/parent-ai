import 'dotenv/config';
import { connectToWhatsApp } from './connection.js';
import { setupMessageListener } from './listener.js';
import { startServer, setSocket } from './server.js';
import { setupAgentListener } from './agent.js';
import { startScheduler } from './scheduler.js';

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
    // Start API server first
    await startServer();

    await connectToWhatsApp({
      onConnected: (sock) => {
        // Make socket available to API server
        setSocket(sock);
        setupMessageListener(sock);
        setupAgentListener(sock);
        startScheduler();

        console.log('\n🎯 Ready! Messages from tracked groups will be stored.\n');
        console.log('Commands:');
        console.log('  npm run send -- -t "+972..." -m "Hello"      # Send a message');
        console.log('  npm run summarize -- -g "Group" -p day       # Summarize last 24h');
        console.log('  npm run groups                               # List tracked groups');
        console.log('  npm run status                               # Check connection status');
        console.log('\nPress Ctrl+C to stop.\n');
      },
      onDisconnected: (reason) => {
        setSocket(null as any); // Mark as disconnected
        console.log(`Disconnection reason: ${reason}`);
      },
    });
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
