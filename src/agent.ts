import Anthropic from '@anthropic-ai/sdk';
import { WASocket, proto } from '@whiskeysockets/baileys';
import { scheduleMessage, getPendingMessages } from './db.js';

const anthropic = new Anthropic();

// The group where we receive commands
const AGENT_GROUP_ID = process.env.AGENT_GROUP_ID || '120363423448230515@g.us';

interface ParsedCommand {
  action: 'schedule_message' | 'list_scheduled' | 'unknown';
  recipientId?: string;
  recipientName?: string;
  messageText?: string;
  scheduledTime?: Date;
  error?: string;
}

interface ContactContext {
  jid: string;
  name: string;
}

// Store recent contacts shared in the agent group (for context)
const recentContacts = new Map<string, ContactContext>();

export function setupAgentListener(sock: WASocket): void {
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return; // Only process real-time messages

    for (const msg of messages) {
      await processAgentMessage(sock, msg);
    }
  });

  console.log(`🤖 Agent listening on group: ${AGENT_GROUP_ID}`);
}

async function processAgentMessage(
  sock: WASocket,
  msg: proto.IWebMessageInfo
): Promise<void> {
  const remoteJid = msg.key?.remoteJid;

  // Only process messages from the agent group
  if (remoteJid !== AGENT_GROUP_ID) return;

  // Skip our own messages
  if (msg.key?.fromMe) return;

  const m = msg.message;
  if (!m) return;

  // Handle shared contact - store for context
  if (m.contactMessage) {
    const contact = m.contactMessage;
    const vcard = contact.vcard || '';

    // Parse phone from vCard
    const phoneMatch = vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
    const phone = phoneMatch ? phoneMatch[1].replace(/[\s-]/g, '') : null;

    if (phone) {
      const jid = `${phone.replace(/^\+/, '')}@s.whatsapp.net`;
      const name = contact.displayName || 'Unknown';

      recentContacts.set(msg.key?.id || 'last', { jid, name });
      console.log(`📇 Contact shared: ${name} (${jid})`);

      // Acknowledge
      await sock.sendMessage(remoteJid, {
        text: `📇 Got contact: ${name}\nNow tell me what to send and when.`,
      });
    }
    return;
  }

  // Handle text commands
  const text = m.conversation || m.extendedTextMessage?.text;
  if (!text) return;

  console.log(`🤖 Agent received: ${text}`);

  try {
    // Get the most recent contact for context
    const lastContact = Array.from(recentContacts.values()).pop();

    const command = await parseCommand(text, lastContact);

    if (command.action === 'schedule_message') {
      if (!command.recipientId || !command.messageText || !command.scheduledTime) {
        await sock.sendMessage(remoteJid, {
          text: `❌ Missing info. Please share a contact first, then say something like:\n"send hello in 5 minutes"`,
        });
        return;
      }

      const id = scheduleMessage(
        command.recipientId,
        command.recipientName || null,
        command.messageText,
        command.scheduledTime
      );

      const timeStr = command.scheduledTime.toLocaleString('he-IL');
      await sock.sendMessage(remoteJid, {
        text: `✅ Message scheduled!\n\n📬 To: ${command.recipientName || command.recipientId}\n💬 Message: "${command.messageText}"\n⏰ When: ${timeStr}\n\n(ID: ${id})`,
      });

      // Clear the used contact
      recentContacts.clear();

    } else if (command.action === 'list_scheduled') {
      const pending = getPendingMessages();
      if (pending.length === 0) {
        await sock.sendMessage(remoteJid, { text: '📭 No scheduled messages.' });
      } else {
        const list = pending.map((m) => {
          const time = new Date(m.scheduled_at).toLocaleString('he-IL');
          return `• ${m.recipient_name || m.recipient_id}: "${m.message_text.substring(0, 30)}..." at ${time}`;
        }).join('\n');
        await sock.sendMessage(remoteJid, { text: `📬 Scheduled messages:\n\n${list}` });
      }

    } else {
      await sock.sendMessage(remoteJid, {
        text: `🤔 I didn't understand that.\n\nTo schedule a message:\n1. Share a contact\n2. Say "send [message] in [time]"\n\nExamples:\n• "send hello in 5 minutes"\n• "send don't forget the meeting in 2 hours"\n• "send call me at 3pm"`,
      });
    }
  } catch (error) {
    console.error('Agent error:', error);
    await sock.sendMessage(remoteJid, {
      text: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function parseCommand(
  text: string,
  lastContact: ContactContext | undefined
): Promise<ParsedCommand> {
  const prompt = `You are a command parser for a WhatsApp scheduling bot. Parse the user's message and extract the action.

Current context:
- Last shared contact: ${lastContact ? `${lastContact.name} (${lastContact.jid})` : 'None'}
- Current time: ${new Date().toISOString()}

User message: "${text}"

Determine the action and extract details. Respond with JSON only:

For scheduling a message:
{
  "action": "schedule_message",
  "recipientId": "${lastContact?.jid || 'null if no contact'}",
  "recipientName": "${lastContact?.name || 'null'}",
  "messageText": "the message to send",
  "scheduledTime": "ISO timestamp when to send"
}

For listing scheduled messages (if user asks "what's scheduled", "list messages", etc.):
{
  "action": "list_scheduled"
}

If you can't understand the command:
{
  "action": "unknown"
}

Important:
- Parse relative times like "in 5 minutes", "in 2 hours", "at 3pm", "tomorrow at 9am"
- The message text is what comes after "send" and before the time specification
- If no contact was shared and user wants to schedule, still extract what you can but leave recipientId as null

Respond with ONLY the JSON object, no other text.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const parsed = JSON.parse(responseText);

    // Convert scheduledTime string to Date if present
    if (parsed.scheduledTime && typeof parsed.scheduledTime === 'string') {
      parsed.scheduledTime = new Date(parsed.scheduledTime);
    }

    return parsed as ParsedCommand;
  } catch {
    console.error('Failed to parse LLM response:', responseText);
    return { action: 'unknown' };
  }
}
