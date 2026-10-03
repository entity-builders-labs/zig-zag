import { normalizeOllamaStructuredResponse } from './ollama-response.util';

describe('normalizeOllamaStructuredResponse', () => {
  it('removes an Ollama Markdown JSON fence at the provider boundary', () => {
    expect(normalizeOllamaStructuredResponse('```json\n{"ok":true}\n```')).toBe(
      '{"ok":true}',
    );
  });

  it('does not alter ordinary structured JSON', () => {
    expect(normalizeOllamaStructuredResponse('{"ok":true}')).toBe(
      '{"ok":true}',
    );
  });
});
