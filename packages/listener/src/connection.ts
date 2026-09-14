import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
  WASocket,
  ConnectionState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { mkdirSync } from 'fs';
import qrcode from 'qrcode-terminal';
import { logConnectionEvent } from '@parent-ai/shared';

const AUTH_DIR = process.env.AUTH_STATE_DIR || './auth_state';
const logger = pino({ level: 'silent' });
const signalLogger = pino({ level: 'error' }); // suppress signal protocol noise

export interface ConnectionCallbacks {
  onConnected?: (sock: WASocket) => void;
  onDisconnected?: (reason: string) => void;
}

let sock: WASocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// markOnlineOnConnect:false only skips the initial "online" broadcast — WhatsApp can
// still suppress phone notifications for an active linked session over time. Periodically
// re-asserting 'unavailable' presence keeps phone notifications flowing.
const PRESENCE_PING_INTERVAL_MS = 30_000;
let presenceInterval: ReturnType<typeof setInterval> | null = null;

function stopPresenceUpdates() {
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
}

function startPresenceUpdates(socket: WASocket) {
  stopPresenceUpdates();
  const ping = () => socket.sendPresenceUpdate('unavailable').catch(() => {});
  ping();
  presenceInterval = setInterval(ping, PRESENCE_PING_INTERVAL_MS);
}

// Baileys' own FAQ warns against calling fetchLatestBaileysVersion() on every connect —
// newer versions can be incompatible, and reconnects (including automatic retries) would
// otherwise refetch it every time. Fetch once per process lifetime and reuse it.
let cachedVersion: Awaited<ReturnType<typeof fetchLatestBaileysVersion>> | null = null;

async function getWaVersion() {
  if (!cachedVersion) {
    cachedVersion = await fetchLatestBaileysVersion();
  }
  return cachedVersion;
}

export async function connectToWhatsApp(callbacks: ConnectionCallbacks): Promise<WASocket> {
  mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const { version, isLatest } = await getWaVersion();
  console.log(`📱 Using WA Web version: ${version.join('.')}${isLatest ? ' (latest)' : ''}`);

  sock = makeWASocket({
    version,
    logger,
    markOnlineOnConnect: false,
    // Defaults to true — pulls full history for every chat, not just tracked groups.
    // We only care about tracked group messages going forward, so skip the extra
    // startup time/memory (per baileys.wiki/concepts/socket-config).
    syncFullHistory: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, signalLogger),
    },
  });

  // Save credentials when updated
  sock.ev.on('creds.update', saveCreds);

  // Handle connection updates
  sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Scan the QR code below with WhatsApp to link this device:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      stopPresenceUpdates();

      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const reasonText = DisconnectReason[reason] || `Unknown (${reason})`;

      logConnectionEvent('disconnected', reasonText);
      console.log(`❌ Disconnected: ${reasonText}`);
      callbacks.onDisconnected?.(reasonText);

      // Handle different disconnect reasons
      if (reason === DisconnectReason.loggedOut) {
        // Unrecoverable without a human re-scanning the QR code. Do NOT exit here —
        // with `restart: unless-stopped`, Docker would immediately relaunch the
        // container and hit this same dead-credentials loop every few seconds,
        // indefinitely. Idle instead: the container stays up, but stops hammering
        // WhatsApp until someone deletes auth_state and restarts it manually.
        console.log('🚫 Logged out. Delete the auth_state folder and restart this service to re-authenticate. Not retrying automatically — a dead session would otherwise keep reconnecting to WhatsApp forever.');
        // Nothing else keeps the event loop alive once the socket closes, so Node would
        // exit naturally here and Docker would restart us right back into this branch —
        // the exact loop we're trying to avoid. An inert interval keeps the process (and
        // container) idling indefinitely without doing anything.
        setInterval(() => {}, 1000 * 60 * 60);
        return;
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
      startPresenceUpdates(sock!);
      callbacks.onConnected?.(sock!);
    }
  });

  return sock;
}

export function getSocket(): WASocket | null {
  return sock;
}
