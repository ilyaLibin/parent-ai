import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '..', '..', '.env') });

async function main() {
  const { serve } = await import('@hono/node-server');
  const { app } = await import('./app.js');

  const PORT = process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 3033;

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

main();
