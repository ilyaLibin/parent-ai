const STT_URL = process.env.STT_URL || 'http://localhost:8060';
const STT_API_TOKEN = process.env.STT_API_TOKEN;

export async function transcribeAudio(base64Audio: string): Promise<string> {
  const res = await fetch(`${STT_URL}/transcribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(STT_API_TOKEN ? { Authorization: `Bearer ${STT_API_TOKEN}` } : {}),
    },
    body: JSON.stringify({ audio: base64Audio }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`STT service error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { text: string; language?: string };
  return data.text;
}
