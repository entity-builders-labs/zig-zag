import { PromptTemplate } from '@langchain/core/prompts';
import {
  assessWikidataExtractSafety,
  CONTENT_SAFETY_PROMPT,
  filterSafeWikidataExtracts,
} from './wikidata-content-safety.util';
import { LangChainService } from '@shared/ai/langchain.service';

describe('filterSafeWikidataExtracts', () => {
  const buildLangChainService = (
    response: string,
  ): jest.Mocked<Pick<LangChainService, 'generateCompletionResponse'>> => ({
    generateCompletionResponse: jest.fn().mockResolvedValue(response),
  });

  it('formats the real production prompt with literal JSON before any model mock runs', async () => {
    const prompt = PromptTemplate.fromTemplate(CONTENT_SAFETY_PROMPT);

    const formatted = await prompt.format({
      extractsJson: JSON.stringify({ Q1: 'A real place.' }),
    });

    expect(formatted).toContain('{"Q1":"A real place."}');
    expect(formatted).toContain('Example: {"Q1": true, "Q2": false}');
  });

  it('returns an empty set immediately without calling the LLM when there is nothing to check', async () => {
    const langChain = buildLangChainService('{}');

    const result = await filterSafeWikidataExtracts([], langChain as any);

    expect(result.size).toBe(0);
    expect(langChain.generateCompletionResponse).not.toHaveBeenCalled();
  });

  it('classifies a whole batch of deduplicated extracts in a single LLM call', async () => {
    const langChain = buildLangChainService(
      JSON.stringify({ Q1: true, Q2: true, Q3: true }),
    );

    const result = await filterSafeWikidataExtracts(
      [
        { qid: 'Q1', extract: 'San Telmo is a historic barrio...' },
        { qid: 'Q2', extract: 'Plaza Dorrego is a square...' },
        { qid: 'Q3', extract: 'Caminito is a street museum...' },
      ],
      langChain as any,
    );

    expect(langChain.generateCompletionResponse).toHaveBeenCalledTimes(1);
    expect(result).toEqual(new Set(['Q1', 'Q2', 'Q3']));
  });

  it('drops only the extract(s) flagged unsafe, keeping the rest of the same batch', async () => {
    const langChain = buildLangChainService(
      JSON.stringify({ Q1: true, Q2: false }),
    );

    const result = await filterSafeWikidataExtracts(
      [
        { qid: 'Q1', extract: 'A real historical fact.' },
        { qid: 'Q2', extract: 'obvious vandalism here lol' },
      ],
      langChain as any,
    );

    expect(result).toEqual(new Set(['Q1']));
  });

  it('drops every extract in the batch when the model response is not valid JSON', async () => {
    const langChain = buildLangChainService('sorry, I cannot help with that');

    const result = await filterSafeWikidataExtracts(
      [{ qid: 'Q1', extract: 'whatever' }],
      langChain as any,
    );

    expect(result.size).toBe(0);
  });

  it('tolerates a JSON object wrapped in prose/markdown fencing', async () => {
    const langChain = buildLangChainService(
      'Here you go:\n```json\n{"Q1": true}\n```',
    );

    const result = await filterSafeWikidataExtracts(
      [{ qid: 'Q1', extract: 'whatever' }],
      langChain as any,
    );

    expect(result).toEqual(new Set(['Q1']));
  });

  it('drops every extract in the batch when the LLM call itself fails, without throwing', async () => {
    const langChain = {
      generateCompletionResponse: jest
        .fn()
        .mockRejectedValue(new Error('groq down')),
    };

    const result = await filterSafeWikidataExtracts(
      [
        { qid: 'Q1', extract: 'a' },
        { qid: 'Q2', extract: 'b' },
      ],
      langChain as any,
    );

    expect(result.size).toBe(0);
  });

  it('reports a failed safety check separately from a successful unsafe classification', async () => {
    const failedLangChain = {
      generateCompletionResponse: jest
        .fn()
        .mockRejectedValue(new Error('groq down')),
    };
    const unsafeLangChain = buildLangChainService('{"Q1":false}');

    const failed = await assessWikidataExtractSafety(
      [{ qid: 'Q1', extract: 'a' }],
      failedLangChain as any,
    );
    const unsafe = await assessWikidataExtractSafety(
      [{ qid: 'Q1', extract: 'a' }],
      unsafeLangChain as any,
    );

    expect(failed).toEqual({ safeQids: new Set(), status: 'failed' });
    expect(unsafe).toEqual({ safeQids: new Set(), status: 'success' });
  });

  it('treats a QID absent from the response as unsafe (fails closed, not open)', async () => {
    const langChain = buildLangChainService(JSON.stringify({ Q1: true }));

    const result = await filterSafeWikidataExtracts(
      [
        { qid: 'Q1', extract: 'a' },
        { qid: 'Q2', extract: 'b' }, // model didn't mention Q2 at all
      ],
      langChain as any,
    );

    expect(result).toEqual(new Set(['Q1']));
  });
});
