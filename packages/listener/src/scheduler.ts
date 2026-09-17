import { WASocket, proto } from '@whiskeysockets/baileys';
import { getGroupByName, saveChatTurn, getDueMessages, markMessageSent, markMessageFailed } from '@parent-ai/shared';

const API_URL = process.env.API_URL || 'http://localhost:3033';
const SCHEDULER_CHAT_NAME = process.env.SCHEDULER_CHAT_NAME || '_MESSAGE_SCHEDULER';

// Resolved lazily (the group may not exist yet at startup) and cached — undefined
// means "not looked up yet", null means "looked up, doesn't exist".
let schedulerChatId: string | null | undefined;

function getSchedulerChatId(): string | null {
  if (schedulerChatId === undefined) {
    const group = getGroupByName(SCHEDULER_CHAT_NAME);
    schedulerChatId = group?.id ?? null;
    if (schedulerChatId) console.log(`📬 Message scheduler chat resolved: ${schedulerChatId}`);
  }
  return schedulerChatId;
}

export function isSchedulerChat(jid: string | undefined | null): boolean {
  return !!jid && jid === getSchedulerChatId();
}

// Handles a real-time message sent in the scheduler chat. A shared contact card
// establishes the recipient (acked immediately, no LLM call needed); free text after
// that is forwarded to the full agent (same /agent/run Telegram uses) with a chatId
// scoped to this WhatsApp chat, so the 3-minute conversation window picks up the
// contact context automatically — no bespoke "last shared contact" state needed.
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

  const text = m.conversation || m.extendedTextMessage?.text;
  if (!text) return;

  console.log(`📬 Scheduler command: "${text.substring(0, 80)}"`);

  try {
    const res = await fetch(`${API_URL}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, chatId }),
    });
    const result = (await res.json()) as { resultText?: string | null; success: boolean; error?: string };
    const reply = result.resultText || (result.success ? 'Done!' : `Error: ${result.error}`);
    await sock.sendMessage(remoteJid, { text: reply });
  } catch (err) {
    console.error('[scheduler] Error:', err);
    await sock.sendMessage(remoteJid, { text: `❌ Error: ${err instanceof Error ? err.message : String(err)}` });
  }
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
