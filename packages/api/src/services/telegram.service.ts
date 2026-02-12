const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendTelegram(
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'Markdown'
): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env');
  }

  console.log(`[telegram] Sending message (${text.length} chars, ${parseMode})...`);
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: parseMode,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[telegram] Send failed: ${res.status} ${body}`);
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
  console.log('[telegram] Message sent successfully');
}
