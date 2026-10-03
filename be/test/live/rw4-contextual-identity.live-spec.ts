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
  ExperienceDiscoveryExtractor,
  ExperienceDiscoveryRequest,
} from 'src/modules/tours/interfaces/experience-discovery.interface';
import { COMPONENT_LOCALITY_GROUNDER } from 'src/modules/tours/interfaces/component-identity-context.interface';
import {
  authorizeCandidates,
  ownedIntentGrant,
} from 'src/modules/tours/utils/geographic-validation-authorization.util';
import { localityRelation } from 'src/modules/tours/utils/contextual-identity.policy';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(20 * 60 * 1000);

/**
 * RW4 contextual identity replay (diagnostic only, never a gate).
 *
 *  1. The REAL configured discovery extractor runs on the exact SolSalute
 *     window the COLD #11 extractor saw (captured from its trace), with the
 *     COLD #11 route_like request facts. No web fetch.
 *  2. Its candidates go through the REAL resolver with the REAL locality
 *     grounder (local Nominatim + Overpass), the real identity providers
 *     and the real Overture index. The catalog is a stub: nothing is read
 *     from or written to canonical state.
 *
 * Whether a component carries a locality/kind assertion is decided by the
 * extractor, source locality recovery (§19.1) and the deterministic
 * admission gate, never by this spec. The configured extractor is the
 * application's (`EXPERIENCE_DISCOVERY_PROVIDER`), which runs recovery on
 * the same provider after extraction.
 */
const RUN = process.env.RUN_RW4_CONTEXTUAL_PROBE === '1';
const describeIfRun = RUN ? describe : describe.skip;

const WINDOW = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../src/modules/tours/fixtures/rw4-solsalute-deep-source-window.json',
    ),
    'utf8',
  ),
) as { sourceUrl: string; content: string };

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

describeIfRun('RW4 contextual identity replay (diagnostic)', () => {
  let moduleRef: TestingModule;
  const outDir = path.resolve(
    __dirname,
    '../../..',
    process.env.SPIKE_OUT_DIR ??
      'spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/contextual-identity-2026-10-03',
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

  it('extracts the real SolSalute window and resolves its components', async () => {
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

    // 1. Real extractor, COLD #11 route_like request facts.
    const extractor = moduleRef.get<ExperienceDiscoveryExtractor>(
      'EXPERIENCE_DISCOVERY_PROVIDER',
    );
    const request: ExperienceDiscoveryRequest = {
      scope: {
        destinationName: destination.boundary.name,
        destinationCountryCode: destination.countryCode,
      },
      requestedThemes: [],
      requestedIntents: ['route_like'],
      anchorNames: ['Ruta del Vino de Mendoza'],
      semanticQuery:
        'Ciudad de Mendoza Ruta del Vino de Mendoza scenic routes tours wine route mendoza wineries representative tasting',
      breadth: 'focused',
      maxCandidates: 5,
      evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
    };
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
    const extraction = await extractor.extractExperiences(
      request,
      {
        provider: 'replay',
        model: 'replay',
        groundingStatus: 'applied',
        evidence,
      },
      { bypassCache: true },
    );

    // 2. Real resolver + real locality grounder, stub catalog.
    const writes: Array<{ op: string; args: unknown }> = [];
    const resolver = new ExperienceProposalResolverService(
      moduleRef.get(OsmPlacesService),
      stubCatalog(writes) as any,
      new CompositeGeographicValidationService(),
      undefined,
      moduleRef.get('NominatimApiService'),
      moduleRef.get('PlacesApiService'),
      moduleRef.get('WikidataApiService'),
      moduleRef.get(OverturePlacesIndexService),
      moduleRef.get(COMPONENT_LOCALITY_GROUNDER),
    );
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
    const response = await resolver.resolve({
      destinationName: destination.boundary.name,
      destinationCountryCode: destination.countryCode,
      geographicScope: scope,
      candidates: authorizeCandidates(routeGrant, extraction.candidates),
      evidence,
    });

    // 3. Grounding probe (NOT a verdict and never fed to the resolver):
    // the real OSM boundary for the source caption's locality, and where
    // the two historical Ojo de Agua candidates lie relative to it.
    const grounder = moduleRef.get(COMPONENT_LOCALITY_GROUNDER);
    const grounding = await grounder.groundLocality(
      {
        locality: 'Lujan de Cuyo',
        evidenceKey: 'ev-1',
        supportSpan: 'Wine and lunch at Ojo de Agua in Lujan de Cuyo',
      },
      destination.countryCode,
    );
    const containment =
      grounding.status === 'GROUNDED'
        ? Object.fromEntries(
            [
              ['osm:node:4797394430', -33.1300868, -68.9641048],
              ['osm:node:198407364', -31.2168064, -65.2463275],
            ].map(([id, latitude, longitude]) => [
              id,
              localityRelation(
                { locality: grounding },
                {
                  latitude: latitude as number,
                  longitude: longitude as number,
                },
              ),
            ]),
          )
        : undefined;

    fs.writeFileSync(
      path.join(outDir, 'contextual-replay.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          extractor: {
            provider: extraction.provider,
            model: extraction.model,
            validationErrors: extraction.validationErrors,
            extractionFailures: extraction.extractionFailures,
            rawOutput: extraction.rawOutput,
          },
          extractedHints: extraction.candidates.map((candidate) => ({
            candidate: candidate.name,
            hints: candidate.componentHints,
          })),
          sourceSupportAudits: extraction.sourceSupportAudits,
          localityRecovery: extraction.localityRecovery ?? null,
          componentTrace: response.entityResolution.forensicAudit.flatMap(
            (audit) =>
              audit.componentAudits.map((component: any) => {
                const decisive = [...(component.attempts ?? [])]
                  .reverse()
                  .find((attempt: any) => attempt.verificationDecision);
                const support = extraction.sourceSupportAudits
                  .find((item) => item.candidateName === audit.candidateName)
                  ?.components.find((item) => item.name === component.hintName);
                return {
                  candidate: audit.candidateName,
                  component: component.hintName,
                  proposedLocalityReports: (
                    extraction.localityRecovery?.reports ?? []
                  ).filter(
                    (report) =>
                      report.candidateName === audit.candidateName &&
                      report.componentKey === support?.key,
                  ),
                  localityAdmission:
                    support?.assertionAudits?.find(
                      (item) => item.assertion === 'LOCALITY',
                    ) ?? null,
                  identityContext: component.identityContext ?? null,
                  selectedCandidate:
                    decisive?.selectedCandidate?.externalId ?? null,
                  selectedCandidateName:
                    decisive?.selectedCandidate?.name ?? null,
                  verificationDecision: decisive?.verificationDecision ?? null,
                  strategy: decisive?.strategy ?? null,
                };
              }),
          ),
          groundingProbe: {
            note: 'Diagnostic only; never passed to the resolver.',
            status: grounding.status,
            ...(grounding.status === 'GROUNDED'
              ? {
                  boundaryId: grounding.boundary.externalId,
                  boundaryName: grounding.boundary.name,
                  containment,
                }
              : { reason: grounding.reason }),
          },
          catalog: 'STUB (empty; no reads of canonical state, no writes)',
          wouldPersistCalls: writes,
          candidates: response.resolved.map((r) => ({
            name: r.candidate.name,
            status: r.status,
            rejectionReasons: r.rejectionReasons,
          })),
          forensicAudit: response.entityResolution.forensicAudit.map(
            (audit) => ({
              candidateName: audit.candidateName,
              components: audit.componentAudits,
            }),
          ),
        },
        null,
        2,
      ),
    );
    expect(extraction.extractionFailures).toEqual([]);
  });
});
