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

export async function runGenericAgent(opts: {
  taskId: number;
  prompt: string;
  model?: string | null;
}): Promise<AgentResult> {
  const modelKey = opts.model || 'sonnet';
  const modelId = MODEL_MAP[modelKey] || MODEL_MAP.sonnet;
  const startedAt = Date.now();

  const runId = createTaskRun({ task_id: opts.taskId, started_at: startedAt, model: modelKey });

  const steps: StepEntry[] = [];
  const tokenUsage = { input_tokens: 0, output_tokens: 0 };

  const prompt = injectTemplateVars(opts.prompt);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt },
  ];

  let resultText: string | null = null;

  try {
    for (let i = 0; i < 10; i++) {
      console.log(`[agent] Step ${i + 1}, messages=${messages.length}`);

      const response = await anthropic.messages.create({
        model: modelId,
        max_tokens: 4096,
        tools: toolDefinitions,
        messages,
      });

      tokenUsage.input_tokens += response.usage.input_tokens;
      tokenUsage.output_tokens += response.usage.output_tokens;

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
