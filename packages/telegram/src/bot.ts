import { Bot } from 'grammy';
import { summaryFeature } from './features/summary.js';
import { statusFeature } from './features/status.js';
import { chatFeature } from './features/chat.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN must be set in .env');
}

export const bot = new Bot(token);

// Register command features
bot.use(summaryFeature);
bot.use(statusFeature);

// Chat feature handles free-text messages (must be last)
bot.use(chatFeature);

// Error handler
bot.catch((err) => {
  console.error('Bot error:', err);
});
