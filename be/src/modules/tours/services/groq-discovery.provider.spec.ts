import { Test, TestingModule } from '@nestjs/testing';
import { LangChainService } from '@shared/ai/langchain.service';
import aiConfig from '@shared/ai/ai.config';
import {
  buildDiscoveryAnchorContext,
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
} from '../prompts/experience-discovery-extraction.prompt';
import {
  INITIAL_DIMENSION_VOCABULARY,
  PREFERENCE_DIMENSIONS,
} from '../preferences/preference-facet-vocabulary';
import { GroqDiscoveryProvider } from './groq-discovery.provider';

const CANONICAL_THEMES =
  INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.THEME];
const CANONICAL_INTENTS =
  INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.INTENT];

describe('GroqDiscoveryProvider — controlled facet contract', () => {
  let provider: GroqDiscoveryProvider;
  let generateChatResponse: jest.Mock;

  beforeEach(async () => {
    generateChatResponse = jest.fn().mockResolvedValue('{"candidates":[]}');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroqDiscoveryProvider,
        { provide: LangChainService, useValue: { generateChatResponse } },
        {
          provide: aiConfig.KEY,
          useValue: {
            discoveryExtractor: { groq: { model: 'groq-test' } },
          },
        },
      ],
    }).compile();
    provider = module.get(GroqDiscoveryProvider);
  });

  async function capturePrompt(): Promise<string> {
    await provider.extractExperiences(
      {
        scope: { destinationName: 'Buenos Aires' },
        requestedThemes: ['history'],
        breadth: 'focused',
        maxCandidates: 8,
      } as any,
      {
        evidence: [
          { key: 'ev-1', title: 'T', source: 'S', snippet: 'snippet' },
        ],
      } as any,
    );
    return generateChatResponse.mock.calls[0][1] as string;
  }

  it('carries the canonical theme and intent vocabularies, derived centrally, into the prompt', async () => {
    const prompt = await capturePrompt();
    expect(prompt).toContain(CANONICAL_THEMES.join(', '));
    expect(prompt).toContain(CANONICAL_INTENTS.join(', '));
  });

  it('tells the model traits is the open-ended dimension for long-tail concepts', async () => {
    const prompt = await capturePrompt();
    expect(prompt).toMatch(/traits is the open-ended dimension/i);
    expect(prompt).toMatch(/craft beer/i);
    expect(prompt).toMatch(
      /never put a canonical theme or canonical intent inside traits/i,
    );
  });

  it('keeps traits strictly separate but allows the same key in both themes and intents', async () => {
    const prompt = await capturePrompt();
    expect(prompt).not.toMatch(/same concept in more than one/i);
    expect(prompt).toMatch(
      /themes and intents are separate, independent controlled dimensions/i,
    );
    expect(prompt).toMatch(
      /same canonical key MAY appear in both themes and intents/i,
    );
    expect(prompt).toMatch(/do not deduplicate across themes and intents/i);
  });

  it('carries the shared generic-pseudo-entity prohibition into the prompt', async () => {
    const prompt = await capturePrompt();
    expect(prompt).toMatch(/generic pseudo-entity/i);
    expect(prompt).toMatch(/Specialty Coffee Shop/);
  });

  it('sends exactly the shared system + user prompt, with no provider-specific fork (RW4 composition contract)', async () => {
    const prompt = await capturePrompt();
    expect(generateChatResponse.mock.calls[0][0]).toBe(
      buildDiscoverySystemPrompt(),
    );
    expect(prompt).toBe(
      buildDiscoveryUserPrompt(
        {
          scope: { destinationName: 'Buenos Aires' },
          requestedThemes: ['history'],
          breadth: 'focused',
          maxCandidates: 8,
        } as any,
        [{ key: 'ev-1', title: 'T', source: 'S', snippet: 'snippet' }],
      ),
    );
    expect(prompt).toMatch(
      /never merge components from different variants into one candidate/i,
    );
  });

  it('sends the shared anchor-as-relevance-context contract unchanged (RW4 live-6)', async () => {
    const request = {
      scope: { destinationName: 'Mendoza' },
      requestedThemes: ['wine'],
      requestedIntents: ['route_like'],
      anchorNames: ['Ruta del Vino de Mendoza'],
      breadth: 'focused',
      maxCandidates: 8,
    } as any;
    const evidence = [{ key: 'ev-1', title: 'T', source: 'S', snippet: 's' }];
    await provider.extractExperiences(request, { evidence } as any);
    const prompt = generateChatResponse.mock.calls[0][1] as string;
    expect(prompt).toBe(buildDiscoveryUserPrompt(request, evidence));
    expect(prompt).toContain(
      buildDiscoveryAnchorContext(request.anchorNames).join('\n'),
    );
    expect(prompt).toMatch(/Do not require literal anchor-name occurrence/);
  });

  it('forces the Groq transport and the Groq discovery model, independent of AI_PROVIDER', async () => {
    await provider.extractExperiences(
      {
        scope: { destinationName: 'Buenos Aires' },
        requestedThemes: ['history'],
        breadth: 'focused',
        maxCandidates: 8,
      } as any,
      {
        evidence: [{ key: 'ev-1', title: 'T', source: 'S', snippet: 's' }],
      } as any,
      { bypassCache: true },
    );
    const opts = generateChatResponse.mock.calls[0][3];
    expect(opts).toMatchObject({
      providerOverride: 'groq',
      modelOverride: 'groq-test',
      bypassCache: true,
      responseFormat: { type: 'json_object' },
    });
  });
});
