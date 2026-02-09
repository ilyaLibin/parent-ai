import { WASocket } from '@whiskeysockets/baileys';

let socket: WASocket | null = null;

export function setSocket(sock: WASocket | null): void {
  socket = sock;
}

export function getSocket(): WASocket | null {
  return socket;
}

export function requireSocket(): WASocket {
  if (!socket) throw new Error('Not connected to WhatsApp');
  return socket;
}
