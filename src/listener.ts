import { WASocket, proto, jidNormalizedUser } from '@whiskeysockets/baileys';
import { saveMessage, saveGroup, Message } from './db.js';
import { getStore } from './connection.js';

// Load tracked groups from env (comma-separated, case-insensitive partial match)
const TRACKED_GROUPS = (process.env.TRACKED_GROUPS || '')
  .split(',')
  .map(g => g.trim().toLowerCase())
  .filter(Boolean);

interface GroupMetadata {
  id: string;
  subject: string;
}

const groupCache = new Map<string, GroupMetadata>();

export function setupMessageListener(sock: WASocket): void {
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // type: 'notify' = real-time, 'append' = historical sync
    const isHistorical = type === 'append';

    for (const msg of messages) {
      await processMessage(sock, msg, isHistorical);
    }
  });

  // Also listen for group metadata updates
  sock.ev.on('groups.update', (updates) => {
    for (const update of updates) {
      if (update.id && update.subject) {
        groupCache.set(update.id, { id: update.id, subject: update.subject });
        saveGroup(update.id, update.subject);
      }
    }
  });

  console.log(`👂 Listening for messages in groups: ${TRACKED_GROUPS.length > 0 ? TRACKED_GROUPS.join(', ') : '(all groups)'}`);
}

async function processMessage(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  isHistorical: boolean
): Promise<void> {
  // Skip if not a group message
  const remoteJid = msg.key?.remoteJid;
  if (!remoteJid || !remoteJid.endsWith('@g.us')) {
    return;
  }

  // Get group metadata
  let groupMeta = groupCache.get(remoteJid);
  if (!groupMeta) {
    try {
      const metadata = await sock.groupMetadata(remoteJid);
      groupMeta = { id: remoteJid, subject: metadata.subject };
      groupCache.set(remoteJid, groupMeta);
      saveGroup(remoteJid, metadata.subject);
    } catch (err) {
      console.warn(`⚠️ Could not fetch group metadata for ${remoteJid}`);
      return;
    }
  }

  // Check if this group should be tracked
  if (TRACKED_GROUPS.length > 0) {
    const groupNameLower = groupMeta.subject.toLowerCase();
    const isTracked = TRACKED_GROUPS.some(pattern => groupNameLower.includes(pattern));
    if (!isTracked) {
      return;
    }
  }

  // Extract message content
  const content = extractMessageContent(msg);
  const messageType = getMessageType(msg);

  // Skip non-text messages for now (can expand later)
  if (!content && messageType === 'unknown') {
    return;
  }

  // Get sender info
  const senderId = msg.key?.participant || msg.key?.remoteJid || 'unknown';
  const senderName = await getSenderName(sock, senderId);

  // Build message record
  const messageRecord: Message & { raw_json: string } = {
    id: msg.key?.id || `${Date.now()}-${Math.random()}`,
    group_id: remoteJid,
    sender_id: senderId,
    sender_name: senderName,
    content: content,
    message_type: messageType,
    timestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
    raw_json: JSON.stringify(msg),
  };

  // Save to database (upsert handles duplicates)
  const isNew = saveMessage(messageRecord);

  if (isNew && !isHistorical) {
    const preview = content ? content.substring(0, 50) : `[${messageType}]`;
    console.log(`📨 [${groupMeta.subject}] ${senderName}: ${preview}${content && content.length > 50 ? '...' : ''}`);
  } else if (isNew && isHistorical) {
    // Silently log historical syncs
    process.stdout.write('.');
  }
}

function extractMessageContent(msg: proto.IWebMessageInfo): string | null {
  const m = msg.message;
  if (!m) return null;

  // Handle different message types
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return `[Image] ${m.imageMessage.caption}`;
  if (m.videoMessage?.caption) return `[Video] ${m.videoMessage.caption}`;
  if (m.documentMessage?.caption) return `[Document] ${m.documentMessage.caption}`;
  if (m.imageMessage) return '[Image]';
  if (m.videoMessage) return '[Video]';
  if (m.audioMessage) return '[Audio]';
  if (m.stickerMessage) return '[Sticker]';
  if (m.documentMessage) return `[Document: ${m.documentMessage.fileName || 'file'}]`;
  if (m.contactMessage) return `[Contact: ${m.contactMessage.displayName || 'contact'}]`;
  if (m.locationMessage) return '[Location]';

  return null;
}

function getMessageType(msg: proto.IWebMessageInfo): string {
  const m = msg.message;
  if (!m) return 'unknown';

  if (m.conversation || m.extendedTextMessage) return 'text';
  if (m.imageMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return 'audio';
  if (m.stickerMessage) return 'sticker';
  if (m.documentMessage) return 'document';
  if (m.contactMessage) return 'contact';
  if (m.locationMessage) return 'location';

  return 'unknown';
}

async function getSenderName(sock: WASocket, senderId: string): Promise<string> {
  const store = getStore();

  // Try to get from store contacts
  const normalizedId = jidNormalizedUser(senderId);
  const contact = store.contacts[normalizedId];

  if (contact?.name) return contact.name;
  if (contact?.notify) return contact.notify;

  // Fallback to phone number
  return senderId.split('@')[0];
}
