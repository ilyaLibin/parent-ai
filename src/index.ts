import 'dotenv/config';
import { serve } from '@hono/node-server';
import { app } from './lib/app.js';
import { connectToWhatsApp } from './connection.js';
import { setupMessageListener } from './listener.js';
import { setupAgentListener } from './agent.js';
import { setSocket } from './services/whatsapp.service.js';
import { startCronRunner } from './crons/cron.runner.js';

const PORT = process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 3033;

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
    serve({ fetch: app.fetch, port: PORT }, () => {
      console.log(`API server running on http://localhost:${PORT}`);
    });

    await connectToWhatsApp({
      onConnected: (sock) => {
        setSocket(sock);
        setupMessageListener(sock);
        setupAgentListener(sock);
        startCronRunner();

        console.log('\nReady! Messages from tracked groups will be stored.\n');
        console.log('Commands:');
        console.log('  npm run send -- -t "+972..." -m "Hello"      # Send a message');
        console.log('  npm run summarize -- -g "Group" -p day       # Summarize last 24h');
        console.log('  npm run groups                               # List tracked groups');
        console.log('  npm run status                               # Check connection status');
        console.log('\nPress Ctrl+C to stop.\n');
      },
      onDisconnected: (reason) => {
        setSocket(null);
        console.log(`Disconnection reason: ${reason}`);
      },
    });
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
