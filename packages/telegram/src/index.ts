import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '..', '..', '.env') });

console.log(`
╔═══════════════════════════════════════════════════╗
║        Parent AI - Telegram Bot                   ║
╠═══════════════════════════════════════════════════╣
║  Starting bot with long polling...                ║
╚═══════════════════════════════════════════════════╝
`);

async function main() {
  const { bot } = await import('./bot.js');

  bot.start({
    onStart: () => {
      console.log('Bot is running! Send /aviv, /summary, /status, or /groups.');
    },
  });
}

main();
