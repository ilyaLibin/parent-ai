import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '..', '..', '.env') });

console.log(`
╔═══════════════════════════════════════════════════╗
║        Parent AI - WhatsApp Listener              ║
╠═══════════════════════════════════════════════════╣
║  Connecting to WhatsApp...                        ║
║  First time? Scan the QR code with your phone.   ║
╚═══════════════════════════════════════════════════╝
`);

async function main() {
  const { connectToWhatsApp } = await import('./connection.js');
  const { setupMessageListener, syncAllGroups } = await import('./listener.js');

  try {
    await connectToWhatsApp({
      onConnected: (sock) => {
        setupMessageListener(sock);
        syncAllGroups(sock);
        console.log('\nReady! Messages from tracked groups will be stored.\n');
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
