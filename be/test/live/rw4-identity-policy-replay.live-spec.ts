import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { DestinationResolutionService } from 'src/modules/tours/services/destination-resolution.service';
import { ExperienceProposalResolverService } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { CompositeGeographicValidationService } from 'src/modules/tours/services/composite-geographic-validation.service';
import { OsmPlacesService } from 'src/modules/integrations/osm/services/osm-places.service';
import { OverturePlacesIndexService } from 'src/modules/integrations/overture/overture-places-index.service';
import { GeographicScope } from 'src/modules/tours/interfaces/experience-resolution.interface';
import {
  ExperienceCandidate,
  GeoEntityHint,
} from 'src/modules/tours/interfaces/experience-discovery.interface';
import { COMPONENT_LOCALITY_GROUNDER } from 'src/modules/tours/interfaces/component-identity-context.interface';
import {
  authorizeCandidates,
  ownedIntentGrant,
} from 'src/modules/tours/utils/geographic-validation-authorization.util';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(20 * 60 * 1000);

/**
 * RW4 identity policy replay (RW4-ID-CORRESPONDENCE-1; diagnostic only,
 * never a gate, never COLD/WARM).
 *
 * Input: the component hints the REAL extractor emitted in
 * `locality-recovery-2026-10-03/replay-gemini-7` (both SolSalute
 * itineraries; Ojo de Agua carries the recovered "Lujan de Cuyo"
 * assertion). No LLM is called. Non-identity candidate fields (themes,
 * intents, reason) are reconstructed; they do not reach identity.
 *
 * Pass AS_EXTRACTED resolves those hints with the REAL resolver, locality
 * grounder, Nominatim, Overpass, Geoapify, Wikidata and the REAL Overture
 * AOI snapshot. The catalog is a stub: nothing is read or written.
 *
 * Pass WHAT_IF_FULL_SOURCE_CAPTIONS adds the component localities the full
 * SolSalute article states outside the extraction window ("Alfa Crux in
 * the Uco Valley ...", "This Uco Valley winery ..."). The extractor never
 * saw them: this pass is a labeled counterfactual about what the policy
 * would do with them, never evidence of current behavior.
 */
const RUN = process.env.RUN_RW4_POLICY_REPLAY === '1';
const describeIfRun = RUN ? describe : describe.skip;
const DOSSIER =
  'spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization';

const WINDOW = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../src/modules/tours/fixtures/rw4-solsalute-deep-source-window.json',
    ),
    'utf8',
  ),
) as { sourceUrl: string; content: string };

const EXTRACTED = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../..',
      DOSSIER,
      'locality-recovery-2026-10-03/replay-gemini-7/contextual-replay.json',
    ),
    'utf8',
  ),
).extractedHints as Array<{ candidate: string; hints: GeoEntityHint[] }>;

// Literal sentences of the full article (Tavily advanced extract,
// spikes/rw4-tavily-extract-fidelity-2026-10-01/outputs/advanced-markdown.md).
const FULL_SOURCE_CAPTIONS: Record<string, { locality: string; span: string }> =
  {
    'Alfa Crux': {
      locality: 'Uco Valley',
      span: 'Alfa Crux in the Uco Valley is an architectural masterpiece.',
    },
    SuperUco: {
      locality: 'Uco Valley',
      span: 'This Uco Valley winery is owned by the four Michelini brothers and is a family passion project.',
    },
  };

function stubCatalog(writes: Array<{ op: string; args: unknown }>) {
  const record =
    (op: string, result: unknown) =>
    async (...args: unknown[]) => {
      writes.push({ op, args: JSON.parse(JSON.stringify(args)) });
      return result;
    };
  return {
    findGeoEntityCandidatesForHint: async () => ({
      candidates: [] as unknown[],
    }),
    findGeoEntityIdsByIdentities: async (): Promise<string[]> => [],
    upsertGeoEntityWithIdentities: record('upsertGeoEntityWithIdentities', {
      status: 'CREATED',
      geoEntity: { id: 'probe-not-persisted' },
      attachedExternalIds: [],
    }),
    upsertGeoEntity: record('upsertGeoEntity', { id: 'probe-not-persisted' }),
    rememberVerifiedHintName: record('rememberVerifiedHintName', 'REMEMBERED'),
    resolveOrCreateTraitDefinitions: async (): Promise<unknown[]> => [],
    persistVerifiedExperience: record('persistVerifiedExperience', {
      id: 'probe-experience-not-persisted',
      dedupeDecision: 'NEW',
    }),
  };
}

const candidatesOf = (withCaptions: boolean): ExperienceCandidate[] =>
  EXTRACTED.map((extracted) => ({
    name: extracted.candidate,
    themes: ['wine'],
    traits: [] as string[],
    intents: ['route_like'],
    evidenceKeys: ['ev-1'],
    shortReason: 'replayed real extraction (replay-gemini-7)',
    componentHints: extracted.hints.map((hint) => {
      const caption = withCaptions
        ? FULL_SOURCE_CAPTIONS[hint.name]
        : undefined;
      return caption && !hint.localityAssertion
        ? {
            ...hint,
            localityAssertion: {
              locality: caption.locality,
              evidenceKey: 'ev-1',
              supportSpan: caption.span,
            },
          }
        : hint;
    }),
  }));

describeIfRun('RW4 identity policy replay (diagnostic)', () => {
  let moduleRef: TestingModule;
  const outDir = path.resolve(
    __dirname,
    '../../..',
    process.env.SPIKE_OUT_DIR ??
      `${DOSSIER}/identity-policy-reassessment-2026-10-03/replay`,
  );

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    fs.mkdirSync(outDir, { recursive: true });
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('replays the real RW4 hints through the real resolver', async () => {
    const destination = await moduleRef
      .get(DestinationResolutionService)
      .resolveDestination(
        'Mendoza, Argentina',
        { latitude: -32.8895, longitude: -68.8458 },
        'settlement' as any,
      );
    if (destination.scale !== 'area') {
      throw new Error(`expected area-scale Mendoza, got ${destination.scale}`);
    }
    const scope: GeographicScope = {
      kind: 'AREA_BOUNDARY',
      boundary: destination.boundary,
    };
    const routeGrant = ownedIntentGrant('AREA_ROUTE_WALK', {
      origin: 'preference_facet',
      dimension: 'intent',
      key: 'route_like',
      reason:
        'Preference facet [intent:route_like] has no strong catalog match yet.',
    });
    const evidence = [
      {
        key: 'ev-1',
        source: 'web',
        url: WINDOW.sourceUrl,
        title: 'The Best Wineries in Mendoza, A Wine Tasting Guide',
        snippet: WINDOW.content,
        evidenceQuality: 'original_content' as const,
      },
    ];
    const grounder = moduleRef.get(COMPONENT_LOCALITY_GROUNDER);
    const overture = moduleRef.get(OverturePlacesIndexService);

    const passes: Record<string, unknown> = {};
    for (const [label, withCaptions] of [
      ['AS_EXTRACTED', false],
      ['WHAT_IF_FULL_SOURCE_CAPTIONS', true],
    ] as const) {
      const writes: Array<{ op: string; args: unknown }> = [];
      const resolver = new ExperienceProposalResolverService(
        moduleRef.get(OsmPlacesService),
        stubCatalog(writes) as any,
        new CompositeGeographicValidationService(),
        undefined,
        moduleRef.get('NominatimApiService'),
        moduleRef.get('PlacesApiService'),
        moduleRef.get('WikidataApiService'),
        overture,
        grounder,
      );
      const response = await resolver.resolve({
        destinationName: destination.boundary.name,
        destinationCountryCode: destination.countryCode,
        geographicScope: scope,
        candidates: authorizeCandidates(routeGrant, candidatesOf(withCaptions)),
        evidence,
      });
      passes[label] = {
        candidates: response.resolved.map((r) => ({
          name: r.candidate.name,
          status: r.status,
          rejectionReasons: r.rejectionReasons,
        })),
        components: response.entityResolution.forensicAudit.flatMap((audit) =>
          audit.componentAudits.map((component: any) => ({
            candidate: audit.candidateName,
            component: component.hintName,
            identityContext: component.identityContext ?? null,
            finalStatus: component.finalStatus,
            finalReason: component.finalReason ?? null,
            attempts: (component.attempts ?? []).map((attempt: any) => ({
              strategy: attempt.strategy,
              executionStatus: attempt.executionStatus,
              providerResultCount: attempt.providerResultCount ?? null,
              failureReason: attempt.failureReason ?? null,
              selectedCandidate: attempt.selectedCandidate
                ? {
                    externalId: attempt.selectedCandidate.externalId,
                    name: attempt.selectedCandidate.canonicalName,
                    latitude: attempt.selectedCandidate.latitude,
                    longitude: attempt.selectedCandidate.longitude,
                  }
                : null,
              identityEvidence: attempt.identityEvidence ?? [],
              verificationDecision: attempt.verificationDecision ?? null,
            })),
          })),
        ),
        wouldPersistCalls: writes.map((write) => write.op),
      };
    }

    // Grounding probe for every locality the source states (never fed to
    // the resolver): which of them the real OSM grounder can ground.
    const grounding: Record<string, unknown> = {};
    for (const locality of [
      'Uco Valley',
      'Valle de Uco',
      'Lujan de Cuyo',
      'Mendoza',
      'Tupungato',
    ]) {
      const result = await grounder.groundLocality(
        { locality, evidenceKey: 'ev-1', supportSpan: locality },
        destination.countryCode,
      );
      grounding[locality] =
        result.status === 'GROUNDED'
          ? {
              status: result.status,
              boundaryId: result.boundary.externalId,
              boundaryName: result.boundary.name,
            }
          : { status: result.status, reason: result.reason };
    }
    const snapshot = await overture.lookupExactPlace({
      hintKey: 'probe',
      hintName: 'Alfa Crux',
      countryCode: destination.countryCode,
      role: 'venue',
    });

    fs.writeFileSync(
      path.join(outDir, 'policy-replay.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          input: `${DOSSIER}/locality-recovery-2026-10-03/replay-gemini-7 (real extractor hints; no LLM call)`,
          destination: {
            name: destination.boundary.name,
            countryCode: destination.countryCode,
          },
          catalog: 'STUB (empty; no reads of canonical state, no writes)',
          overtureSnapshot: {
            coverage: snapshot.coverage,
            enumeratedExtent: snapshot.enumeratedExtent ?? null,
          },
          groundingProbe: grounding,
          passes,
        },
        null,
        2,
      ),
    );
    expect(Object.keys(passes)).toHaveLength(2);
  });
});
