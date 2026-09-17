import { WASocket, proto } from '@whiskeysockets/baileys';
import { saveMessage, saveGroup, isGroupTracked, Message } from '@parent-ai/shared';
import { isSchedulerChat, handleSchedulerMessage } from './scheduler.js';

interface GroupMetadata {
  id: string;
  subject: string;
  participants: Map<string, string>; // jid -> pushName/notify
}

const groupCache = new Map<string, GroupMetadata>();

// Our own group cache/DB rows are otherwise only populated lazily — when a message
// actually arrives from a group. Groups with no recent activity keep stale names,
// and newly-joined groups don't show up at all until their first message. Fetching
// everything we currently participate in fixes both, and is safe to call anytime
// (upserts name only, never touches the dashboard's tracked flag).
export async function syncAllGroups(sock: WASocket): Promise<void> {
  try {
    const groups = await sock.groupFetchAllParticipating();
    let count = 0;
    for (const [id, metadata] of Object.entries(groups)) {
      const participants = new Map<string, string>();
      for (const p of metadata.participants) {
        if (p.id) participants.set(p.id, p.id.split('@')[0]);
      }
      groupCache.set(id, { id, subject: metadata.subject, participants });
      saveGroup(id, metadata.subject);
      count++;
    }
    console.log(`🔄 Synced ${count} groups (names/membership refreshed)`);
  } catch (err) {
    console.warn('⚠️ Could not sync full group list:', err instanceof Error ? err.message : String(err));
  }
}

export function setupMessageListener(sock: WASocket): void {
  // ev.process() batches every event fired within the same tick into one callback
  // instead of separate .on() listeners — avoids partial state and is the recommended
  // pattern for bulk operations like history sync (per baileys.wiki/concepts/events).
  sock.ev.process(async (events) => {
    const groupUpdates = events['groups.update'];
    if (groupUpdates) {
      for (const update of groupUpdates) {
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
    }

    // Membership changed (add/remove/promote/demote) — refresh the cached
    // participant names so they don't go stale.
    const participantsUpdate = events['group-participants.update'];
    if (participantsUpdate) {
      await refreshParticipants(sock, participantsUpdate.id);
    }

    // Real-time and synced messages
    const upsert = events['messages.upsert'];
    if (upsert) {
      // type: 'notify' = real-time, 'append' = historical sync
      const isHistorical = upsert.type === 'append';
      for (const msg of upsert.messages) {
        // The message-scheduler chat is a command channel, not family content —
        // route it separately instead of storing/tracking it like a normal group.
        if (!isHistorical && isSchedulerChat(msg.key?.remoteJid)) {
          await handleSchedulerMessage(sock, msg);
          continue;
        }
        await processMessage(sock, msg, isHistorical);
      }
    }

    // Initial history sync (when device is first linked)
    const history = events['messaging-history.set'];
    if (history) {
      console.log(`\n📜 Receiving history sync (${history.messages.length} messages, isLatest: ${history.isLatest})...`);
      let saved = 0;
      for (const msg of history.messages) {
        const wasNew = await processMessage(sock, msg, true);
        if (wasNew) saved++;
      }
      console.log(`\n✅ History sync complete: ${saved} new messages saved`);
    }
  });

  console.log(`👂 Listening for messages (tracking controlled via DB)`);
}

async function refreshParticipants(sock: WASocket, groupId: string): Promise<void> {
  const existing = groupCache.get(groupId);
  if (!existing) return; // not cached yet — will be populated lazily on first message

  try {
    const metadata = await sock.groupMetadata(groupId);
    const participants = new Map<string, string>();
    for (const p of metadata.participants) {
      if (p.id) participants.set(p.id, p.id.split('@')[0]);
    }
    groupCache.set(groupId, { ...existing, participants });
  } catch {
    // best-effort — ignore fetch failures
  }
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
