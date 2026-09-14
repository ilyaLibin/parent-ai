import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Content, FunctionDeclaration, Part } from '@google/genai';
import { getGeminiClient, GEMINI_MODEL } from '../services/gemini.service.js';
import {
  getCronJobs,
  getKnowledgeByName,
  getKnowledgeList,
  getGroups,
} from '@parent-ai/shared';

const ai = new Hono();

type StepEntry =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; result: unknown };

// Tools the assist agent can use to gather context
const assistToolDefinitions: FunctionDeclaration[] = [
  {
    name: 'listTasks',
    description: 'List all existing task definitions with their names, schedules, models, and prompts.',
    parametersJsonSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'listKnowledge',
    description: 'List all available knowledge entries by name.',
    parametersJsonSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'getKnowledge',
    description: 'Get the full content of a knowledge entry by name.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the knowledge entry to retrieve.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'listGroups',
    description: 'List all WhatsApp groups with their names and IDs.',
    parametersJsonSchema: { type: 'object', properties: {}, required: [] },
  },
];

const assistToolImplementations: Record<string, (args: Record<string, unknown>) => unknown> = {
  listTasks() {
    const tasks = getCronJobs(false);
    return {
      tasks: tasks.map((t) => ({
        name: t.name,
        schedule: t.schedule,
        model: t.model || 'sonnet',
        enabled: t.enabled,
        prompt: t.prompt || null,
      })),
    };
  },
  listKnowledge() {
    const entries = getKnowledgeList();
    return { entries: entries.map((e) => ({ name: e.name })) };
  },
  getKnowledge(args) {
    const name = args.name as string;
    const entry = getKnowledgeByName(name);
    if (!entry) return { error: `Knowledge entry "${name}" not found.` };
    return { name: entry.name, content: entry.content };
  },
  listGroups() {
    const groups = getGroups();
    return { groups: groups.map((g) => ({ id: g.id, name: g.name })) };
  },
};

ai.post('/ai/assist', async (c) => {
  const body = await c.req.json<{
    type: 'improve-prompt' | 'generate-knowledge';
    instructions: string;
    currentContent?: string;
  }>();

  if (!body.type || !body.instructions?.trim()) {
    return c.json({ error: 'type and instructions are required' }, 400);
  }

  const isImprove = body.type === 'improve-prompt';

  const systemPrompt = isImprove
    ? `You are an expert at writing AI agent task prompts for a WhatsApp monitoring system.

You have tools to explore existing tasks, knowledge entries, and groups. Use them to understand the current setup before writing the improved prompt.

Rules:
- Use tools first to gather relevant context — check existing tasks, knowledge, and groups as needed.
- After gathering context, output ONLY the improved/new prompt text.
- No explanations, no markdown code blocks, no preamble — just the raw prompt.
- The prompts can use these template variables: {{today}}, {{tomorrow}}, {{date}}, {{datetime}}
- The prompts can reference groups and knowledge with @mention syntax: [@Name](type:id)`
    : `You are an expert at creating knowledge base documents for a WhatsApp monitoring system.

You have tools to explore existing tasks, knowledge entries, and groups. Use them to understand the current setup before generating content.

Rules:
- Use tools first to gather relevant context — check existing tasks, knowledge, and groups as needed.
- After gathering context, output ONLY the knowledge content.
- No explanations, no markdown code blocks wrapping the content, no preamble.
- The content should be in markdown format.`;

  const userPrompt = body.currentContent
    ? `Here is the current ${isImprove ? 'prompt' : 'content'}:\n\n${body.currentContent}\n\nInstructions:\n${body.instructions}`
    : `${isImprove ? 'Create a new prompt' : 'Generate knowledge content'} based on these instructions:\n${body.instructions}`;

  return streamSSE(c, async (stream) => {
    const steps: StepEntry[] = [];
    const contents: Content[] = [{ role: 'user', parts: [{ text: userPrompt }] }];
    const genai = getGeminiClient();
    const config = {
      systemInstruction: systemPrompt,
      tools: [{ functionDeclarations: assistToolDefinitions }],
    };

    try {
      for (let i = 0; i < 10; i++) {
        const response = await genai.models.generateContent({
          model: GEMINI_MODEL,
          contents,
          config,
        });

        if (response.text?.trim()) {
          steps.push({ type: 'text', content: response.text });
          await stream.writeSSE({ data: JSON.stringify({ type: 'steps', steps }), event: 'steps' });
        }

        const functionCalls = response.functionCalls || [];
        if (functionCalls.length === 0) {
          break;
        }

        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) contents.push(modelContent);

        // Execute tool calls
        const responseParts: Part[] = [];

        for (const call of functionCalls) {
          const args = (call.args || {}) as Record<string, unknown>;
          const impl = assistToolImplementations[call.name!];
          const result = impl ? impl(args) : { error: `Unknown tool: ${call.name}` };

          steps.push({ type: 'tool_call', name: call.name!, args, result });
          await stream.writeSSE({ data: JSON.stringify({ type: 'steps', steps }), event: 'steps' });

          responseParts.push({
            functionResponse: { name: call.name!, id: call.id, response: { result } },
          });
        }

        contents.push({ role: 'user', parts: responseParts });
      }

      // Extract the final text result (last text step)
      const textSteps = steps.filter((s) => s.type === 'text') as { type: 'text'; content: string }[];
      const result = textSteps.length > 0 ? textSteps[textSteps.length - 1].content : '';

      await stream.writeSSE({ data: JSON.stringify({ type: 'done', result, steps }), event: 'done' });
    } catch (err: any) {
      console.error('[ai] assist error:', err.message);
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: err.message || 'AI assist failed' }), event: 'error' });
    }
  });
});

export { ai };
