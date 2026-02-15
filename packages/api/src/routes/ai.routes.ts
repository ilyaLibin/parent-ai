import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import {
  getCronJobs,
  getKnowledgeByName,
  getKnowledgeById,
  getGroupsByIds,
  getGroups,
} from '@parent-ai/shared';

const anthropic = new Anthropic();
const ai = new Hono();

const MENTION_RE = /\[@([^\]]+)\]\((group|knowledge):([^)]+)\)/g;

function parseMentions(text: string): { type: string; name: string; id: string }[] {
  const mentions: { type: string; name: string; id: string }[] = [];
  let match;
  while ((match = MENTION_RE.exec(text)) !== null) {
    mentions.push({ name: match[1], type: match[2], id: match[3] });
  }
  return mentions;
}

function gatherContext(instructions: string, currentContent?: string) {
  const mentions = parseMentions(instructions + '\n' + (currentContent || ''));

  // Gather all task prompts for context
  const tasks = getCronJobs(false);
  const taskContext = tasks
    .filter((t) => t.prompt)
    .map((t) => `## Task: ${t.name}\nSchedule: ${t.schedule}\nModel: ${t.model || 'sonnet'}\n\n${t.prompt}`)
    .join('\n\n---\n\n');

  // Gather mentioned knowledge
  const knowledgeParts: string[] = [];
  for (const m of mentions.filter((m) => m.type === 'knowledge')) {
    const k = getKnowledgeById(Number(m.id)) || getKnowledgeByName(m.name);
    if (k) knowledgeParts.push(`## Knowledge: ${k.name}\n\n${k.content}`);
  }

  // Gather mentioned groups
  const groupIds = mentions.filter((m) => m.type === 'group').map((m) => m.id);
  const groupParts: string[] = [];
  if (groupIds.length > 0) {
    const groups = getGroupsByIds(groupIds);
    for (const g of groups) {
      groupParts.push(`- Group "${g.name}" (ID: ${g.id})`);
    }
  }

  let context = '';
  if (taskContext) {
    context += `# Existing Tasks\n\n${taskContext}\n\n`;
  }
  if (knowledgeParts.length > 0) {
    context += `# Referenced Knowledge\n\n${knowledgeParts.join('\n\n---\n\n')}\n\n`;
  }
  if (groupParts.length > 0) {
    context += `# Referenced Groups\n\n${groupParts.join('\n')}\n\n`;
  }

  return context;
}

ai.post('/ai/assist', async (c) => {
  const body = await c.req.json<{
    type: 'improve-prompt' | 'generate-knowledge';
    instructions: string;
    currentContent?: string;
  }>();

  if (!body.type || !body.instructions?.trim()) {
    return c.json({ error: 'type and instructions are required' }, 400);
  }

  const context = gatherContext(body.instructions, body.currentContent);

  let systemPrompt: string;
  let userPrompt: string;

  if (body.type === 'improve-prompt') {
    systemPrompt = `You are an expert at writing AI agent task prompts. You help improve prompts for scheduled AI agents that monitor WhatsApp groups and generate reports.

Your output must be ONLY the improved prompt text — no explanations, no markdown code blocks, no preamble. Just the raw prompt that will be used directly.

The prompts can use these template variables: {{today}}, {{tomorrow}}, {{date}}, {{datetime}}
The prompts can reference groups and knowledge with @mention syntax: [@Name](type:id)

${context}`;

    userPrompt = body.currentContent
      ? `Here is the current prompt to improve:\n\n${body.currentContent}\n\nInstructions for improvement:\n${body.instructions}`
      : `Create a new prompt based on these instructions:\n${body.instructions}`;
  } else {
    systemPrompt = `You are an expert at creating knowledge base documents. These documents are used by AI agents as reference material when generating reports about WhatsApp group activities.

Your output must be ONLY the knowledge content — no explanations, no markdown code blocks wrapping the content, no preamble. Just the raw content that will be stored directly. The content should be in markdown format.

${context}`;

    userPrompt = body.currentContent
      ? `Here is the current knowledge content to improve:\n\n${body.currentContent}\n\nInstructions:\n${body.instructions}`
      : `Generate knowledge content based on these instructions:\n${body.instructions}`;
  }

  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const result = (res.content[0] as { type: 'text'; text: string }).text;
    return c.json({ result });
  } catch (err: any) {
    console.error('[ai] assist error:', err.message);
    return c.json({ error: 'AI assist failed' }, 500);
  }
});

export { ai };
