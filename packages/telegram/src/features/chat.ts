import { Composer, type Context } from 'grammy';
import * as api from '../api-client.js';

export const chatFeature = new Composer();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

async function downloadTelegramFile(fileId: string): Promise<{ data: string; mediaType: string }> {
  const infoRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
  const info = await infoRes.json();
  if (!info.ok) throw new Error(`Failed to get file info: ${JSON.stringify(info)}`);

  const filePath = info.result.file_path as string;
  const fileRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  const ext = filePath.split('.').pop()?.toLowerCase();
  const mediaType =
    ext === 'png' ? 'image/png' :
    ext === 'webp' ? 'image/webp' :
    ext === 'oga' || ext === 'ogg' ? 'audio/ogg' :
    'image/jpeg';

  return { data: buffer.toString('base64'), mediaType };
}

async function runAndReply(
  ctx: Context,
  prompt?: string,
  image?: { data: string; mediaType: string },
  audio?: { data: string; mediaType: string }
) {
  try {
    const result = await api.runAgent(prompt, image, audio);
    const reply = result.resultText || (result.success ? 'Done!' : `Error: ${result.error}`);
    console.log(`[bot] Agent reply: "${reply.substring(0, 80)}"`);
    await ctx.reply(reply);
  } catch (err) {
    console.error('[bot] Chat error:', err);
    await ctx.reply(`Sorry, something went wrong: ${err instanceof Error ? err.message : String(err)}`);
  }
}

chatFeature.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const prompt = ctx.message.text;
  console.log(`[bot] Chat from ${ctx.from?.first_name || 'unknown'}: "${prompt.substring(0, 80)}"`);
  await runAndReply(ctx, prompt);
});

chatFeature.on('message:photo', async (ctx) => {
  const caption = ctx.message.caption;
  console.log(`[bot] Photo from ${ctx.from?.first_name || 'unknown'}${caption ? `: "${caption.substring(0, 80)}"` : ' (no caption)'}`);

  await ctx.replyWithChatAction('typing');
  try {
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    const image = await downloadTelegramFile(largest.file_id);
    await runAndReply(ctx, caption, image);
  } catch (err) {
    console.error('[bot] Photo error:', err);
    await ctx.reply(`Sorry, something went wrong: ${err instanceof Error ? err.message : String(err)}`);
  }
});

chatFeature.on('message:voice', async (ctx) => {
  console.log(`[bot] Voice message from ${ctx.from?.first_name || 'unknown'}`);

  await ctx.replyWithChatAction('typing');
  try {
    const audio = await downloadTelegramFile(ctx.message.voice.file_id);
    await runAndReply(ctx, ctx.message.caption, undefined, audio);
  } catch (err) {
    console.error('[bot] Voice error:', err);
    await ctx.reply(`Sorry, something went wrong: ${err instanceof Error ? err.message : String(err)}`);
  }
});
