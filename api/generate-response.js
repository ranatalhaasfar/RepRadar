import { getClient, TONE_DESCRIPTIONS } from './_lib/shared.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { review, tone } = body;
  if (!review?.trim() || !tone) {
    return new Response(JSON.stringify({ error: 'Review and tone are required.' }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = getClient().messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 512,
          system:
            'You are an expert customer service consultant helping small business owners respond to customer reviews. ' +
            'Write concise, genuine responses (2-4 sentences) that are ready to copy and post publicly. ' +
            'Do not include a subject line, greeting label, or any meta-commentary — just the response text itself.',
          messages: [{
            role: 'user',
            content:
              `Write a ${tone} response to the following customer review.\n` +
              `The tone should be: ${TONE_DESCRIPTIONS[tone]}.\n\n` +
              `Customer Review:\n"${review.trim()}"\n\n` +
              `Write the response now, starting directly with the text:`,
          }],
        });

        for await (const event of anthropicStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`));
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
