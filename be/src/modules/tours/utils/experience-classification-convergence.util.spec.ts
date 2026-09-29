import {
  classifyAcceptedResultsByExperience,
  convergeExperienceClassification,
  classificationSemanticView,
} from './experience-classification-convergence.util';
import { CURRENT_CLASSIFICATION_PROMPT_VERSION } from '../services/experience-classification.service';
import { ResolvedExperienceCandidate } from '../interfaces/experience-resolution.interface';
import { ResolverEvidenceItem } from '../services/experience-acquisition.service';

function accepted(
  experienceId: string,
  evidenceKeys: string[],
): ResolvedExperienceCandidate & { experienceId: string } {
  return {
    candidate: {
      name: experienceId,
      themes: [] as string[],
      traits: [] as string[],
      componentHints: [],
      evidenceKeys,
      shortReason: 'test',
    },
    status: 'accepted',
    resolvedEntities: [],
    rejectionReasons: [],
    experienceId,
  } as any;
}

function rejected(): ResolvedExperienceCandidate {
  return {
    candidate: {
      name: 'rejected',
      themes: [] as string[],
      traits: [] as string[],
      componentHints: [],
      evidenceKeys: [],
      shortReason: 'test',
    },
    status: 'rejected',
    resolvedEntities: [],
    rejectionReasons: ['no_match'],
  } as any;
}

function evidenceItem(
  key: string,
  snippet: string | undefined = 'real evidence text',
): ResolverEvidenceItem {
  return { key, source: 'test', snippet };
}

function validClassificationMetadata(
  intents: string[] = ['walk'],
  themes: string[] = [],
  traits: string[] = [],
) {
  return {
    intents,
    classification: {
      state: 'classified' as const,
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes,
      intents,
      traits,
      reasoningEvidence: intents.map((intent) => ({
        facet: `intent:${intent}`,
        evidenceKeys: ['ev-existing'],
        reason: 'already substantiated',
      })),
    },
  };
}

function buildDeps() {
  const catalog = {
    findVerifiedByIds: jest.fn(),
    applyEvidenceClassification: jest.fn().mockResolvedValue(undefined),
    findClassificationContextById: jest.fn(),
  };
  const classifier = {
    classify: jest.fn(),
    getAuditIdentity: jest.fn().mockReturnValue({
      provider: 'groq',
      model: 'qwen',
    }),
  };
  return { catalog, classifier };
}

describe('classifyAcceptedResultsByExperience', () => {
  it('classifies exactly once per canonical experienceId, using the deduplicated union of evidenceKeys from every candidate that converged to it', async () => {
    const { catalog, classifier } = buildDeps();
    catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-1', canonicalName: 'Teatro Colón', metadata: {} },
    ]);
    classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['visit'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:visit', evidenceKeys: ['a1'], reason: 'evidence' },
      ],
    });

    const resolved = [
      accepted('exp-1', ['a1']),
      accepted('exp-1', ['b1']),
      rejected(),
    ];
    const evidence = [
      evidenceItem('a1'),
      evidenceItem('b1'),
      evidenceItem('c1'),
    ];

    const audit = await classifyAcceptedResultsByExperience(
      resolved,
      evidence,
      {
        catalog: catalog as any,
        classifier: classifier as any,
      },
    );

    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect(classifier.classify).toHaveBeenCalledWith('Teatro Colón', [
      evidenceItem('a1'),
      evidenceItem('b1'),
    ]);
    expect(catalog.applyEvidenceClassification).toHaveBeenCalledTimes(1);
    expect(catalog.applyEvidenceClassification).toHaveBeenCalledWith(
      'exp-1',
      expect.objectContaining({ intents: ['visit'] }),
    );
    expect(audit[0]).toMatchObject({
      state: 'classified',
      provider: 'groq',
      model: 'qwen',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      intents: ['visit'],
      reasoningEvidence: [{ facet: 'intent:visit' }],
    });
  });

  it('never crosses evidence between two distinct canonical experienceIds', async () => {
    const { catalog, classifier } = buildDeps();
    catalog.findVerifiedByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, canonicalName: id, metadata: {} })),
    );
    classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: [],
      traits: [],
      reasoningEvidence: [],
    });

    const resolved = [accepted('exp-1', ['a1']), accepted('exp-2', ['b1'])];
    const evidence = [evidenceItem('a1'), evidenceItem('b1')];

    await classifyAcceptedResultsByExperience(resolved, evidence, {
      catalog: catalog as any,
      classifier: classifier as any,
    });

    expect(classifier.classify).toHaveBeenCalledTimes(2);
    expect(classifier.classify).toHaveBeenCalledWith('exp-1', [
      evidenceItem('a1'),
    ]);
    expect(classifier.classify).toHaveBeenCalledWith('exp-2', [
      evidenceItem('b1'),
    ]);
  });

  it('reuses a valid current classification -- never recomputes it', async () => {
    const { catalog, classifier } = buildDeps();
    catalog.findVerifiedByIds.mockResolvedValue([
      {
        id: 'exp-1',
        canonicalName: 'Teatro Colón',
        metadata: {
          classification: {
            ...validClassificationMetadata(['walk'], ['history'], ['guided'])
              .classification,
            reasoningEvidence: [
              {
                facet: 'theme:history',
                evidenceKeys: ['ev-existing'],
                reason: 'history',
              },
              {
                facet: 'intent:walk',
                evidenceKeys: ['ev-existing'],
                reason: 'walk',
              },
              {
                facet: 'trait:guided',
                evidenceKeys: ['ev-existing'],
                reason: 'guided',
              },
            ],
          },
        },
      },
    ]);

    const audit = await classifyAcceptedResultsByExperience(
      [accepted('exp-1', ['a1'])],
      [evidenceItem('a1')],
      { catalog: catalog as any, classifier: classifier as any },
    );

    expect(classifier.classify).not.toHaveBeenCalled();
    expect(catalog.applyEvidenceClassification).not.toHaveBeenCalled();
    expect(audit[0]).toMatchObject({
      state: 'reused',
      themes: ['history'],
      intents: ['walk'],
      traits: ['guided'],
      reasoningEvidence: expect.arrayContaining([
        expect.objectContaining({ facet: 'theme:history' }),
        expect.objectContaining({ facet: 'intent:walk' }),
        expect.objectContaining({ facet: 'trait:guided' }),
      ]),
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      model: 'groq/qwen',
    });
  });

  it('recomputes when the current classification is stale (old prompt version)', async () => {
    const { catalog, classifier } = buildDeps();
    catalog.findVerifiedByIds.mockResolvedValue([
      {
        id: 'exp-1',
        canonicalName: 'Teatro Colón',
        metadata: {
          intents: ['visit'],
          classification: {
            ...validClassificationMetadata(['visit']).classification,
            promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION - 1,
          },
        },
      },
    ]);
    classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['visit'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:visit', evidenceKeys: ['a1'], reason: 'evidence' },
      ],
    });

    await classifyAcceptedResultsByExperience(
      [accepted('exp-1', ['a1'])],
      [evidenceItem('a1')],
      { catalog: catalog as any, classifier: classifier as any },
    );

    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect(catalog.applyEvidenceClassification).toHaveBeenCalledTimes(1);
  });

  it('recomputes when there is no classification metadata at all yet', async () => {
    const { catalog, classifier } = buildDeps();
    catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-1', canonicalName: 'Teatro Colón', metadata: {} },
    ]);
    classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: [],
      traits: [],
      reasoningEvidence: [],
    });

    await classifyAcceptedResultsByExperience(
      [accepted('exp-1', ['a1'])],
      [evidenceItem('a1')],
      { catalog: catalog as any, classifier: classifier as any },
    );

    expect(classifier.classify).toHaveBeenCalledTimes(1);
  });

  it('drops evidence items with no snippet text before classifying -- never fabricates evidence to fill the gap', async () => {
    const { catalog, classifier } = buildDeps();
    catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-1', canonicalName: 'Teatro Colón', metadata: {} },
    ]);
    classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: [],
      traits: [],
      reasoningEvidence: [],
    });

    const noSnippetItem: ResolverEvidenceItem = { key: 'a1', source: 'test' };

    await classifyAcceptedResultsByExperience(
      [accepted('exp-1', ['a1', 'b1'])],
      [noSnippetItem, evidenceItem('b1', 'real snippet')],
      { catalog: catalog as any, classifier: classifier as any },
    );

    expect(classifier.classify).toHaveBeenCalledWith('Teatro Colón', [
      evidenceItem('b1', 'real snippet'),
    ]);
  });

  it('does nothing when there are no accepted results', async () => {
    const { catalog, classifier } = buildDeps();

    await classifyAcceptedResultsByExperience([rejected()], [], {
      catalog: catalog as any,
      classifier: classifier as any,
    });

    expect(catalog.findVerifiedByIds).not.toHaveBeenCalled();
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('skips an accepted result whose experienceId no longer resolves to a real VERIFIED row', async () => {
    const { catalog, classifier } = buildDeps();
    catalog.findVerifiedByIds.mockResolvedValue([]);

    await classifyAcceptedResultsByExperience(
      [accepted('exp-gone', ['a1'])],
      [evidenceItem('a1')],
      { catalog: catalog as any, classifier: classifier as any },
    );

    expect(classifier.classify).not.toHaveBeenCalled();
  });
});

describe('convergeExperienceClassification', () => {
  it('returns reused when canReuseClassification is true', async () => {
    const { catalog, classifier } = buildDeps();
    catalog.findVerifiedByIds.mockResolvedValue([
      {
        id: 'exp-1',
        canonicalName: 'Test',
        metadata: validClassificationMetadata(['walk']),
      },
    ]);

    const result = await convergeExperienceClassification('exp-1', [], {
      catalog: catalog as any,
      classifier: classifier as any,
    });

    expect(result.state).toBe('reused');
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(catalog.applyEvidenceClassification).not.toHaveBeenCalled();
  });

  it('classifies and persists when classification is not reusable', async () => {
    const { catalog, classifier } = buildDeps();
    catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-1', canonicalName: 'Test', metadata: {} },
    ]);
    classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['walk'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:walk', evidenceKeys: ['ev-1'], reason: 'evidence' },
      ],
    });

    const result = await convergeExperienceClassification(
      'exp-1',
      [evidenceItem('ev-1') as any],
      { catalog: catalog as any, classifier: classifier as any },
    );

    expect(result.state).toBe('classified');
    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect(catalog.applyEvidenceClassification).toHaveBeenCalledTimes(1);
    expect(catalog.applyEvidenceClassification).toHaveBeenCalledWith(
      'exp-1',
      expect.objectContaining({ state: 'classified', intents: ['walk'] }),
    );
  });

  it('persists degraded classification through the same path', async () => {
    const { catalog, classifier } = buildDeps();
    catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-1', canonicalName: 'Test', metadata: {} },
    ]);
    classifier.classify.mockResolvedValue({
      state: 'degraded',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: [],
      traits: [],
      reasoningEvidence: [],
      failure: {
        stage: 'provider_call',
        reason: 'PROVIDER_UNAVAILABLE',
        httpStatus: 503,
      },
    });

    const result = await convergeExperienceClassification(
      'exp-1',
      [evidenceItem('ev-1') as any],
      { catalog: catalog as any, classifier: classifier as any },
    );

    expect(result.state).toBe('degraded');
    expect(result.failure?.reason).toBe('PROVIDER_UNAVAILABLE');
    expect(catalog.applyEvidenceClassification).toHaveBeenCalledTimes(1);
    expect(catalog.applyEvidenceClassification).toHaveBeenCalledWith(
      'exp-1',
      expect.objectContaining({ state: 'degraded' }),
    );
  });

  it('returns degraded when experience is not found', async () => {
    const { catalog, classifier } = buildDeps();
    catalog.findVerifiedByIds.mockResolvedValue([]);

    const result = await convergeExperienceClassification('exp-missing', [], {
      catalog: catalog as any,
      classifier: classifier as any,
    });

    expect(result.state).toBe('degraded');
    expect(classifier.classify).not.toHaveBeenCalled();
  });
});

describe('classificationSemanticView', () => {
  it('projects only classifier-owned semantics into top-level and metadata', () => {
    const view = classificationSemanticView({
      themes: ['culture', 'history'],
      intents: ['walk'],
      traits: ['outdoor'],
    });

    expect(view).toEqual({
      themes: ['culture', 'history'],
      intents: ['walk'],
      traits: ['outdoor'],
      metadata: {
        themes: ['culture', 'history'],
        intents: ['walk'],
        traits: ['outdoor'],
      },
    });
    // Ensure no legacy fields exist
    expect((view.metadata as any).archetypes).toBeUndefined();
  });

  it('preserves an explicit empty classification', () => {
    const view = classificationSemanticView({
      themes: [],
      intents: [],
      traits: [],
    });

    expect(view).toEqual({
      themes: [],
      intents: [],
      traits: [],
      metadata: {
        themes: [],
        intents: [],
        traits: [],
      },
    });
  });
});
