const TTS_URL = process.env.TTS_URL || 'http://localhost:5050';
const TTS_API_TOKEN = process.env.TTS_API_TOKEN || '';

export async function POST(req: Request) {
  const body = await req.json();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TTS_API_TOKEN) headers['Authorization'] = `Bearer ${TTS_API_TOKEN}`;

  const res = await fetch(`${TTS_URL}/tts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    return new Response(err, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(res.body, {
    headers: { 'Content-Type': 'audio/wav' },
  });
}
