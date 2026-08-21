// Minimal multi-turn CLI chat client for OpenRouter.
//
// OpenRouter is a single API that proxies to 400+ models from many
// providers (OpenAI, Anthropic, Google, Meta, etc.) using one API key and
// one request shape. You pick the model per-request via a plain string —
// no separate SDK per provider.
import { OpenRouter } from '@openrouter/sdk';
import type { ChatStreamChunk } from '@openrouter/sdk/models';
import type { EventStream } from '@openrouter/sdk/lib/event-streams.js';
import readline from 'node:readline';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error(
    'Missing OPENROUTER_API_KEY. Create one at https://openrouter.ai/settings/keys ' +
      'and run: OPENROUTER_API_KEY=sk-or-v1-... npx tsx chat.ts',
  );
  process.exit(1);
}

const client = new OpenRouter({ apiKey });

// Swap providers by changing only this string — nothing else in the file
// needs to change, since every model speaks the same request/response shape.
//
// Other verified model strings you can try here:
//   openai/gpt-chat-latest
//   anthropic/claude-sonnet-latest
//   baidu/cobuddy:free   (":free" suffix = no cost, but rate-limited)
const MODEL = 'google/gemini-3.1-flash-lite';

// In-memory conversation history. Every turn resends the *whole* array, so
// the model can see earlier messages — OpenRouter (like any chat API) is
// stateless between requests.
type Message = { role: 'user' | 'assistant'; content: string };
const messages: Message[] = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(): void {
  rl.question('You: ', async (userInput: string) => {
    if (userInput.trim().toLowerCase() === 'exit') {
      rl.close();
      return;
    }

    messages.push({ role: 'user', content: userInput });

    // The SDK's chat.send() overloads don't narrow the return type based on
    // `stream`, so both branches type as ChatResult | EventStream<...>. We
    // asserted stream: true above, so we know at runtime this is a stream.
    const stream = (await client.chat.send({
      chatRequest: {
        model: MODEL,
        messages,
        stream: true,
        // Without this, the SDK asks the model for its max possible output
        // (65536+ for some models) even for a short reply — free-tier
        // accounts don't have enough balance to cover that ceiling and the
        // whole request gets rejected with 402, even though the actual
        // reply would've been cheap. Capping it keeps requests affordable.
        // Raise this if replies keep cutting off (check finishReason on the
        // last stream chunk — 'length' means it hit this cap); lower it if
        // you start seeing 402s again.
        maxTokens: 2000,
      },
    })) as EventStream<ChatStreamChunk>;

    process.stdout.write('Assistant: ');
    let assistantResponse = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        process.stdout.write(delta);
        assistantResponse += delta;
      }
    }
    process.stdout.write('\n');

    messages.push({ role: 'assistant', content: assistantResponse });
    askQuestion();
  });
}

console.log(`Chatting with ${MODEL}. Type "exit" to quit.\n`);
askQuestion();
