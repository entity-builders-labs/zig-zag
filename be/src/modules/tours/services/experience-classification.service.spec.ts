import { Test, TestingModule } from '@nestjs/testing';
import { LangChainService } from '@shared/ai/langchain.service';
import aiConfig from '@shared/ai/ai.config';
import {
  ExperienceClassificationService,
  CURRENT_CLASSIFICATION_PROMPT_VERSION,
  canReuseClassification,
} from './experience-classification.service';

describe('ExperienceClassificationService', () => {
  let service: ExperienceClassificationService;
  let generateChatResponse: jest.Mock;

  const EVIDENCE = [
    {
      key: 'ev-1',
      source: 'wikivoyage',
      title: 'San Telmo',
      snippet:
        'A colonial-era town hall, now a history museum with rooftop tango events.',
    },
  ];

  beforeEach(async () => {
    generateChatResponse = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExperienceClassificationService,
        { provide: LangChainService, useValue: { generateChatResponse } },
        {
          provide: aiConfig.KEY,
          useValue: {
            classification: { groq: { model: 'groq-classify-test' } },
          },
        },
      ],
    }).compile();
    service = module.get(ExperienceClassificationService);
  });

  it('classifies themes/intents/traits substantiated by cited evidence', async () => {
    generateChatResponse.mockResolvedValueOnce(
      JSON.stringify({
        themes: ['history'],
        intents: ['visit'],
        traits: ['rooftop'],
        reasoningEvidence: [
          {
            facet: 'theme:history',
            evidenceKeys: ['ev-1'],
            reason: 'town hall now a history museum',
          },
          {
            facet: 'intent:visit',
            evidenceKeys: ['ev-1'],
            reason: 'a museum to visit',
          },
          {
            facet: 'trait:rooftop',
            evidenceKeys: ['ev-1'],
            reason: 'rooftop tango events mentioned',
          },
        ],
      }),
    );

    const result = await service.classify('Cabildo de Buenos Aires', EVIDENCE);

    expect(result.state).toBe('classified');
    expect(result.themes).toEqual(['history']);
    expect(result.intents).toEqual(['visit']);
    expect(result.traits).toEqual(['rooftop']);
    expect(result.reasoningEvidence).toEqual([
      {
        facet: 'theme:history',
        evidenceKeys: ['ev-1'],
        reason: 'town hall now a history museum',
      },
      {
        facet: 'intent:visit',
        evidenceKeys: ['ev-1'],
        reason: 'a museum to visit',
      },
      {
        facet: 'trait:rooftop',
        evidenceKeys: ['ev-1'],
        reason: 'rooftop tango events mentioned',
      },
    ]);
    expect(result.modelId).toBe('groq-classify-test');
    expect(result.promptVersion).toBe(CURRENT_CLASSIFICATION_PROMPT_VERSION);
  });

  it('drops a theme outside the canonical vocabulary even if cited', async () => {
    generateChatResponse.mockResolvedValueOnce(
      JSON.stringify({
        themes: ['not_a_real_theme'],
        intents: [],
        traits: [],
        reasoningEvidence: [
          {
            facet: 'theme:not_a_real_theme',
            evidenceKeys: ['ev-1'],
            reason: 'x',
          },
        ],
      }),
    );

    const result = await service.classify('X', EVIDENCE);

    expect(result.themes).toEqual([]);
    expect(result.reasoningEvidence).toEqual([]);
  });

  it('drops an accepted fact whose reasoningEvidence cites an unknown evidence key', async () => {
    generateChatResponse.mockResolvedValueOnce(
      JSON.stringify({
        themes: ['history'],
        intents: [],
        traits: [],
        reasoningEvidence: [
          {
            facet: 'theme:history',
            evidenceKeys: ['ev-does-not-exist'],
            reason: 'x',
          },
        ],
      }),
    );

    const result = await service.classify('X', EVIDENCE);

    expect(result.themes).toEqual([]);
    expect(result.reasoningEvidence).toEqual([]);
  });

  it('drops a theme/intent/trait with no corresponding reasoningEvidence entry at all', async () => {
    generateChatResponse.mockResolvedValueOnce(
      JSON.stringify({
        themes: ['history'],
        intents: [],
        traits: [],
        reasoningEvidence: [],
      }),
    );

    const result = await service.classify('X', EVIDENCE);

    expect(result.themes).toEqual([]);
  });

  it('rejects a sentence-shaped trait via the trait-shape guard, even if cited by evidence', async () => {
    generateChatResponse.mockResolvedValueOnce(
      JSON.stringify({
        themes: [],
        intents: [],
        traits: ['This is a full sentence about the venue.'],
        reasoningEvidence: [
          {
            facet: 'trait:this is a full sentence about the venue.',
            evidenceKeys: ['ev-1'],
            reason: 'x',
          },
        ],
      }),
    );

    const result = await service.classify('X', EVIDENCE);

    expect(result.traits).toEqual([]);
  });

  it('degrades to empty arrays without throwing when the LLM call fails', async () => {
    generateChatResponse.mockRejectedValueOnce(new Error('groq down'));

    const result = await service.classify('X', EVIDENCE);

    expect(result.state).toBe('degraded');
    expect(result.themes).toEqual([]);
    expect(result.intents).toEqual([]);
    expect(result.traits).toEqual([]);
    expect(result.reasoningEvidence).toEqual([]);
    expect(result.modelId).toBe('groq-classify-test');
    expect(result.promptVersion).toBe(CURRENT_CLASSIFICATION_PROMPT_VERSION);
  });

  it('degrades to empty arrays without throwing when the response is not valid JSON', async () => {
    generateChatResponse.mockResolvedValueOnce('not json');

    const result = await service.classify('X', EVIDENCE);

    expect(result.state).toBe('degraded');
    expect(result.themes).toEqual([]);
  });

  it('calls the shared Groq transport with providerOverride/modelOverride and json_object response format (retry/backoff reused from LangChainService)', async () => {
    generateChatResponse.mockResolvedValueOnce(
      JSON.stringify({
        themes: [],
        intents: [],
        traits: [],
        reasoningEvidence: [],
      }),
    );

    await service.classify('X', EVIDENCE);

    expect(generateChatResponse).toHaveBeenCalledTimes(1);
    const [, , , options] = generateChatResponse.mock.calls[0];
    expect(options).toEqual(
      expect.objectContaining({
        providerOverride: 'groq',
        modelOverride: 'groq-classify-test',
        responseFormat: { type: 'json_object' },
      }),
    );
  });

  it('skips the LLM call entirely and returns a valid empty classification when there is no evidence', async () => {
    const result = await service.classify('X', []);

    expect(generateChatResponse).not.toHaveBeenCalled();
    expect(result.state).toBe('classified');
    expect(result.themes).toEqual([]);
    expect(result.intents).toEqual([]);
    expect(result.traits).toEqual([]);
    expect(result.reasoningEvidence).toEqual([]);
  });

  it('never sends traveler preferences to the classifier -- classify() has no such parameter', () => {
    expect(service.classify.length).toBe(2); // (canonicalName, evidence) only
  });
});

describe('canReuseClassification', () => {
  it('is true only for a current, validly-shaped persisted classification', () => {
    const valid = {
      classification: {
        themes: ['history'],
        intents: [] as string[],
        traits: [] as string[],
        reasoningEvidence: [] as unknown[],
        modelId: 'groq-classify-test',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        state: 'classified',
      },
    };
    expect(
      canReuseClassification(valid, CURRENT_CLASSIFICATION_PROMPT_VERSION),
    ).toBe(true);
  });

  it('is false when metadata.classification is missing', () => {
    expect(
      canReuseClassification({}, CURRENT_CLASSIFICATION_PROMPT_VERSION),
    ).toBe(false);
  });

  it('is false when the prompt version is stale', () => {
    const stale = {
      classification: {
        themes: [] as string[],
        intents: [] as string[],
        traits: [] as string[],
        reasoningEvidence: [] as unknown[],
        modelId: 'm',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION - 1,
        state: 'classified',
      },
    };
    expect(
      canReuseClassification(stale, CURRENT_CLASSIFICATION_PROMPT_VERSION),
    ).toBe(false);
  });

  it('is false when the payload shape is malformed', () => {
    const malformed = {
      classification: {
        themes: 'not-an-array',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      },
    };
    expect(
      canReuseClassification(malformed, CURRENT_CLASSIFICATION_PROMPT_VERSION),
    ).toBe(false);
  });

  it('never reuses merely because an experienceId-shaped field is present with no real classification', () => {
    const noClassification = { experienceId: 'exp-123' };
    expect(
      canReuseClassification(
        noClassification,
        CURRENT_CLASSIFICATION_PROMPT_VERSION,
      ),
    ).toBe(false);
  });

  it('never throws on runtime-unknown metadata', () => {
    expect(() => canReuseClassification('bad' as any, 1)).not.toThrow();
    expect(canReuseClassification('bad' as any, 1)).toBe(false);
    expect(canReuseClassification(null, 1)).toBe(false);
    expect(canReuseClassification(undefined, 1)).toBe(false);
  });
});
