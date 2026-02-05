import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  ConnectionState,
  makeInMemoryStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { mkdirSync } from 'fs';
import { logConnectionEvent } from './db.js';

const AUTH_DIR = './auth_state';
const logger = pino({ level: 'warn' });

// In-memory store for contacts/chats (optional but helpful for names)
const store = makeInMemoryStore({ logger });

export interface ConnectionCallbacks {
  onConnected?: (sock: WASocket) => void;
  onDisconnected?: (reason: string) => void;
  onMessage?: Parameters<WASocket['ev']['on']>[1];
}

let sock: WASocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

export async function connectToWhatsApp(callbacks: ConnectionCallbacks): Promise<WASocket> {
  mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: true,
    // getMessage is needed for message retries
    getMessage: async () => undefined,
  });

  // Bind store to socket events
  store.bind(sock.ev);

  // Save credentials when updated
  sock.ev.on('creds.update', saveCreds);

  // Handle connection updates
  sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Scan the QR code above with WhatsApp to link this device\n');
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const reasonText = DisconnectReason[reason] || `Unknown (${reason})`;

      logConnectionEvent('disconnected', reasonText);
      console.log(`❌ Disconnected: ${reasonText}`);
      callbacks.onDisconnected?.(reasonText);

      // Handle different disconnect reasons
      if (reason === DisconnectReason.loggedOut) {
        console.log('🚫 Logged out. Please delete auth_state folder and restart to re-authenticate.');
        process.exit(1);
      }

      // Reconnect with exponential backoff
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000);
        console.log(`🔄 Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        setTimeout(() => connectToWhatsApp(callbacks), delay);
      } else {
        console.error('💀 Max reconnection attempts reached. Exiting.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      logConnectionEvent('connected');
      console.log('✅ Connected to WhatsApp');
      callbacks.onConnected?.(sock!);
    }
  });

  return sock;
}

export function getSocket(): WASocket | null {
  return sock;
}

export function getStore() {
  return store;
}
