import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { ExperienceProposalResolverService } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { CompositeGeographicValidationService } from 'src/modules/tours/services/composite-geographic-validation.service';
import { ExperienceCandidate } from 'src/modules/tours/interfaces/experience-discovery.interface';
import { getPrisma, resetDb, closeDb } from '../support/test-db';

/**
 * Experience Identity / Dedupe — real Postgres integration gate, required
 * before Task B6 (per
 * docs/superpowers/plans/2026-09-12-experience-identity-postgres-integration-gate.md
 * and docs/superpowers/specs/2026-09-12-experience-identity-dedupe-and-diversity-design.md).
 *
 * Exercises the real persistence/dedupe path
 * (`ExperienceCatalogService.persistVerifiedExperience` →
 * `decideExperienceDedupe`) against real Postgres, not just the pure
 * scoring primitive's own unit tests. External OSM/Places transports are
 * mocked only where the resolver boundary itself is exercised (Case 3b);
 * every other case seeds resolved `GeoEntity` rows directly through the
 * real catalog boundary.
 */

describe('tour-generation integration · experience identity / dedupe gate (pre-B6)', () => {
  let catalog: ExperienceCatalogService;
  let geo: Record<string, { id: string }>;

  beforeAll(async () => {
    const prisma = await getPrisma();
    catalog = new ExperienceCatalogService(prisma, {
      getStatus: () => ({ provider: 'none' }),
    } as any);
  });

  beforeEach(async () => {
    await resetDb();
    geo = await seedSanTelmoFixtures();
  });

  afterAll(async () => {
    await closeDb();
  });

  /**
   * Real GeoEntities, seeded through the real `upsertGeoEntity` boundary
   * (not a raw `prisma.geoEntity.create`) so each carries a real
   * `(provider, externalId)` identity a mocked OSM response can later
   * reconcile onto (Case 3b). Stable, deterministic, geographically
   * coherent coordinates -- these tests are about canonical Experience
   * identity, not provider lookup.
   */
  async function seedSanTelmoFixtures(): Promise<
    Record<string, { id: string }>
  > {
    const fixtures: Array<{ name: string; lat: number; lon: number }> = [
      { name: 'Plaza Dorrego', lat: -34.6212, lon: -58.3731 },
      { name: 'Mercado de San Telmo', lat: -34.6208, lon: -58.3725 },
      { name: 'Pasaje Defensa', lat: -34.6203, lon: -58.372 },
      { name: 'El Zanjón de Granados', lat: -34.6199, lon: -58.3722 },
      { name: 'Parque Lezama', lat: -34.6265, lon: -58.3696 },
      { name: 'Casa Mínima', lat: -34.6209, lon: -58.3703 },
      { name: 'Conventillo Museum', lat: -34.6215, lon: -58.371 },
      { name: 'San Telmo Architecture Fixture', lat: -34.622, lon: -58.3715 },
    ];
    const result: Record<string, { id: string }> = {};
    for (const [index, fixture] of fixtures.entries()) {
      result[fixture.name] = await catalog.upsertGeoEntity({
        name: fixture.name,
        kind: 'PLACE' as any,
        provider: 'osm',
        externalId: `osm:node:${index + 1}`,
        latitude: fixture.lat,
        longitude: fixture.lon,
      });
    }
    return result;
  }

  function componentsOf(
    names: string[],
    role = 'venue',
  ): Array<{
    geoEntityId: string;
    role: string;
    required: boolean;
    order: number | null;
  }> {
    return names.map((name) => ({
      geoEntityId: geo[name].id,
      role,
      required: true,
      order: null as number | null,
    }));
  }

  describe('Case 1 — SAME converges to one canonical Experience', () => {
    const OBSERVATION_A_COMPONENTS = [
      'Plaza Dorrego',
      'Mercado de San Telmo',
      'Pasaje Defensa',
      'El Zanjón de Granados',
    ];

    it('a second, differently-worded source describing the SAME real components enriches the same canonical Experience (SAME)', async () => {
      const prisma = await getPrisma();
      const a = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walking Tour',
        description:
          'A historical walking tour through the heart of San Telmo, visiting Plaza Dorrego, the historic Mercado de San Telmo, and Pasaje Defensa.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf(OBSERVATION_A_COMPONENTS),
        evidence: [{ source: 'source-A' }],
      });
      expect((a as any).dedupeDecision).toBe('NEW');

      const b = await catalog.persistVerifiedExperience({
        canonicalName: 'Historical Walk through San Telmo',
        description:
          'This historical walk covers Plaza Dorrego, the Mercado de San Telmo market, and the colonial Pasaje Defensa passage.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf(OBSERVATION_A_COMPONENTS),
        evidence: [{ source: 'source-B' }],
      });

      expect((b as any).dedupeDecision).toBe('SAME');
      expect(b.id).toBe(a.id);

      const count = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      expect(count).toBe(1);

      const persisted = await prisma.experience.findUnique({
        where: { id: a.id },
        include: { components: true, evidence: true },
      });
      const sources = persisted!.evidence.map((e) => e.source).sort();
      expect(sources).toEqual(['source-A', 'source-B']);
      expect(persisted!.components).toHaveLength(4);
      const componentIds = new Set(
        persisted!.components.map((c) => c.geoEntityId),
      );
      expect(componentIds.size).toBe(4);
    });

    it('Case 1b — repeated observation of the same source is idempotent', async () => {
      const prisma = await getPrisma();
      const a = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walking Tour',
        description: 'A historical walking tour through San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf(OBSERVATION_A_COMPONENTS),
        evidence: [{ source: 'source-A' }],
      });
      const b1 = await catalog.persistVerifiedExperience({
        canonicalName: 'Historical Walk through San Telmo',
        description:
          'This historical walk covers the same real stops in San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf(OBSERVATION_A_COMPONENTS),
        evidence: [{ source: 'source-B' }],
      });
      expect((b1 as any).dedupeDecision).toBe('SAME');

      // Persist the EXACT same observation B again.
      const b2 = await catalog.persistVerifiedExperience({
        canonicalName: 'Historical Walk through San Telmo',
        description:
          'This historical walk covers the same real stops in San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf(OBSERVATION_A_COMPONENTS),
        evidence: [{ source: 'source-B' }],
      });
      expect((b2 as any).dedupeDecision).toBe('SAME');
      expect(b2.id).toBe(a.id);

      const count = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      expect(count).toBe(1);
      const persisted = await prisma.experience.findUnique({
        where: { id: a.id },
        include: { components: true, evidence: true },
      });
      // Evidence from source-B is not duplicated by the repeated identical
      // observation.
      const sourceBCount = persisted!.evidence.filter(
        (e) => e.source === 'source-B',
      ).length;
      expect(sourceBCount).toBe(1);
      expect(persisted!.components).toHaveLength(4);
    });

    it('Case 1c — reversed observation order still converges to one canonical identity', async () => {
      const prisma = await getPrisma();
      // B first this time.
      const b = await catalog.persistVerifiedExperience({
        canonicalName: 'Historical Walk through San Telmo',
        description:
          'This historical walk covers the same real stops in San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf(OBSERVATION_A_COMPONENTS),
        evidence: [{ source: 'source-B' }],
      });
      expect((b as any).dedupeDecision).toBe('NEW');

      const a = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walking Tour',
        description: 'A historical walking tour through San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf(OBSERVATION_A_COMPONENTS),
        evidence: [{ source: 'source-A' }],
      });
      expect((a as any).dedupeDecision).toBe('SAME');
      expect(a.id).toBe(b.id);

      const count = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      expect(count).toBe(1);
      const persisted = await prisma.experience.findUnique({
        where: { id: b.id },
        include: { evidence: true },
      });
      const sources = persisted!.evidence.map((e) => e.source).sort();
      expect(sources).toEqual(['source-A', 'source-B']);
    });
  });

  describe('Review fix — a perfect component/role match is a strong signal, never unilateral identity authority', () => {
    it('EXACT COMPONENT SET, CONFLICTING IDENTITY: the same real stops/roles under a clearly different tourism concept/name/evidence must NOT become SAME', async () => {
      const prisma = await getPrisma();
      const historical = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walking Tour',
        description:
          'A historical walking tour through the heart of San Telmo, visiting Plaza Dorrego, the historic Mercado de San Telmo, and Pasaje Defensa.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'El Zanjón de Granados',
        ]),
        evidence: [{ source: 'history-guide' }],
      });
      expect((historical as any).dedupeDecision).toBe('NEW');
      const beforeMetadata = (
        await prisma.experience.findUnique({ where: { id: historical.id } })
      )?.metadata;

      // A genuinely different, evidence-backed tourism concept -- a craft
      // beer and empanada crawl -- happens to stop at the EXACT same 4
      // real places, in the same roles. Zero name/title overlap with the
      // historical walk (a real, principled "explicit conflict" signal:
      // no shared vocabulary at all, not merely a low similarity score).
      const beerCrawl = await catalog.persistVerifiedExperience({
        canonicalName: 'Craft Beer and Empanada Crawl',
        description:
          'A crawl through local breweries and empanada spots along Plaza Dorrego, Mercado de San Telmo, Pasaje Defensa, and El Zanjón de Granados.',
        metadata: { themes: ['food'], intents: ['food'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'El Zanjón de Granados',
        ]),
        evidence: [{ source: 'food-guide' }],
      });

      expect((beerCrawl as any).dedupeDecision).not.toBe('SAME');

      const count = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      if ((beerCrawl as any).dedupeDecision === 'AMBIGUOUS') {
        // No mutation of the existing canonical row from the ambiguous
        // observation.
        expect(count).toBe(1);
        const persisted = await prisma.experience.findUnique({
          where: { id: historical.id },
          include: { evidence: true },
        });
        expect(persisted!.evidence.map((e) => e.source)).toEqual([
          'history-guide',
        ]);
        expect(persisted!.metadata).toEqual(beforeMetadata);
      } else {
        // NEW would also be an acceptable outcome per the gate plan, as
        // long as it is a genuinely separate, unmutated canonical row.
        expect(count).toBe(2);
        expect((beerCrawl as any).id).not.toBe(historical.id);
      }
    });

    it('EXACT COMPONENT SET, CONFLICTING EVIDENCED ORDER: the same names/roles/components in explicitly reversed sequences must NOT become SAME', async () => {
      const prisma = await getPrisma();
      const stops = [
        'Plaza Dorrego',
        'Mercado de San Telmo',
        'Pasaje Defensa',
        'El Zanjón de Granados',
      ];
      const forward = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walk',
        description:
          'A historical walk through San Telmo, visited in this exact order.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: stops.map((name, index) => ({
          geoEntityId: geo[name].id,
          role: 'venue',
          required: true,
          order: index + 1,
        })),
        evidence: [{ source: 'forward-guide' }],
      });
      expect((forward as any).dedupeDecision).toBe('NEW');
      const beforeMetadata = (
        await prisma.experience.findUnique({ where: { id: forward.id } })
      )?.metadata;

      // Same real stops, same roles, SAME canonicalName even -- but an
      // explicitly evidenced REVERSE visiting sequence. Name/semantic
      // similarity alone would otherwise force SAME; the order conflict
      // must independently veto it.
      const reversed = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walk',
        description:
          'A historical walk through San Telmo, visited in this exact order.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: [...stops].reverse().map((name, index) => ({
          geoEntityId: geo[name].id,
          role: 'venue',
          required: true,
          order: index + 1,
        })),
        evidence: [{ source: 'reverse-guide' }],
      });

      expect((reversed as any).dedupeDecision).not.toBe('SAME');

      const count = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      if ((reversed as any).dedupeDecision === 'AMBIGUOUS') {
        expect(count).toBe(1);
        const persisted = await prisma.experience.findUnique({
          where: { id: forward.id },
          include: { evidence: true },
        });
        expect(persisted!.evidence.map((e) => e.source)).toEqual([
          'forward-guide',
        ]);
        expect(persisted!.metadata).toEqual(beforeMetadata);
      } else {
        expect(count).toBe(2);
        expect((reversed as any).id).not.toBe(forward.id);
      }
    });

    it('EXACT COMPONENT SET, SHARED GENERIC LOCATION/TYPE WORDS ONLY: names that overlap merely because they share a place name and a generic type word must NOT become SAME', async () => {
      const prisma = await getPrisma();
      const stops = [
        'Plaza Dorrego',
        'Mercado de San Telmo',
        'Pasaje Defensa',
        'El Zanjón de Granados',
      ];

      // "San Telmo Historical Walk" vs "San Telmo Food Walk" share "san",
      // "telmo", and "walk" -- purely because both are walks located in
      // San Telmo, not because they describe the same tourism concept.
      // nameSimilarity is therefore > 0 (a real, non-zero token overlap),
      // which the OLD `exactStructure` rule treated as sufficient
      // compatibility evidence on its own. It is not: two independently
      // evidenced Experiences over the exact same real stops/roles, with
      // genuinely different themes/intents (historical vs. food), must
      // not collapse into one.
      const historical = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walk',
        description:
          'A historical walking tour through the heart of San Telmo, visiting Plaza Dorrego, the historic Mercado de San Telmo, and Pasaje Defensa.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf(stops),
        evidence: [{ source: 'history-guide-2' }],
      });
      expect((historical as any).dedupeDecision).toBe('NEW');
      const beforeMetadata = (
        await prisma.experience.findUnique({ where: { id: historical.id } })
      )?.metadata;

      const food = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Food Walk',
        description:
          'A gastronomic walk through San Telmo sampling empanadas and local fare near Plaza Dorrego, Mercado de San Telmo, and Pasaje Defensa.',
        metadata: { themes: ['food'], intents: ['food'] },
        components: componentsOf(stops),
        evidence: [{ source: 'food-guide-2' }],
      });

      expect((food as any).dedupeDecision).not.toBe('SAME');

      const count = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      if ((food as any).dedupeDecision === 'AMBIGUOUS') {
        expect(count).toBe(1);
        const persisted = await prisma.experience.findUnique({
          where: { id: historical.id },
          include: { evidence: true },
        });
        expect(persisted!.evidence.map((e) => e.source)).toEqual([
          'history-guide-2',
        ]);
        expect(persisted!.metadata).toEqual(beforeMetadata);
      } else {
        expect(count).toBe(2);
        expect((food as any).id).not.toBe(historical.id);
      }
    });
  });

  describe('Case 2 — NEW preserves multiple real Experiences with the same facets', () => {
    it('two distinct evidence-backed San Telmo walks sharing theme+intent+area survive as separate canonical Experiences', async () => {
      const prisma = await getPrisma();
      // Walk A and Walk B intentionally share ONE real component
      // (Mercado) -- enough overlap to be realistic, not so much that it
      // erases the "enough independent identity evidence" the plan
      // requires for a safe NEW assertion (Case 2b covers the
      // higher-overlap, AMBIGUOUS-acceptable scenario separately).
      const walkA = await catalog.persistVerifiedExperience({
        canonicalName: 'Colonial Architecture Walk',
        description:
          'A walk focused on colonial-era architecture: Plaza Dorrego, Pasaje Defensa, El Zanjón de Granados, and the Mercado de San Telmo market building.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Pasaje Defensa',
          'El Zanjón de Granados',
          'Mercado de San Telmo',
        ]),
        evidence: [{ source: 'colonial-guide' }],
      });
      expect((walkA as any).dedupeDecision).toBe('NEW');

      const walkB = await catalog.persistVerifiedExperience({
        canonicalName: 'Immigration History Walk',
        description:
          'A walk tracing 19th-century immigrant life: the Conventillo Museum, Casa Mínima, Parque Lezama, and a stop at the Mercado de San Telmo market.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Conventillo Museum',
          'Casa Mínima',
          'Parque Lezama',
          'Mercado de San Telmo',
        ]),
        evidence: [{ source: 'immigration-guide' }],
      });
      expect((walkB as any).dedupeDecision).toBe('NEW');
      expect(walkB.id).not.toBe(walkA.id);

      const count = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      expect(count).toBe(2);

      const persistedA = await prisma.experience.findUnique({
        where: { id: walkA.id },
        include: { components: true },
      });
      const persistedB = await prisma.experience.findUnique({
        where: { id: walkB.id },
        include: { components: true },
      });
      expect(persistedA!.components).toHaveLength(4);
      expect(persistedB!.components).toHaveLength(4);
    });

    it('Case 2b — a near-identical title alone does not force SAME for a structurally distinct Experience (NEW or AMBIGUOUS, never SAME)', async () => {
      const walkA = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walk',
        description: 'A historical walk through San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'El Zanjón de Granados',
        ]),
        evidence: [{ source: 'guide-1' }],
      });
      expect((walkA as any).dedupeDecision).toBe('NEW');

      // Same title wording, but a genuinely different, evidence-backed
      // structural composition (only Mercado overlaps).
      const walkB = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walk',
        description:
          'A completely different historical route through San Telmo, tracing the Conventillo Museum, Casa Mínima, and Parque Lezama.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Conventillo Museum',
          'Casa Mínima',
          'Parque Lezama',
          'Mercado de San Telmo',
        ]),
        evidence: [{ source: 'guide-2' }],
      });

      expect((walkB as any).dedupeDecision).not.toBe('SAME');
    });
  });

  describe('Case 3 — AMBIGUOUS does not corrupt the catalog', () => {
    it('strong-but-inconclusive overlap returns AMBIGUOUS, mutates nothing, and creates no new row', async () => {
      const prisma = await getPrisma();
      const walkA = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walk',
        description: 'A historical walk through San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'El Zanjón de Granados',
        ]),
        evidence: [{ source: 'guide-1' }],
      });
      expect((walkA as any).dedupeDecision).toBe('NEW');

      const beforeMetadata = (
        await prisma.experience.findUnique({ where: { id: walkA.id } })
      )?.metadata;

      // 3 of 4 components overlap (only Parque Lezama differs from El
      // Zanjón de Granados) -- substantial but not proven identity.
      const incoming = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Walk',
        description: 'A walk through San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'Parque Lezama',
        ]),
        evidence: [{ source: 'guide-3' }],
      });

      expect((incoming as any).dedupeDecision).toBe('AMBIGUOUS');
      expect((incoming as any).dedupeCandidates).toContain(walkA.id);

      const count = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      expect(count).toBe(1);
      const persistedA = await prisma.experience.findUnique({
        where: { id: walkA.id },
        include: { components: true, evidence: true },
      });
      expect(persistedA!.components).toHaveLength(4);
      expect(persistedA!.components.map((c) => c.geoEntityId)).not.toContain(
        geo['Parque Lezama'].id,
      );
      expect(persistedA!.evidence.map((e) => e.source)).toEqual(['guide-1']);
      expect(persistedA!.metadata).toEqual(beforeMetadata);
    });

    it('Case 3b — the real resolver surfaces AMBIGUOUS as a rejected candidate with AMBIGUOUS_DEDUPE, creating no new Experience', async () => {
      const prisma = await getPrisma();
      await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walk',
        description: 'A historical walk through San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'El Zanjón de Granados',
        ]),
        evidence: [{ source: 'guide-1' }],
      });
      const before = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });

      // The resolver's own OSM POI mock reconciles onto the SAME real
      // GeoEntity ids via the identical (provider, externalId) identity
      // already seeded above.
      const osmPlaces = {
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Plaza Dorrego',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.3731, -34.6212] },
              tags: {},
            },
            {
              id: 'osm:node:2',
              name: 'Mercado de San Telmo',
              osmType: 'node',
              osmId: 2,
              geometry: { type: 'Point', coordinates: [-58.3725, -34.6208] },
              tags: {},
            },
            {
              id: 'osm:node:3',
              name: 'Pasaje Defensa',
              osmType: 'node',
              osmId: 3,
              geometry: { type: 'Point', coordinates: [-58.372, -34.6203] },
              tags: {},
            },
            {
              id: 'osm:node:5',
              name: 'Parque Lezama',
              osmType: 'node',
              osmId: 5,
              geometry: { type: 'Point', coordinates: [-58.3696, -34.6265] },
              tags: {},
            },
          ],
        }),
      };
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog,
        geographicValidator,
      );
      const candidate: ExperienceCandidate = {
        name: 'San Telmo Walk',
        themes: ['history'],
        traits: [],
        intents: ['walk'],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'p1',
            name: 'Plaza Dorrego',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'p2',
            name: 'Mercado de San Telmo',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'p3',
            name: 'Pasaje Defensa',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'p4',
            name: 'Parque Lezama',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
        ],
      };
      const boundary: any = {
        id: 'osm:relation:1',
        name: 'Buenos Aires',
        osmType: 'relation',
        osmId: 1,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-58.55, -34.7],
              [-58.3, -34.7],
              [-58.3, -34.45],
              [-58.55, -34.45],
              [-58.55, -34.7],
            ],
          ],
        },
        tags: {},
      };

      const result = await resolver.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate],
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
      });

      expect(result.resolved[0].status).toBe('rejected');
      expect(result.resolved[0].rejectionReasons).toContain('AMBIGUOUS_DEDUPE');
      const after = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      expect(after).toBe(before);
    });
  });

  describe('Facets must not become identity keys', () => {
    it('same area + same theme + same intent + distinct real structure => NEW is possible', async () => {
      const a = await catalog.persistVerifiedExperience({
        canonicalName: 'Colonial Architecture Walk',
        description: 'Colonial architecture stops in San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf(['Plaza Dorrego', 'Pasaje Defensa']),
        evidence: [{ source: 'guide-1' }],
      });
      const b = await catalog.persistVerifiedExperience({
        canonicalName: 'Immigration History Walk',
        description: 'Immigration history stops in San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf(['Conventillo Museum', 'Casa Mínima']),
        evidence: [{ source: 'guide-2' }],
      });
      expect((a as any).dedupeDecision).toBe('NEW');
      expect((b as any).dedupeDecision).toBe('NEW');
      expect(b.id).not.toBe(a.id);
    });

    it('same real structure/evidence but a different theme label AND only a shared generic intent is NOT SAME (classification does not GRANT identity either — round-3 correction)', async () => {
      // CORRECTED from an earlier version of this test that asserted SAME
      // here. That premise directly contradicted the identity-gate's own
      // "component overlap alone cannot force SAME" family of invariants:
      // the only thing distinguishing the two sides below from a genuine
      // NEW/AMBIGUOUS case is a differing `themes` label plus a SHARED
      // GENERIC `intent` ("walk") -- exactly the pattern the design
      // forbids from being used to authorize identity ("theme/intent/
      // facets describe an Experience but do not establish its real-world
      // identity... multiple distinct Experiences with intent=walk in the
      // same scope are explicitly valid"). nameSimilarity is a real but
      // partial 0.43 (shares "historical"/"san"/"telmo", not identical),
      // so it does not independently clear the byte-identical-name bar
      // either. Structural overlap alone still makes this a real,
      // non-trivial AMBIGUOUS candidate (never a confident NEW) -- but
      // never a silent SAME.
      const prisma = await getPrisma();
      const a = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walking Tour',
        description: 'A historical walking tour through San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'El Zanjón de Granados',
        ]),
        evidence: [{ source: 'source-A' }],
      });
      expect((a as any).dedupeDecision).toBe('NEW');
      const beforeMetadata = (
        await prisma.experience.findUnique({ where: { id: a.id } })
      )?.metadata;

      const b = await catalog.persistVerifiedExperience({
        canonicalName: 'Historical Walk through San Telmo',
        description: 'A historical walk covering the same San Telmo stops.',
        metadata: { themes: ['architecture'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'El Zanjón de Granados',
        ]),
        evidence: [{ source: 'source-B' }],
      });

      expect((b as any).dedupeDecision).not.toBe('SAME');

      const count = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      if ((b as any).dedupeDecision === 'AMBIGUOUS') {
        expect(count).toBe(1);
        const persisted = await prisma.experience.findUnique({
          where: { id: a.id },
          include: { evidence: true },
        });
        expect(persisted!.evidence.map((e) => e.source)).toEqual(['source-A']);
        expect(persisted!.metadata).toEqual(beforeMetadata);
      } else {
        expect(count).toBe(2);
        expect((b as any).id).not.toBe(a.id);
      }
    });

    it('BLOCKER 1: exact component/role match + name overlap from generic words ONLY + NO concept evidence on either side is NOT SAME (absence of themes/intents must not be treated as concept agreement)', async () => {
      const prisma = await getPrisma();
      const stops = [
        'Plaza Dorrego',
        'Mercado de San Telmo',
        'Pasaje Defensa',
        'El Zanjón de Granados',
      ];
      // No `metadata` at all on either side -- conceptTerms is empty on
      // BOTH sides. The generic `setOverlap` convention used everywhere
      // else in this file treats an empty/empty pair as full agreement
      // (1), which would let concept vacuously "pass" here purely because
      // no one supplied any concept data at all -- absence of evidence is
      // not evidence of compatibility.
      const a = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Morning Walk',
        description: 'A morning walk through San Telmo.',
        components: componentsOf(stops),
        evidence: [{ source: 'guide-x1' }],
      });
      expect((a as any).dedupeDecision).toBe('NEW');
      const beforeMetadata = (
        await prisma.experience.findUnique({ where: { id: a.id } })
      )?.metadata;

      const b = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Evening Walk',
        description: 'An evening walk through San Telmo.',
        components: componentsOf(stops),
        evidence: [{ source: 'guide-x2' }],
      });

      expect((b as any).dedupeDecision).not.toBe('SAME');

      const count = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      if ((b as any).dedupeDecision === 'AMBIGUOUS') {
        expect(count).toBe(1);
        const persisted = await prisma.experience.findUnique({
          where: { id: a.id },
          include: { evidence: true },
        });
        expect(persisted!.evidence.map((e) => e.source)).toEqual(['guide-x1']);
        expect(persisted!.metadata).toEqual(beforeMetadata);
      } else {
        expect(count).toBe(2);
        expect((b as any).id).not.toBe(a.id);
      }
    });

    it('BLOCKER 2: exact component/role match + a SHARED GENERIC INTENT (walk) ALONE, with different themes, is NOT SAME (a classification facet cannot authorize identity, even the "compatible" intent facet)', async () => {
      const prisma = await getPrisma();
      const stops = [
        'Plaza Dorrego',
        'Mercado de San Telmo',
        'Pasaje Defensa',
        'El Zanjón de Granados',
      ];
      const historical = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walk',
        description:
          'A historical walk exploring colonial-era buildings and 19th-century history along Plaza Dorrego, Mercado de San Telmo, Pasaje Defensa, and El Zanjón de Granados.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf(stops),
        evidence: [{ source: 'history-guide-3' }],
      });
      expect((historical as any).dedupeDecision).toBe('NEW');
      const beforeMetadata = (
        await prisma.experience.findUnique({
          where: { id: historical.id },
        })
      )?.metadata;

      // Independently evidenced, genuinely different tourism concept
      // (architecture, not history) over the identical real stops. Both
      // are, correctly, `intent: walk` -- the design explicitly permits
      // "multiple distinct Experiences with intent=walk in the same
      // scope." Sharing that one generic facet must not be treated as
      // compatible identity evidence.
      const architecture = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Architecture Walk',
        description:
          'A walk examining the architectural styles and facades along Plaza Dorrego, Mercado de San Telmo, Pasaje Defensa, and El Zanjón de Granados.',
        metadata: { themes: ['architecture'], intents: ['walk'] },
        components: componentsOf(stops),
        evidence: [{ source: 'architecture-guide' }],
      });

      expect((architecture as any).dedupeDecision).not.toBe('SAME');

      const count = await prisma.experience.count({
        where: { status: 'VERIFIED' },
      });
      if ((architecture as any).dedupeDecision === 'AMBIGUOUS') {
        expect(count).toBe(1);
        const persisted = await prisma.experience.findUnique({
          where: { id: historical.id },
          include: { evidence: true },
        });
        expect(persisted!.evidence.map((e) => e.source)).toEqual([
          'history-guide-3',
        ]);
        expect(persisted!.metadata).toEqual(beforeMetadata);
      } else {
        expect(count).toBe(2);
        expect((architecture as any).id).not.toBe(historical.id);
      }
    });
  });

  describe('Component overlap boundaries', () => {
    it('100% role-aware component identity + compatible evidence => SAME', async () => {
      const a = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walking Tour',
        description: 'A historical walking tour through San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'El Zanjón de Granados',
        ]),
        evidence: [{ source: 'source-A' }],
      });
      const b = await catalog.persistVerifiedExperience({
        canonicalName: 'Historical Walk through San Telmo',
        description: 'A historical walk covering the same San Telmo stops.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'El Zanjón de Granados',
        ]),
        evidence: [{ source: 'source-B' }],
      });
      expect((b as any).dedupeDecision).toBe('SAME');
      expect(b.id).toBe(a.id);
    });

    it('partial overlap + clearly distinct structure/evidence => NEW when evidence is strong enough', async () => {
      const a = await catalog.persistVerifiedExperience({
        canonicalName: 'Colonial Architecture Walk',
        description: 'Colonial architecture: Plaza Dorrego and Pasaje Defensa.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Pasaje Defensa',
          'El Zanjón de Granados',
        ]),
        evidence: [{ source: 'guide-1' }],
      });
      const b = await catalog.persistVerifiedExperience({
        canonicalName: 'Immigration History Walk',
        description: 'Immigration history: Conventillo Museum and Casa Mínima.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Conventillo Museum',
          'Casa Mínima',
          'Pasaje Defensa',
        ]),
        evidence: [{ source: 'guide-2' }],
      });
      expect((a as any).dedupeDecision).toBe('NEW');
      expect((b as any).dedupeDecision).toBe('NEW');
    });

    it('partial/high overlap + insufficient/conflicting evidence => AMBIGUOUS', async () => {
      const a = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Historical Walk',
        description: 'A historical walk through San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'El Zanjón de Granados',
        ]),
        evidence: [{ source: 'guide-1' }],
      });
      const incoming = await catalog.persistVerifiedExperience({
        canonicalName: 'San Telmo Walk',
        description: 'A walk through San Telmo.',
        metadata: { themes: ['history'], intents: ['walk'] },
        components: componentsOf([
          'Plaza Dorrego',
          'Mercado de San Telmo',
          'Pasaje Defensa',
          'Parque Lezama',
        ]),
        evidence: [{ source: 'guide-3' }],
      });
      expect((incoming as any).dedupeDecision).toBe('AMBIGUOUS');
      void a;
    });
  });
});
