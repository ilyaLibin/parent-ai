import type { Content, Part } from '@google/genai';
import { getGeminiClient, GEMINI_MODEL } from '../services/gemini.service.js';
import { toolDefinitions, executeTool } from './tool-registry.js';
import { createTaskRun, completeTaskRun, updateTaskRunSteps } from '@parent-ai/shared';

const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const FAMILY_TIMEZONE = 'Asia/Jerusalem';

type StepEntry =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; result: unknown };

export interface AgentResult {
  success: boolean;
  runId: number;
  steps: StepEntry[];
  resultText: string | null;
  error?: string;
  tokenUsage: { input_tokens: number; output_tokens: number };
}

function injectTemplateVars(text: string): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayDay = HEBREW_DAYS[now.getDay()];
  const tomorrowDay = HEBREW_DAYS[tomorrow.getDay()];

  return text
    .replace(/\{\{today\}\}/g, `יום ${todayDay}`)
    .replace(/\{\{tomorrow\}\}/g, `יום ${tomorrowDay}`)
    .replace(/\{\{date\}\}/g, now.toLocaleDateString('he-IL'))
    .replace(/\{\{datetime\}\}/g, now.toLocaleString('he-IL'))
    .replace(/\[@([^\]]+)\]\(group:([^)]+)\)/g, 'WhatsApp group "$1" (ID: $2)')
    .replace(/\[@([^\]]+)\]\(knowledge:(\d+)\)/g, 'knowledge document "$1" (ID: $2)');
}

// Computed fresh per run so the model always grounds relative dates
// ("today", "tomorrow", "next Monday") in the real current date instead of guessing.
function getCurrentDateInfo(): string {
  const now = new Date();
  const isoLocal = new Intl.DateTimeFormat('sv-SE', {
    timeZone: FAMILY_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(now).replace(' ', 'T');
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: FAMILY_TIMEZONE, weekday: 'long' }).format(now);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: FAMILY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(tomorrow);

  return `Current date and time (${FAMILY_TIMEZONE}): ${isoLocal} (${dayName}). Tomorrow's date is ${tomorrowDate}.
When resolving relative dates/times ("today", "tomorrow", "next Monday", "in an hour", etc.) for tool calls (e.g. createCalendarEvent, createTask), always compute them from this timestamp — never guess or rely on your own sense of the current date.`;
}

function buildSystemInstruction(): string {
  return `You are a helpful assistant that executes tasks using the provided tools.

Rules:
- Only use tools that are necessary to fulfill the user's request.
- Do NOT send Telegram messages unless the user explicitly asks for it.
- Do NOT assume the user wants notifications or reports sent anywhere unless stated.
- When the user asks for "all messages" or doesn't specify a time range, use a large hoursBack value (e.g. 720 for 30 days) to capture as much history as possible.
- Follow the user's instructions precisely — don't add extra steps.
- When transcribing images: be selective. Start with 1-2 images that look relevant based on context (sender, timing, surrounding messages). If an image turns out to be irrelevant (e.g. a sticker, meme, or off-topic photo), skip remaining images from the same sender. Don't blindly transcribe every image.
- createCalendarEvent and createTask are user-facing (Google Calendar / Google Tasks) — use them when the user directly asks to schedule or add something. createActionItem is an internal record used only by the scheduled report tasks that scan WhatsApp groups for homework/deadlines — do not use it for direct user requests.
- The TTS engine used by sendTelegramAudio only supports English (and a few other non-Hebrew languages) — it cannot speak Hebrew or other unsupported languages. Whenever you call sendTelegramAudio, always translate the spoken text to English first, even if your text reply or the conversation is in Hebrew.
- createScheduledTask creates a new recurring automated task (a different concept from createTask/Google Tasks and createCalendarEvent) — only use it when the user wants something to run repeatedly and unattended on a schedule. It is always created disabled for safety; always include the reviewUrl from the result in your reply so the user can review and enable it in the dashboard.

${getCurrentDateInfo()}`;
}

type SupportedImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
type SupportedAudioMediaType = 'audio/wav' | 'audio/mp3' | 'audio/ogg' | 'audio/aac' | 'audio/flac' | 'audio/aiff';

export async function runGenericAgent(opts: {
  taskId: number;
  prompt: string;
  model?: string | null;
  image?: { data: string; mediaType: string };
  audio?: { data: string; mediaType: string };
}): Promise<AgentResult> {
  const startedAt = Date.now();

  const runId = createTaskRun({ task_id: opts.taskId, started_at: startedAt, model: GEMINI_MODEL });

  const steps: StepEntry[] = [];
  const tokenUsage = { input_tokens: 0, output_tokens: 0 };

  const prompt = injectTemplateVars(opts.prompt);
  const ai = getGeminiClient();
  const config = {
    systemInstruction: buildSystemInstruction(),
    tools: [{ functionDeclarations: toolDefinitions }],
  };

  const initialParts: Part[] = [];
  if (opts.image) {
    initialParts.push({ inlineData: { mimeType: opts.image.mediaType as SupportedImageMediaType, data: opts.image.data } });
  }
  if (opts.audio) {
    initialParts.push({ inlineData: { mimeType: opts.audio.mediaType as SupportedAudioMediaType, data: opts.audio.data } });
  }
  initialParts.push({ text: prompt });

  const contents: Content[] = [{ role: 'user', parts: initialParts }];

  let resultText: string | null = null;

  try {
    for (let i = 0; i < 20; i++) {
      console.log(`[agent] Step ${i + 1}, contents=${contents.length}`);

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config,
      });

      tokenUsage.input_tokens += response.usageMetadata?.promptTokenCount || 0;
      tokenUsage.output_tokens += response.usageMetadata?.candidatesTokenCount || 0;

      if (response.text) {
        steps.push({ type: 'text', content: response.text });
        resultText = response.text;
      }

      const functionCalls = response.functionCalls || [];
      if (functionCalls.length === 0) {
        break;
      }

      // Echo the model's turn back (required for multi-turn function calling)
      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) contents.push(modelContent);

      // Execute tools and build functionResponse parts
      const responseParts: Part[] = [];

      for (const call of functionCalls) {
        const args = (call.args || {}) as Record<string, unknown>;
        console.log(`[agent] Tool call: ${call.name}(${JSON.stringify(args).substring(0, 100)})`);
        const result = await executeTool(call.name!, args);
        steps.push({ type: 'tool_call', name: call.name!, args, result });
        responseParts.push({
          functionResponse: { name: call.name!, id: call.id, response: { result } },
        });
      }

      // Persist steps so the dashboard can poll for live progress
      updateTaskRunSteps(runId, JSON.stringify(steps));

      contents.push({ role: 'user', parts: responseParts });
    }

    completeTaskRun(runId, {
      completed_at: Date.now(),
      success: true,
      steps_json: JSON.stringify(steps),
      result_text: resultText,
      token_usage_json: JSON.stringify(tokenUsage),
    });

    return { success: true, runId, steps, resultText, tokenUsage };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Error:`, errorMsg);

    completeTaskRun(runId, {
      completed_at: Date.now(),
      success: false,
      error: errorMsg,
      steps_json: JSON.stringify(steps),
      result_text: resultText,
      token_usage_json: JSON.stringify(tokenUsage),
    });

    return { success: false, runId, steps, resultText, error: errorMsg, tokenUsage };
  }
}
