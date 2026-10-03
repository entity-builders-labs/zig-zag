import { LocalityRecoveringDiscoveryExtractor } from './locality-recovering-discovery-extractor';

const evidence = [
  {
    key: 'ev-1',
    source: 'web',
    title: 'Guide',
    snippet:
      'Lunch at Café Lumen in Gion. Café Lumen – noon. Museo Azul – 2 pm.',
  },
];
const hint = (name: string, supportSpan: string) => ({
  key: name,
  name,
  sourceName: name,
  role: 'venue' as const,
  expectedKind: 'PLACE' as const,
  evidenceKeys: ['ev-1'],
  supportSpan,
});
const extraction = (extractionFailures: string[] = []) => ({
  provider: 'fake',
  model: 'fake-model',
  validationErrors: extractionFailures,
  extractionFailures,
  candidates:
    extractionFailures.length > 0
      ? []
      : [
          {
            name: 'Day',
            themes: [] as string[],
            traits: [] as string[],
            componentHints: [
              hint('Café Lumen', 'Café Lumen – noon.'),
              hint('Museo Azul', 'Museo Azul – 2 pm.'),
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'x',
          },
        ],
  sourceSupportAudits: [] as any[],
});

describe('LocalityRecoveringDiscoveryExtractor', () => {
  it('runs source locality recovery on the same provider after its extraction', async () => {
    const inner = {
      extractExperiences: jest.fn().mockResolvedValue(extraction()),
      completeStructured: jest.fn().mockImplementation(async ({ user }) => {
        const statement = user.match(
          / {2}(s\d+): "Lunch at Café Lumen in Gion\."/,
        )[1];
        return JSON.stringify({
          reports: [
            {
              component: 'c1',
              statement,
              place: 'Gion',
              relation: 'LOCATED_IN',
            },
          ],
        });
      }),
    };

    const result = await new LocalityRecoveringDiscoveryExtractor(
      inner,
    ).extractExperiences({} as any, { evidence } as any, { bypassCache: true });

    expect(inner.extractExperiences).toHaveBeenCalledWith(
      {},
      { evidence },
      { bypassCache: true },
    );
    expect(inner.completeStructured).toHaveBeenCalledTimes(1);
    expect(result.candidates[0].componentHints[0].localityAssertion).toEqual({
      locality: 'Gion',
      evidenceKey: 'ev-1',
      supportSpan: 'Lunch at Café Lumen in Gion.',
    });
    expect(result).toMatchObject({ provider: 'fake', model: 'fake-model' });
    expect(result.localityRecovery.status).toBe('COMPLETED');
  });

  it('makes no recovery call when the extraction itself failed', async () => {
    const inner = {
      extractExperiences: jest
        .fn()
        .mockResolvedValue(extraction(['Failed to parse JSON response'])),
      completeStructured: jest.fn(),
    };

    const result = await new LocalityRecoveringDiscoveryExtractor(
      inner,
    ).extractExperiences({} as any, { evidence } as any);

    expect(inner.completeStructured).not.toHaveBeenCalled();
    expect(result.localityRecovery).toBeUndefined();
  });
});
