import { Composer, InlineKeyboard } from 'grammy';
import * as api from '../api-client.js';

export const checklistFeature = new Composer();

interface TelegramInlineButton {
  text: string;
  callback_data?: string;
}

checklistFeature.callbackQuery(/^ci:(\d+)$/, async (ctx) => {
  const callbackData = ctx.callbackQuery.data!;
  try {
    const result = await api.toggleChecklistItem(Number(ctx.match![1]));

    const markup = ctx.callbackQuery.message?.reply_markup as { inline_keyboard: TelegramInlineButton[][] } | undefined;
    if (markup) {
      const newKeyboard = new InlineKeyboard();
      for (const row of markup.inline_keyboard) {
        for (const btn of row) {
          if (btn.callback_data === callbackData) {
            const label = btn.text.replace(/^(✅|⬜)\s/, '');
            newKeyboard.text(`${result.checked ? '✅' : '⬜'} ${label}`, btn.callback_data);
          } else {
            newKeyboard.text(btn.text, btn.callback_data ?? '');
          }
        }
        newKeyboard.row();
      }
      await ctx.editMessageReplyMarkup({ reply_markup: newKeyboard });
    }

    await ctx.answerCallbackQuery();
  } catch (err) {
    console.error('[bot] Checklist toggle error:', err);
    await ctx.answerCallbackQuery({ text: 'Failed to update', show_alert: true });
  }
});
