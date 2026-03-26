const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TTS_URL = process.env.TTS_URL || 'http://localhost:5050';
const TTS_API_TOKEN = process.env.TTS_API_TOKEN || '';

export async function sendTelegramAudio(text: string, voice = 'af_heart'): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env');
  }

  // Generate audio from TTS
  console.log(`[telegram] Generating TTS audio (${text.length} chars, voice=${voice})...`);
  const ttsHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TTS_API_TOKEN) ttsHeaders['Authorization'] = `Bearer ${TTS_API_TOKEN}`;

  const ttsRes = await fetch(`${TTS_URL}/tts`, {
    method: 'POST',
    headers: ttsHeaders,
    body: JSON.stringify({ text, voice }),
  });

  if (!ttsRes.ok) {
    const body = await ttsRes.text();
    throw new Error(`TTS error ${ttsRes.status}: ${body}`);
  }

  const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
  console.log(`[telegram] TTS audio generated: ${(audioBuffer.length / 1024).toFixed(1)}KB`);

  // Send as audio file via Telegram Bot API (multipart form)
  const form = new FormData();
  form.append('chat_id', TELEGRAM_CHAT_ID);
  form.append('audio', new File([audioBuffer], 'message.wav', { type: 'audio/wav' }));
  if (text.length <= 1024) form.append('caption', text);

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendAudio`;
  const res = await fetch(url, { method: 'POST', body: form });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[telegram] Send audio failed: ${res.status} ${body}`);
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
  console.log('[telegram] Audio message sent successfully');
}

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
