import type { Content, Part } from '@google/genai';
import { getGeminiClient, GEMINI_MODEL } from '../services/gemini.service.js';
import { toolDefinitions, executeTool } from './tool-registry.js';
import { createTaskRun, completeTaskRun, updateTaskRunSteps, getRecentChatTurns, saveChatTurn, getKnowledgeByName } from '@parent-ai/shared';

const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const FAMILY_TIMEZONE = 'Asia/Jerusalem';

// A knowledge entry the agent itself can edit via saveKnowledge (e.g. "always do X
// from now on") — auto-injected into every run's system instruction, giving a simple
// self-updating standing-instructions mechanism without a code change per preference.
const LEARNED_INSTRUCTIONS_KNOWLEDGE_NAME = 'system_prompt';

// Short-lived conversation memory for Telegram chat — enough for a quick follow-up
// ("one event") to resolve against the bot's immediately preceding question, not a
// persistent thread. Idle longer than this and the next message starts fresh.
const CHAT_HISTORY_WINDOW_MS = 3 * 60 * 1000;
const MAX_HISTORY_TURNS = 6;

type StepEntry =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; result: unknown };

export interface ChecklistResultItem {
  id: number;
  label: string;
  checked: boolean;
}

export interface AgentResult {
  success: boolean;
  runId: number;
  steps: StepEntry[];
  resultText: string | null;
  checklist?: ChecklistResultItem[];
  error?: string;
  tokenUsage: { input_tokens: number; output_tokens: number };
}

// If the model called presentChecklist, surface its items on the result so the
// Telegram layer can render them as tappable buttons instead of the plain text reply.
function extractChecklist(steps: StepEntry[]): ChecklistResultItem[] | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'tool_call' && step.name === 'presentChecklist') {
      const result = step.result as { success?: boolean; items?: ChecklistResultItem[] };
      if (result?.success && result.items) return result.items;
    }
  }
  return undefined;
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
- Your text replies are sent to Telegram using its legacy Markdown mode, which is NOT standard Markdown: use single *asterisks* for bold (never **double asterisks**), _underscores_ for italic, and \`backticks\` for code. Do not use headers (#), tables, or nested/mixed formatting — Telegram doesn't render them and they'll show up as literal characters.
- createCalendarEvent and createTask are user-facing (Google Calendar / Google Tasks) — use them when the user directly asks to schedule or add something. createActionItem is an internal record used only by the scheduled report tasks that scan WhatsApp groups for homework/deadlines — do not use it for direct user requests.
- When your answer is a list of things to do / remember / bring (not a single fact or a general answer), call presentChecklist instead of just describing the list in text — it renders as a tappable checklist in Telegram. This is a display layer, not a replacement for createActionItem/createTask/Google Tasks — those remain the source of truth for real to-dos.
- The TTS engine used by sendTelegramAudio only supports English (and a few other non-Hebrew languages) — it cannot speak Hebrew or other unsupported languages. Whenever you call sendTelegramAudio, always translate the spoken text to English first, even if your text reply or the conversation is in Hebrew.
- createScheduledTask creates a new recurring automated task (a different concept from createTask/Google Tasks and createCalendarEvent) — only use it when the user wants something to run repeatedly and unattended on a schedule. It is always created disabled for safety; always include the reviewUrl from the result in your reply so the user can review and enable it in the dashboard.
- If the user asks you to remember something or behave a certain way going forward ("always do X from now on", "stop doing Y"), that's a standing instruction, not a one-off request: use saveKnowledge with name "${LEARNED_INSTRUCTIONS_KNOWLEDGE_NAME}" to persist it. First call getKnowledge on that name to see what's already there (it may not exist yet) and APPEND the new rule to the existing content — never overwrite what's already saved there unless the user is explicitly asking to remove/replace a prior rule.
- scheduleWhatsAppMessage only ever targets a contact that was shared via a WhatsApp contact card earlier in the same conversation — never guess, invent, or reuse a phone number/JID from anywhere else (e.g. from a WhatsApp group's message history). If the message text was given in quotes, send it verbatim — do not paraphrase or rewrite it unless explicitly asked to fix grammar or add something.

${getCurrentDateInfo()}

${buildLearnedInstructions()}`;
}

function buildLearnedInstructions(): string {
  const entry = getKnowledgeByName(LEARNED_INSTRUCTIONS_KNOWLEDGE_NAME);
  if (!entry?.content?.trim()) return '';
  return `--- Standing instructions you previously saved (via saveKnowledge, name "${LEARNED_INSTRUCTIONS_KNOWLEDGE_NAME}") — follow these on every run ---
${entry.content}`;
}

type SupportedImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
type SupportedAudioMediaType = 'audio/wav' | 'audio/mp3' | 'audio/ogg' | 'audio/aac' | 'audio/flac' | 'audio/aiff';

// We don't persist raw image/audio bytes anywhere, so history can only carry forward
// a text label for that turn — the model's own reply already captures what it saw/heard.
function saveChatExchange(chatId: string | undefined, prompt: string, hasImage: boolean, hasAudio: boolean, resultText: string | null): void {
  if (!chatId) return;
  const label = hasImage ? '[Photo] ' : hasAudio ? '[Voice message] ' : '';
  saveChatTurn(chatId, 'user', `${label}${prompt}`);
  if (resultText) saveChatTurn(chatId, 'model', resultText);
}

export async function runGenericAgent(opts: {
  taskId: number;
  prompt: string;
  model?: string | null;
  image?: { data: string; mediaType: string };
  audio?: { data: string; mediaType: string };
  chatId?: string;
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

  const contents: Content[] = [];
  if (opts.chatId) {
    const since = Date.now() - CHAT_HISTORY_WINDOW_MS;
    const history = getRecentChatTurns(opts.chatId, since, MAX_HISTORY_TURNS);
    for (const turn of history) {
      contents.push({ role: turn.role, parts: [{ text: turn.content }] });
    }
  }
  contents.push({ role: 'user', parts: initialParts });

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

    saveChatExchange(opts.chatId, opts.prompt, !!opts.image, !!opts.audio, resultText);

    return { success: true, runId, steps, resultText, checklist: extractChecklist(steps), tokenUsage };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Error:`, errorMsg);

    saveChatExchange(opts.chatId, opts.prompt, !!opts.image, !!opts.audio, resultText || `Error: ${errorMsg}`);

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
