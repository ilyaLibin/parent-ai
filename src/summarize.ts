import Anthropic from '@anthropic-ai/sdk';
import { getMessagesByGroup, getConnectionGaps, Message } from './db.js';

const anthropic = new Anthropic();

export interface SummaryResult {
  groupName: string;
  period: { start: Date; end: Date };
  messageCount: number;
  summary: string;
  actionItems: string[];
  keyTopics: string[];
  gaps: { start: Date; end: Date; minutes: number }[];
}

export async function summarizeGroup(
  groupIdentifier: string,
  startTime: Date,
  endTime: Date
): Promise<SummaryResult> {
  // Fetch messages from database (supports both ID and name)
  const { group, messages } = getMessagesByGroup(
    groupIdentifier,
    startTime.getTime(),
    endTime.getTime()
  );

  const groupName = group?.name || groupIdentifier;

  if (!group || messages.length === 0) {
    return {
      groupName,
      period: { start: startTime, end: endTime },
      messageCount: 0,
      summary: group ? 'No messages found in this period.' : `Group not found: ${groupIdentifier}`,
      actionItems: [],
      keyTopics: [],
      gaps: [],
    };
  }

  // Check for connection gaps in this period
  const hoursBack = (Date.now() - startTime.getTime()) / 1000 / 60 / 60;
  const allGaps = getConnectionGaps(Math.ceil(hoursBack));
  const relevantGaps = allGaps.filter(
    g => g.start >= startTime.getTime() && g.end <= endTime.getTime()
  );

  // Format messages for the prompt
  const formattedMessages = formatMessagesForPrompt(messages);

  // Call Claude for summarization
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: buildSummaryPrompt(groupName, formattedMessages, startTime, endTime),
      },
    ],
  });

  // Parse the response
  const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = parseSummaryResponse(responseText);

  return {
    groupName,
    period: { start: startTime, end: endTime },
    messageCount: messages.length,
    summary: parsed.summary,
    actionItems: parsed.actionItems,
    keyTopics: parsed.keyTopics,
    gaps: relevantGaps.map(g => ({
      start: new Date(g.start),
      end: new Date(g.end),
      minutes: g.duration_minutes,
    })),
  };
}

function formatMessagesForPrompt(messages: Message[]): string {
  return messages
    .map((m) => {
      const time = new Date(m.timestamp).toLocaleString();
      const sender = m.sender_name || m.sender_id.split('@')[0];
      const content = m.content || `[${m.message_type}]`;
      return `[${time}] ${sender}: ${content}`;
    })
    .join('\n');
}

function buildSummaryPrompt(
  groupName: string,
  messages: string,
  startTime: Date,
  endTime: Date
): string {
  return `You are analyzing WhatsApp group messages from "${groupName}" between ${startTime.toLocaleString()} and ${endTime.toLocaleString()}.

Please provide:
1. A concise summary of the main discussions and events (2-4 paragraphs)
2. A list of action items mentioned (tasks assigned, things people said they would do, deadlines)
3. Key topics/themes discussed

Format your response EXACTLY as follows:

## Summary
[Your summary here]

## Action Items
- [Action item 1]
- [Action item 2]
(or "None identified" if no action items)

## Key Topics
- [Topic 1]
- [Topic 2]

Here are the messages:

${messages}`;
}

function parseSummaryResponse(response: string): {
  summary: string;
  actionItems: string[];
  keyTopics: string[];
} {
  const summaryMatch = response.match(/## Summary\n([\s\S]*?)(?=\n## Action Items|$)/);
  const actionsMatch = response.match(/## Action Items\n([\s\S]*?)(?=\n## Key Topics|$)/);
  const topicsMatch = response.match(/## Key Topics\n([\s\S]*?)$/);

  const summary = summaryMatch?.[1]?.trim() || response;

  const actionItems = actionsMatch?.[1]
    ?.split('\n')
    .filter((line) => line.trim().startsWith('-'))
    .map((line) => line.trim().replace(/^-\s*/, ''))
    .filter((item) => item.toLowerCase() !== 'none identified') || [];

  const keyTopics = topicsMatch?.[1]
    ?.split('\n')
    .filter((line) => line.trim().startsWith('-'))
    .map((line) => line.trim().replace(/^-\s*/, '')) || [];

  return { summary, actionItems, keyTopics };
}

export function formatSummaryForDisplay(result: SummaryResult): string {
  const lines: string[] = [];

  lines.push(`\n${'='.repeat(60)}`);
  lines.push(`📋 Summary for: ${result.groupName}`);
  lines.push(`📅 Period: ${result.period.start.toLocaleString()} - ${result.period.end.toLocaleString()}`);
  lines.push(`💬 Messages analyzed: ${result.messageCount}`);
  lines.push(`${'='.repeat(60)}\n`);

  if (result.gaps.length > 0) {
    lines.push(`⚠️  Connection gaps detected (may have missed messages):`);
    for (const gap of result.gaps) {
      lines.push(`   - ${gap.start.toLocaleTimeString()} to ${gap.end.toLocaleTimeString()} (${gap.minutes} min)`);
    }
    lines.push('');
  }

  lines.push(`## Summary\n${result.summary}\n`);

  if (result.actionItems.length > 0) {
    lines.push(`## Action Items`);
    for (const item of result.actionItems) {
      lines.push(`  ☐ ${item}`);
    }
    lines.push('');
  }

  if (result.keyTopics.length > 0) {
    lines.push(`## Key Topics`);
    for (const topic of result.keyTopics) {
      lines.push(`  • ${topic}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
