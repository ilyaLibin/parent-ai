import { downloadMediaMessage, proto } from '@whiskeysockets/baileys';
import { writeFileSync } from 'fs';

const rawJson = JSON.parse(process.argv[2]);
const msg = proto.WebMessageInfo.fromObject(rawJson);

async function main() {
  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  writeFileSync('/tmp/school_homework.jpg', buffer as Buffer);
  console.log('Image saved to /tmp/school_homework.jpg');
}

main().catch(console.error);
