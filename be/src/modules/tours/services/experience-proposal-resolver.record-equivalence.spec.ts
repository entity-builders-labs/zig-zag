import { withDefaultGeographicAuthorization } from '../utils/geographic-validation-authorization.util';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';
import { projectComponentIdentityStepInputs } from '../utils/generation-trace/resolution-audit';
import { IdentityVerifier } from './identity-verifier.service';

/**
 * Record equivalence in LOCAL_OSM_POOL resolution (RW4-ID-RECALL-CABILDO-1).
 * Tags, coordinates and item names are the real ones captured in
 * spikes/rw4-functional-composite-campaign-2026-10-05/identity-false-verify-2026-10-07/.
 */
const DESTINATION = {
  kind: 'AREA_BOUNDARY' as const,
  boundary: {
    id: 'osm:relation:1224652',
    name: 'Buenos Aires',
    osmType: 'relation' as const,
    osmId: 1224652,
    tags: { boundary: 'administrative', admin_level: '8' },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-58.53, -34.71],
          [-58.36, -34.71],
          [-58.36, -34.53],
          [-58.53, -34.53],
          [-58.53, -34.71],
        ],
      ],
    },
  },
};

const osm = (
  id: string,
  [longitude, latitude]: [number, number],
  tags: Record<string, string>,
) => ({
  id,
  name: tags.name,
  osmType: id.split(':')[1],
  osmId: Number(id.split(':')[2]),
  geometry: { type: 'Point', coordinates: [longitude, latitude] },
  tags,
});

const CABILDO_MUSEUM = osm('osm:node:767690911', [-58.3738806, -34.6087695], {
  'addr:housenumber': '65',
  'addr:street': 'Bolívar',
  building: 'yes',
  museum: 'history',
  name: 'Museo Histórico Nacional del Cabildo y de la Revolución de Mayo',
  'name:ru': 'Ратуша Буэнос-Айреса',
  tourism: 'museum',
  wikidata: 'Q1024829',
  wikipedia: 'es:Cabildo de Buenos Aires',
});
const CABILDO_BUILDING = osm('osm:way:293947112', [-58.3736802, -34.6088055], {
  'addr:housenumber': '65',
  'addr:street': 'Bolívar',
  alt_name: 'Cabildo de Mayo',
  building: 'yes',
  historic: 'building',
  name: 'Cabildo de Buenos Aires',
  short_name: 'Cabildo',
  tourism: 'yes',
  wikidata: 'Q1024829',
  wikipedia: 'es:Cabildo de Buenos Aires',
});
const CABILDO_ITEM = {
  label: 'Cabildo of Buenos Aires',
  aliases: [
    'Cabildo de Buenos Aires',
    'Cabildo histórico',
    'Cabildo building',
    'Cabildo historico',
    'Museo Historico Nacional del Cabildo y de la Revolucion de Mayo',
  ],
};
const FADU = osm('osm:node:11254256164', [-58.44396, -34.54136], {
  'addr:housenumber': '2160',
  'addr:street': 'Intendente Güiraldes',
  amenity: 'university',
  tourism: 'attraction',
  name: 'Facultad de Arquitectura, Diseño y Urbanismo',
  short_name: 'FADU',
  wikidata: 'Q5854525',
});
const EXACTAS = osm('osm:node:11254256165', [-58.44232, -34.54195], {
  'addr:housenumber': '2160',
  'addr:street': 'Intendente Güiraldes',
  amenity: 'university',
  tourism: 'attraction',
  name: 'Facultad de Ciencias Exactas y Naturales',
  short_name: 'FCEN',
  wikidata: 'Q5854525',
  wikipedia:
    'es:Facultad de Ciencias Exactas y Naturales (Universidad de Buenos Aires)',
});
const FADU_ITEM = {
  label: 'School of Architecture, Design and Urbanism',
  aliases: [
    'Facultad de Arquitectura, Diseño y Urbanismo (UBA)',
    'FAU',
    'FADU',
    'FADU-UBA',
    'Facultad de Arquitectura, Diseño y Urbanismo de la Universidad de Buenos Aires',
  ],
};
const PELLEGRINI_TOMB = osm('osm:node:5332434913', [-58.3935416, -34.5871795], {
  historic: 'tomb',
  name: 'Carlos Pellegrini',
  wikidata: 'Q270446',
  wikipedia: 'es:Carlos Pellegrini',
});
const PELLEGRINI_ITEM = {
  label: 'Carlos Pellegrini',
  aliases: ['Carlos Enrique José Pellegrini'],
};

function build(
  pool: any[],
  items: Record<string, { label: string; aliases: string[] }>,
  located: Record<string, boolean> | 'FAILS',
) {
  const wikidata = {
    getEntitySummaries: jest.fn(async (qids: string[]) => {
      const map = new Map();
      for (const qid of qids)
        if (items[qid]) map.set(qid, { qid, ...items[qid], sitelinkCount: 1 });
      return map;
    }),
    findNearbyPlaces: jest.fn().mockResolvedValue([]),
    lookupPhysicalLocation: jest.fn(async (qids: string[]) => {
      if (located === 'FAILS') throw new Error('wikidata timeout');
      return new Map(
        qids
          .filter((qid) => qid in located)
          .map((qid) => [qid, { qid, located: located[qid] }]),
      );
    }),
  };
  const catalog = {
    findGeoEntityCandidatesForHint: jest
      .fn()
      .mockResolvedValue({ candidates: [] }),
    rememberVerifiedHintName: jest.fn().mockResolvedValue('REMEMBERED'),
    findGeoEntityIdsByIdentities: jest.fn().mockResolvedValue([]),
    upsertGeoEntityWithIdentities: jest.fn(),
    upsertGeoEntity: jest.fn(async (entity: any) => ({
      id: `geo-${entity.externalId}`,
    })),
    resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
    persistVerifiedExperience: jest
      .fn()
      .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
  };
  const service = new ExperienceProposalResolverService(
    {
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: pool }),
      lookupPoisNear: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: pool }),
      lookupBoundaryById: jest.fn(),
      lookupHighwaysByName: jest.fn(),
    } as any,
    catalog as any,
    { validate: jest.fn().mockReturnValue({ accepted: true }) } as any,
    undefined,
    { search: jest.fn().mockResolvedValue([]) } as any,
    undefined,
    wikidata as any,
  );
  return { service, catalog, wikidata };
}

const resolveHint = (
  service: ExperienceProposalResolverService,
  hint: string,
) =>
  service.resolve({
    destinationName: 'Buenos Aires, Argentina',
    destinationCountryCode: 'AR',
    geographicScope: DESTINATION,
    candidates: withDefaultGeographicAuthorization([
      {
        name: `${hint} visit`,
        themes: ['history'],
        traits: [],
        intents: ['visit'],
        componentHints: [
          {
            key: 'hint',
            name: hint,
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
        ],
        evidenceKeys: ['ev-1'],
        shortReason: 'source-backed place',
      },
    ]),
    evidence: [
      {
        key: 'ev-1',
        source: 'web',
        title: 'Buenos Aires walk',
        snippet: `${hint} in Buenos Aires`,
      },
    ],
  } as any);

const localAttempt = (result: any) =>
  result.entityResolution.forensicAudit[0].componentAudits[0].attempts.find(
    (attempt: any) => attempt.strategy === 'LOCAL_OSM_POOL',
  );

describe('ExperienceProposalResolverService -- record equivalence (LOCAL_OSM_POOL)', () => {
  afterEach(() => jest.restoreAllMocks());
  describe('Cabildo: one building mapped as a museum node and a building way', () => {
    it('verifies "Cabildo" through the grouped identity\'s exact short_name, by the existing grounded-unique-alias rule', async () => {
      const { service } = build(
        [CABILDO_MUSEUM, CABILDO_BUILDING],
        { Q1024829: CABILDO_ITEM },
        { Q1024829: true },
      );

      const result = await resolveHint(service, 'Cabildo');

      const attempt = localAttempt(result);
      expect(attempt).toMatchObject({
        verificationDecision: 'VERIFIED',
        verificationRule: 'GROUNDED_UNIQUE_ALIAS',
        recordEquivalence: {
          grouped: true,
          qid: 'Q1024829',
          basis: {
            sharedQid: 'Q1024829',
            locatedItem: true,
            exactAddress: 'bolivar 65',
            memberNameConsistency: 'EQUIVALENT',
          },
          members: ['osm:node:767690911', 'osm:way:293947112'],
        },
      });
      // 7. The exact short_name comes from the OTHER member (the way).
      expect(attempt.decisiveEvidence).toContainEqual({
        type: 'DECLARED_ALIAS_MATCH',
        // 8. The group counts once: SINGLE, not MULTIPLE.
        identityMultiplicity: 'SINGLE',
        correspondence: 'EQUIVALENT',
      });
      // The group is never its own competitor.
      expect(attempt.identityEvidence).toContainEqual(
        expect.objectContaining({
          type: 'COMPETITOR_EXAMINATION',
          outcome: 'NO_MATERIAL_COMPETITOR',
        }),
      );
      expect(result.acceptedCount).toBe(1);
    });

    it('makes the grouping observable in the Bitácora, compactly', async () => {
      const { service } = build(
        [CABILDO_MUSEUM, CABILDO_BUILDING],
        { Q1024829: CABILDO_ITEM },
        { Q1024829: true },
      );

      const result = await resolveHint(service, 'Cabildo');
      const [step] = projectComponentIdentityStepInputs(
        {
          ...result,
          entityResolution: {
            ...(result as any).entityResolution,
            forensicAudit: (result as any).entityResolution.forensicAudit.map(
              (audit: any) => ({
                ...audit,
                // The compact step skips single-component candidates.
                componentAudits: [
                  ...audit.componentAudits,
                  { ...audit.componentAudits[0], hintKey: 'twin' },
                ],
              }),
            ),
          },
        } as any,
        { strategy: 'generic', passNumber: 1 } as any,
      );
      const local = (step.facts as any).components[0].attempts.find(
        (attempt: any) => attempt.strategy === 'LOCAL_OSM_POOL',
      );
      expect(local.recordEquivalence).toMatchObject({
        grouped: true,
        basis: { sharedQid: 'Q1024829', exactAddress: 'bolivar 65' },
      });
    });

    it('9. a materially different same-name record outside the group stays a competitor, counted against one grouped identity', async () => {
      const LOCKSMITH = osm('osm:node:4612043879', [-58.46334, -34.55575], {
        name: 'Cabildo',
        tourism: 'attraction',
      });
      const { service } = build(
        [CABILDO_MUSEUM, CABILDO_BUILDING, LOCKSMITH],
        { Q1024829: CABILDO_ITEM },
        { Q1024829: true },
      );

      const result = await resolveHint(service, 'Cabildo');

      // Exact-name retrieval selects the outside record; the grouped
      // Cabildo is its single material competitor.
      expect(localAttempt(result)).toMatchObject({
        selectedCandidate: { externalId: 'osm:node:4612043879' },
        verificationDecision: 'AMBIGUOUS',
        verificationRule: 'MATERIAL_COMPETITOR_KNOWN',
      });
      expect(localAttempt(result).identityEvidence).toContainEqual(
        expect.objectContaining({
          type: 'COMPETITOR_EXAMINATION',
          outcome: 'MATERIAL_COMPETITOR_KNOWN',
          competitorCount: 1,
        }),
      );
      expect(result.acceptedCount).toBe(0);
    });

    it('10. a failed Wikidata location lookup groups nothing: the pre-equivalence behaviour stands', async () => {
      const { service } = build(
        [CABILDO_MUSEUM, CABILDO_BUILDING],
        { Q1024829: CABILDO_ITEM },
        'FAILS',
      );

      const result = await resolveHint(service, 'Cabildo');

      expect(localAttempt(result)).toMatchObject({
        verificationDecision: 'AMBIGUOUS',
        verificationRule: 'MATERIAL_COMPETITOR_KNOWN',
        recordEquivalence: {
          grouped: false,
          qid: 'Q1024829',
          reason: 'QID_FACTS_UNAVAILABLE',
        },
      });
      expect(result.acceptedCount).toBe(0);
    });

    it('an item with no coordinate groups nothing', async () => {
      const { service } = build(
        [CABILDO_MUSEUM, CABILDO_BUILDING],
        { Q1024829: CABILDO_ITEM },
        { Q1024829: false },
      );

      const result = await resolveHint(service, 'Cabildo');

      expect(localAttempt(result)).toMatchObject({
        verificationDecision: 'AMBIGUOUS',
        recordEquivalence: { grouped: false, reason: 'QID_NOT_LOCATED' },
      });
    });
  });

  describe('FADU / Exactas: a mis-tagged QID shared on one campus address', () => {
    it('forms no group, transfers no alias and creates no VERIFIED', async () => {
      const candidatesSeen: any[] = [];
      const decide = IdentityVerifier.prototype.decide;
      jest
        .spyOn(IdentityVerifier.prototype, 'decide')
        .mockImplementation(function (this: any, hint: any, attempt: any) {
          candidatesSeen.push(attempt.candidate);
          return decide.call(this, hint, attempt);
        });
      const { service } = build(
        [FADU, EXACTAS],
        { Q5854525: FADU_ITEM },
        { Q5854525: true },
      );

      const exactas = await resolveHint(
        service,
        'Facultad de Ciencias Exactas y Naturales',
      );
      const attempt = localAttempt(exactas);
      expect(attempt.recordEquivalence).toEqual({
        grouped: false,
        qid: 'Q5854525',
        reason: 'MEMBER_NAME_NOT_EQUIVALENT',
      });
      // No FADU name reaches the Exactas candidate: only its own aliases.
      expect(
        candidatesSeen
          .filter((c) => c.externalId === 'osm:node:11254256165')
          .flatMap((c) => c.nameAliasCandidates ?? []),
      ).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/FADU|Arquitectura/)]),
      );
      expect(attempt.verificationRule).toBe('GROUNDED_UNIQUE_EXACT_NAME');

      // A FADU-only name never verifies the Exactas record.
      const fadu = await resolveHint(service, 'FADU');
      expect(fadu.acceptedCount).toBe(0);
    });
  });

  describe('Don Carlos: the tomb of Carlos Pellegrini stays unverified', () => {
    it('with the real pool shape (one record for the item) there is nothing to group', async () => {
      const { service } = build(
        [PELLEGRINI_TOMB],
        { Q270446: PELLEGRINI_ITEM },
        { Q270446: false },
      );

      const result = await resolveHint(service, 'Don Carlos');

      expect(localAttempt(result).recordEquivalence).toBeUndefined();
      expect(result.acceptedCount).toBe(0);
    });

    it('even with a second record sharing the person QID and address, a person item forms no group', async () => {
      const at = { 'addr:street': 'Junín', 'addr:housenumber': '1760' };
      const tomb = {
        ...PELLEGRINI_TOMB,
        tags: { ...PELLEGRINI_TOMB.tags, ...at },
      };
      const bust = osm('osm:node:9', [-58.3934, -34.5872], {
        historic: 'memorial',
        name: 'Carlos Pellegrini',
        wikidata: 'Q270446',
        ...at,
      });
      const { service } = build(
        [tomb, bust],
        { Q270446: PELLEGRINI_ITEM },
        { Q270446: false },
      );

      const result = await resolveHint(service, 'Don Carlos');

      expect(localAttempt(result)).toMatchObject({
        recordEquivalence: { grouped: false, reason: 'QID_NOT_LOCATED' },
      });
      expect(localAttempt(result).verificationDecision).not.toBe('VERIFIED');
      expect(result.acceptedCount).toBe(0);
    });
  });
});
