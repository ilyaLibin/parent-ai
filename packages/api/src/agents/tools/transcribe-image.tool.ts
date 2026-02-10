import { tool } from 'ai';
import { z } from 'zod';
import { getMessageRawJson, downloadMedia } from '@parent-ai/shared';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export const transcribeImageTool = tool({
  description:
    'Download and transcribe an image from a WhatsApp message. Use this when a message has type "image" to extract text or describe the image content (e.g., homework photos, schedules, announcements).',
  parameters: z.object({
    messageId: z.string().describe('The message ID of the image message to transcribe.'),
    context: z
      .string()
      .optional()
      .describe('Optional context about what to look for in the image (e.g., "homework assignment", "schedule change").'),
  }),
  execute: async ({ messageId, context }) => {
    const rawJson = getMessageRawJson(messageId);
    if (!rawJson) {
      return { success: false, error: `Message ${messageId} not found or has no raw data.` };
    }

    let imageBuffer: Buffer;
    try {
      imageBuffer = await downloadMedia(rawJson);
    } catch (err) {
      return {
        success: false,
        error: `Failed to download image: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const base64 = imageBuffer.toString('base64');
    const prompt = context
      ? `Extract all text and important information from this image. Context: ${context}. If the image contains Hebrew text, transcribe it in Hebrew.`
      : `Extract all text and important information from this image. If it contains Hebrew text, transcribe it in Hebrew. Describe any visual content that provides useful information.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return { success: true, transcription: text };
  },
});
