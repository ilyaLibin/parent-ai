import type { Context } from 'grammy';

// Sends a reply with Telegram Markdown formatting, falling back to plain text if the
// source text has markdown Telegram's parser can't handle (e.g. an unmatched * or _)
// rather than showing the user a generic error instead of the actual answer.
// `extra` is merged in (e.g. { reply_markup } for an inline keyboard).
export async function replyFormatted(ctx: Context, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
  } catch (err) {
    console.warn('[bot] Markdown parse failed, falling back to plain text:', err instanceof Error ? err.message : String(err));
    await ctx.reply(text, extra);
  }
}
