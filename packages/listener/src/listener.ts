import { WASocket, proto } from '@whiskeysockets/baileys';
import { saveMessage, saveGroup, isGroupTracked, Message } from '@parent-ai/shared';

interface GroupMetadata {
  id: string;
  subject: string;
  participants: Map<string, string>; // jid -> pushName/notify
}

const groupCache = new Map<string, GroupMetadata>();

export function setupMessageListener(sock: WASocket): void {
  // Real-time and synced messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // type: 'notify' = real-time, 'append' = historical sync
    const isHistorical = type === 'append';

    for (const msg of messages) {
      await processMessage(sock, msg, isHistorical);
    }
  });

  // Capture initial history sync (when device is first linked)
  sock.ev.on('messaging-history.set', async ({ messages, isLatest }) => {
    console.log(`\n📜 Receiving history sync (${messages.length} messages, isLatest: ${isLatest})...`);
    let saved = 0;
    for (const msg of messages) {
      const wasNew = await processMessage(sock, msg, true);
      if (wasNew) saved++;
    }
    console.log(`\n✅ History sync complete: ${saved} new messages saved`);
  });

  // Also listen for group metadata updates
  sock.ev.on('groups.update', (updates) => {
    for (const update of updates) {
      if (update.id && update.subject) {
        const existing = groupCache.get(update.id);
        groupCache.set(update.id, {
          id: update.id,
          subject: update.subject,
          participants: existing?.participants || new Map(),
        });
        saveGroup(update.id, update.subject);
      }
    }
  });

  console.log(`👂 Listening for messages (tracking controlled via DB)`);
}

async function processMessage(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  isHistorical: boolean
): Promise<boolean> {
  // Skip if not a group message
  const remoteJid = msg.key?.remoteJid;
  if (!remoteJid || !remoteJid.endsWith('@g.us')) {
    return false;
  }

  // Get group metadata
  let groupMeta = groupCache.get(remoteJid);
  if (!groupMeta) {
    try {
      const metadata = await sock.groupMetadata(remoteJid);
      const participants = new Map<string, string>();
      for (const p of metadata.participants) {
        if (p.id) {
          // Use notify name or phone number
          participants.set(p.id, p.id.split('@')[0]);
        }
      }
      groupMeta = {
        id: remoteJid,
        subject: metadata.subject,
        participants,
      };
      groupCache.set(remoteJid, groupMeta);
      saveGroup(remoteJid, metadata.subject);
    } catch (err) {
      console.warn(`⚠️ Could not fetch group metadata for ${remoteJid}`);
      return false;
    }
  }

  // Check if this group is tracked in the DB
  if (!isGroupTracked(remoteJid)) {
    return false;
  }

  // Extract message content
  const content = extractMessageContent(msg);
  const messageType = getMessageType(msg);

  // Skip non-text messages for now (can expand later)
  if (!content && messageType === 'unknown') {
    return false;
  }

  // Get sender info
  const senderId = msg.key?.participant || msg.key?.remoteJid || 'unknown';

  // Try to get sender name from message pushName, then cache, then phone number
  let senderName = msg.pushName || null;
  if (!senderName) {
    senderName = groupMeta.participants.get(senderId) || senderId.split('@')[0];
  } else {
    // Update cache with pushName
    groupMeta.participants.set(senderId, senderName);
  }

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

  return isNew;
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
