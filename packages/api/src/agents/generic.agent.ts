import Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions, executeTool } from './tool-registry.js';
import { createTaskRun, completeTaskRun, updateTaskRunSteps } from '@parent-ai/shared';

const anthropic = new Anthropic();

const MODEL_MAP: Record<string, string> = {
  sonnet: 'claude-sonnet-4-20250514',
  haiku: 'claude-haiku-4-5-20251001',
  opus: 'claude-opus-4-20250514',
};

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

// Computed fresh per run (never cached) so the model always grounds relative dates
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

type SupportedImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export async function runGenericAgent(opts: {
  taskId: number;
  prompt: string;
  model?: string | null;
  image?: { data: string; mediaType: string };
}): Promise<AgentResult> {
  const modelKey = opts.model || 'sonnet';
  const modelId = MODEL_MAP[modelKey] || MODEL_MAP.sonnet;
  const startedAt = Date.now();

  const runId = createTaskRun({ task_id: opts.taskId, started_at: startedAt, model: modelKey });

  const steps: StepEntry[] = [];
  const tokenUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

  const prompt = injectTemplateVars(opts.prompt);

  const systemPrompt: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: `You are a helpful assistant that executes tasks using the provided tools.

Rules:
- Only use tools that are necessary to fulfill the user's request.
- Do NOT send Telegram messages unless the user explicitly asks for it.
- Do NOT assume the user wants notifications or reports sent anywhere unless stated.
- When the user asks for "all messages" or doesn't specify a time range, use a large hoursBack value (e.g. 720 for 30 days) to capture as much history as possible.
- Follow the user's instructions precisely — don't add extra steps.
- When transcribing images: be selective. Start with 1-2 images that look relevant based on context (sender, timing, surrounding messages). If an image turns out to be irrelevant (e.g. a sticker, meme, or off-topic photo), skip remaining images from the same sender. Don't blindly transcribe every image.
- createCalendarEvent and createTask are user-facing (Google Calendar / Google Tasks) — use them when the user directly asks to schedule or add something. createActionItem is an internal record used only by the scheduled report tasks that scan WhatsApp groups for homework/deadlines — do not use it for direct user requests.`,
      cache_control: { type: 'ephemeral' },
    },
    // Not cached — must reflect the real current date on every run.
    { type: 'text', text: getCurrentDateInfo() },
  ];

  // Mark last tool for caching so the full tool array is cached
  const cachedTools = toolDefinitions.map((tool, i) =>
    i === toolDefinitions.length - 1
      ? { ...tool, cache_control: { type: 'ephemeral' as const } }
      : tool
  );

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: opts.image
        ? [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: opts.image.mediaType as SupportedImageMediaType,
                data: opts.image.data,
              },
            },
            { type: 'text', text: prompt },
          ]
        : prompt,
    },
  ];

  let resultText: string | null = null;

  try {
    for (let i = 0; i < 20; i++) {
      console.log(`[agent] Step ${i + 1}, messages=${messages.length}`);

      const response = await anthropic.messages.create({
        model: modelId,
        max_tokens: 4096,
        system: systemPrompt,
        tools: cachedTools,
        messages,
      });

      tokenUsage.input_tokens += response.usage.input_tokens;
      tokenUsage.output_tokens += response.usage.output_tokens;
      const usage = response.usage as unknown as Record<string, number>;
      tokenUsage.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
      tokenUsage.cache_read_input_tokens += usage.cache_read_input_tokens || 0;

      for (const block of response.content) {
        if (block.type === 'text') {
          steps.push({ type: 'text', content: block.text });
          resultText = block.text;
        }
      }

      if (response.stop_reason !== 'tool_use') {
        break;
      }

      // Execute tools and build tool_result messages
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const args = block.input as Record<string, unknown>;
          console.log(`[agent] Tool call: ${block.name}(${JSON.stringify(args).substring(0, 100)})`);
          const result = await executeTool(block.name, args);
          steps.push({ type: 'tool_call', name: block.name, args, result });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      // Persist steps so the dashboard can poll for live progress
      updateTaskRunSteps(runId, JSON.stringify(steps));

      // Push assistant message + tool results
      messages.push({ role: 'assistant', content: response.content as Anthropic.ContentBlockParam[] });
      messages.push({ role: 'user', content: toolResults });
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
