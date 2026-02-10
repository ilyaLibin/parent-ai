import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '..', '..', '.env') });

console.log(`
╔═══════════════════════════════════════════════════╗
║        Parent AI - Cron Runner                    ║
╠═══════════════════════════════════════════════════╣
║  Starting scheduled jobs...                       ║
╚═══════════════════════════════════════════════════╝
`);

async function main() {
  const { startCronRunner } = await import('./cron.runner.js');
  startCronRunner();
}

main();
