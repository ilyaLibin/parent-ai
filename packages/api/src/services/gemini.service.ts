import { GoogleGenAI } from '@google/genai';
import { getIntegration } from '@parent-ai/shared';

export const GEMINI_MODEL = 'gemini-3.7-flash';

function getApiKey(): string {
  const integration = getIntegration('gemini');
  if (integration) {
    const config = JSON.parse(integration.config_json);
    if (config.api_key) return config.api_key;
  }
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  throw new Error('Gemini is not configured — add an API key in Settings.');
}

let cachedClient: { key: string; client: GoogleGenAI } | null = null;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = getApiKey();
  if (cachedClient && cachedClient.key === apiKey) return cachedClient.client;
  const client = new GoogleGenAI({ apiKey });
  cachedClient = { key: apiKey, client };
  return client;
}
