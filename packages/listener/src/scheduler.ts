import { WASocket, proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import { saveChatTurn, getDueMessages, markMessageSent, markMessageFailed } from '@parent-ai/shared';

const API_URL = process.env.API_URL || 'http://localhost:3033';

// Bound to the group's immutable JID, not its display name — the display name can
// (and has) changed over time (e.g. "_MESSAGE_SCHEDULER" → "Cold Brain"), but WhatsApp
// group JIDs never do. This exact ID has been stable since the very first version of
// this feature, long before the current name.
const SCHEDULER_CHAT_ID = process.env.SCHEDULER_CHAT_ID || '120363423448230515@g.us';

export function isSchedulerChat(jid: string | undefined | null): boolean {
  return !!jid && jid === SCHEDULER_CHAT_ID;
}

// Forwards a prompt (text and/or image) to the same /agent/run Telegram uses, with a
// chatId scoped to this WhatsApp chat so the 3-minute conversation window applies here
// too, and relays the reply back into WhatsApp.
async function forwardToAgent(
  sock: WASocket,
  remoteJid: string,
  chatId: string,
  prompt: string | undefined,
  image?: { data: string; mediaType: string }
): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image, chatId }),
    });
    const result = (await res.json()) as { resultText?: string | null; success: boolean; error?: string };
    const reply = result.resultText || (result.success ? 'Done!' : `Error: ${result.error}`);
    await sock.sendMessage(remoteJid, { text: reply });
  } catch (err) {
    console.error('[scheduler] Error:', err);
    await sock.sendMessage(remoteJid, { text: `❌ Error: ${err instanceof Error ? err.message : String(err)}` });
  }
}

// Handles a real-time message sent in the scheduler/assistant chat. A shared contact
// card establishes a recipient for message-scheduling (acked immediately, no LLM call
// needed) — everything else (text, images) goes to the full agent, same as Telegram.
export async function handleSchedulerMessage(sock: WASocket, msg: proto.IWebMessageInfo): Promise<void> {
  const remoteJid = msg.key?.remoteJid;
  if (!remoteJid || msg.key?.fromMe) return;

  const m = msg.message;
  if (!m) return;

  const chatId = `whatsapp-scheduler:${remoteJid}`;

  if (m.contactMessage) {
    const vcard = m.contactMessage.vcard || '';
    const phoneMatch = vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
    const phone = phoneMatch ? phoneMatch[1].replace(/[\s-]/g, '') : null;
    if (!phone) return;

    const jid = `${phone.replace(/^\+/, '')}@s.whatsapp.net`;
    const name = m.contactMessage.displayName || 'Unknown';

    console.log(`📇 Scheduler: contact shared — ${name} (${jid})`);
    saveChatTurn(chatId, 'user', `[Shared contact: ${name}, WhatsApp id: ${jid}]`);
    await sock.sendMessage(remoteJid, { text: `📇 Got contact: ${name}\nNow tell me what to send and when.` });
    return;
  }

  if (m.imageMessage) {
    const caption = m.imageMessage.caption || undefined;
    console.log(`🖼️ Scheduler: image received${caption ? `: "${caption.substring(0, 80)}"` : ''}`);
    try {
      const buffer = (await downloadMediaMessage(msg, 'buffer', {})) as Buffer;
      const image = { data: buffer.toString('base64'), mediaType: m.imageMessage.mimetype || 'image/jpeg' };
      await forwardToAgent(sock, remoteJid, chatId, caption, image);
    } catch (err) {
      console.error('[scheduler] Image download error:', err);
      await sock.sendMessage(remoteJid, { text: `❌ Couldn't download that image: ${err instanceof Error ? err.message : String(err)}` });
    }
    return;
  }

  const text = m.conversation || m.extendedTextMessage?.text;
  if (!text) return;

  console.log(`📬 Scheduler command: "${text.substring(0, 80)}"`);
  await forwardToAgent(sock, remoteJid, chatId, text);
}

// Sends due messages via the live socket — this has to live in the listener since
// it's the only process holding the WhatsApp connection (mirrors how the separate
// cron package polls cron_jobs for scheduled agent tasks).
const SEND_CHECK_INTERVAL_MS = 60_000;

export function startDueMessageSender(sock: WASocket): void {
  async function check() {
    for (const msg of getDueMessages()) {
      try {
        console.log(`📤 Sending scheduled message to ${msg.recipient_name || msg.recipient_id}...`);
        await sock.sendMessage(msg.recipient_id, { text: msg.message_text });
        markMessageSent(msg.id);
        console.log(`✅ Scheduled message sent to ${msg.recipient_name || msg.recipient_id}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        markMessageFailed(msg.id, errorMsg);
        console.error(`❌ Failed to send scheduled message: ${errorMsg}`);
      }
    }
  }

  check();
  setInterval(check, SEND_CHECK_INTERVAL_MS);
}
