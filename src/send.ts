import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { mkdirSync } from 'fs';

const AUTH_DIR = './auth_state';
const logger = pino({ level: 'silent' });

let sock: WASocket | null = null;

async function getConnection(): Promise<WASocket> {
  if (sock) return sock;

  mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
  });

  sock.ev.on('creds.update', saveCreds);

  // Wait for connection to open
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 30000);

    sock!.ev.on('connection.update', (update) => {
      if (update.connection === 'open') {
        clearTimeout(timeout);
        resolve();
      }
      if (update.connection === 'close') {
        clearTimeout(timeout);
        reject(new Error('Connection closed'));
      }
    });
  });

  return sock;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a text message to a contact or group
 * @param recipientId - JID of the recipient (e.g., "1234567890@s.whatsapp.net" or "120363...@g.us")
 * @param text - The message text to send
 */
export async function sendMessage(recipientId: string, text: string): Promise<SendResult> {
  try {
    const connection = await getConnection();

    const result = await connection.sendMessage(recipientId, { text });

    return {
      success: true,
      messageId: result?.key?.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Normalize a phone number to WhatsApp JID format
 * @param phone - Phone number (with or without +, spaces, dashes)
 * @returns JID in format "1234567890@s.whatsapp.net"
 */
export function phoneToJid(phone: string): string {
  // Remove all non-digit characters except leading +
  const cleaned = phone.replace(/[^\d]/g, '');
  return `${cleaned}@s.whatsapp.net`;
}

export async function disconnect(): Promise<void> {
  if (sock) {
    sock.end(undefined);
    sock = null;
  }
}
