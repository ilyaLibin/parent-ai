import type { Context } from 'grammy';

// Sends a reply with Telegram Markdown formatting, falling back to plain text if the
// source text has markdown Telegram's parser can't handle (e.g. an unmatched * or _)
// rather than showing the user a generic error instead of the actual answer.
export async function replyFormatted(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.warn('[bot] Markdown parse failed, falling back to plain text:', err instanceof Error ? err.message : String(err));
    await ctx.reply(text);
  }
}
