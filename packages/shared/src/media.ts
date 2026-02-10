import { downloadMediaMessage, proto } from '@whiskeysockets/baileys';

export async function downloadMedia(rawJson: string): Promise<Buffer> {
  const parsed = JSON.parse(rawJson);
  const msg = proto.WebMessageInfo.fromObject(parsed);
  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  return buffer as Buffer;
}
