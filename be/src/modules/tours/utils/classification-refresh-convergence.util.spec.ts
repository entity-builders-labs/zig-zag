import {
  refreshClassificationFromPersistedEvidence,
  ClassificationRefreshDeps,
} from './classification-refresh-convergence.util';
import { CURRENT_CLASSIFICATION_PROMPT_VERSION } from '../services/experience-classification.service';

describe('refreshClassificationFromPersistedEvidence', () => {
  const experienceId = 'exp-123';

  function buildDeps(overrides: {
    experience?: {
      canonicalName: string;
      evidence: Array<{
        id: string;
        source: string;
        url?: string | null;
        title?: string | null;
        snippet?: string | null;
      }>;
    } | null;
    classifyImpl?: jest.Mock;
  }): ClassificationRefreshDeps {
    const experience = overrides.experience ?? null;
    const classifyImpl =
      overrides.classifyImpl ??
      jest.fn().mockResolvedValue({
        themes: ['history'],
        intents: ['walk'],
        traits: [],
        reasoningEvidence: [
          {
            facet: 'intent:walk',
            evidenceKeys: ['ev-1'],
            reason: 'evidence supports walking route',
          },
        ],
        modelId: 'groq/qwen',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        state: 'classified' as const,
      });
    return {
      catalog: {
        findVerifiedByIds: jest.fn().mockResolvedValue(
          experience ? [experience] : [],
        ),
        applyEvidenceClassification: jest.fn().mockResolvedValue(undefined),
      },
      classifier: {
        classify: classifyImpl,
        getAuditIdentity: jest
          .fn()
          .mockReturnValue({ provider: 'groq', model: 'qwen/qwen3.8-27b' }),
      },
    };
  }

  it('returns refreshed when classification succeeds', async () => {
    const deps = buildDeps({
      experience: {
        canonicalName: 'Caminito Walking Tour',
        evidence: [
          {
            id: 'ev-1',
            source: 'serper',
            snippet: 'Caminito is a colorful street museum in La Boca',
          },
        ],
      },
    });
    const result = await refreshClassificationFromPersistedEvidence(
      experienceId,
      deps,
    );
    expect(result.status).toBe('refreshed');
    if (result.status === 'refreshed') {
      expect(result.experienceId).toBe(experienceId);
      expect(result.classification.state).toBe('classified');
      expect(result.provider).toBe('groq');
      expect(result.model).toBe('qwen/qwen3.8-27b');
    }
    expect(deps.catalog.applyEvidenceClassification).toHaveBeenCalledWith(
      experienceId,
      expect.objectContaining({ state: 'classified' }),
    );
  });

  it('calls classify with reconstructed grounding evidence', async () => {
    const classifyImpl = jest.fn().mockResolvedValue({
      themes: ['history'],
      intents: ['walk'],
      traits: [],
      reasoningEvidence: [
        {
          facet: 'intent:walk',
          evidenceKeys: ['ev-1'],
          reason: 'evidence supports walking route',
        },
      ],
      modelId: 'groq/qwen',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      state: 'classified' as const,
    });
    const deps = buildDeps({
      experience: {
        canonicalName: 'Caminito Walking Tour',
        evidence: [
          {
            id: 'ev-1',
            source: 'serper',
            url: 'https://example.com',
            title: 'Caminito',
            snippet: 'Caminito is a colorful street museum in La Boca',
          },
        ],
      },
      classifyImpl,
    });
    await refreshClassificationFromPersistedEvidence(experienceId, deps);
    expect(classifyImpl).toHaveBeenCalledWith('Caminito Walking Tour', [
      {
        key: 'ev-1',
        source: 'serper',
        snippet: 'Caminito is a colorful street museum in La Boca',
        title: 'Caminito',
        url: 'https://example.com',
      },
    ]);
  });

  it('returns insufficient_evidence when experience has no persisted evidence', async () => {
    const deps = buildDeps({
      experience: {
        canonicalName: 'Caminito Walking Tour',
        evidence: [],
      },
    });
    const result = await refreshClassificationFromPersistedEvidence(
      experienceId,
      deps,
    );
    expect(result.status).toBe('insufficient_evidence');
    if (result.status === 'insufficient_evidence') {
      expect(result.experienceId).toBe(experienceId);
      expect(result.reason).toBe('NO_PERSISTED_EVIDENCE');
    }
    expect(deps.classifier.classify).not.toHaveBeenCalled();
    expect(deps.catalog.applyEvidenceClassification).not.toHaveBeenCalled();
  });

  it('returns insufficient_evidence when experience is not found', async () => {
    const deps = buildDeps({ experience: null });
    const result = await refreshClassificationFromPersistedEvidence(
      experienceId,
      deps,
    );
    expect(result.status).toBe('insufficient_evidence');
    if (result.status === 'insufficient_evidence') {
      expect(result.experienceId).toBe(experienceId);
      expect(result.reason).toBe('NO_PERSISTED_EVIDENCE');
    }
    expect(deps.classifier.classify).not.toHaveBeenCalled();
  });

  it('returns refresh_failed when classifier returns degraded', async () => {
    const deps = buildDeps({
      experience: {
        canonicalName: 'Caminito Walking Tour',
        evidence: [
          {
            id: 'ev-1',
            source: 'serper',
            snippet: 'Caminito is a colorful street museum in La Boca',
          },
        ],
      },
      classifyImpl: jest.fn().mockResolvedValue({
        themes: [],
        intents: [],
        traits: [],
        reasoningEvidence: [],
        modelId: 'groq/qwen',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        state: 'degraded' as const,
        failure: {
          stage: 'provider_call' as const,
          reason: 'PROVIDER_UNAVAILABLE' as const,
          httpStatus: 503,
          providerStatus: 'UNAVAILABLE',
        },
      }),
    });
    const result = await refreshClassificationFromPersistedEvidence(
      experienceId,
      deps,
    );
    expect(result.status).toBe('refresh_failed');
    if (result.status === 'refresh_failed') {
      expect(result.experienceId).toBe(experienceId);
      expect(result.classification.state).toBe('degraded');
      expect(result.failure?.reason).toBe('PROVIDER_UNAVAILABLE');
    }
    expect(deps.catalog.applyEvidenceClassification).not.toHaveBeenCalled();
  });

  it('filters out evidence rows with empty snippets', async () => {
    const classifyImpl = jest.fn().mockResolvedValue({
      themes: ['history'],
      intents: ['walk'],
      traits: [],
      reasoningEvidence: [
        {
          facet: 'intent:walk',
          evidenceKeys: ['ev-1'],
          reason: 'evidence supports walking route',
        },
      ],
      modelId: 'groq/qwen',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      state: 'classified' as const,
    });
    const deps = buildDeps({
      experience: {
        canonicalName: 'Caminito Walking Tour',
        evidence: [
          {
            id: 'ev-1',
            source: 'serper',
            snippet: 'Caminito is a colorful street museum in La Boca',
          },
          {
            id: 'ev-2',
            source: 'serper',
            snippet: '',
          },
        ],
      },
      classifyImpl,
    });
    await refreshClassificationFromPersistedEvidence(experienceId, deps);
    expect(classifyImpl).toHaveBeenCalledWith('Caminito Walking Tour', [
      {
        key: 'ev-1',
        source: 'serper',
        snippet: 'Caminito is a colorful street museum in La Boca',
      },
    ]);
  });
});
