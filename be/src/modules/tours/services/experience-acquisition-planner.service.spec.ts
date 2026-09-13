import { Test, TestingModule } from '@nestjs/testing';
import { ExperienceAcquisitionPlannerService } from './experience-acquisition-planner.service';
import { CoverageDeficit } from '../interfaces/coverage-analysis.interface';
import { PreferenceFacet } from '../preferences/preference-facet.interface';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import {
  ExperienceAcquisitionPlan,
  SourcePlan,
} from '../interfaces/experience-acquisition-plan.interface';

function findPlan<T extends SourcePlan['provider']>(
  plan: ExperienceAcquisitionPlan,
  provider: T,
): Extract<SourcePlan, { provider: T }> | undefined {
  return plan.sourcePlans.find((s) => s.provider === provider) as any;
}

describe('ExperienceAcquisitionPlannerService', () => {
  let service: ExperienceAcquisitionPlannerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExperienceAcquisitionPlannerService],
    }).compile();

    service = module.get<ExperienceAcquisitionPlannerService>(
      ExperienceAcquisitionPlannerService,
    );
  });

  // Scenario M: Legacy deficit projection
  it('Scenario M: projects legacy CoverageDeficit to dimension-aware AcquisitionDeficit without regex parsing', () => {
    const legacy: CoverageDeficit[] = [
      {
        reason: 'missing_requested_theme',
        severity: 'warning',
        theme: 'history',
        actualCount: 0,
        expectedCount: 2,
        message: 'Need 2 more history candidates',
      },
      {
        reason: 'missing_requested_trait',
        severity: 'warning',
        trait: 'historic',
        actualCount: 0,
        expectedCount: 1,
        message: 'Need 1 historic candidate',
      },
      {
        reason: 'missing_requested_intent',
        severity: 'warning',
        intent: 'walk',
        actualCount: 0,
        expectedCount: 1,
        message: 'Need 1 walk candidate',
      },
      {
        reason: 'insufficient_usable_candidates',
        severity: 'blocking',
        actualCount: 1,
        expectedCount: 5,
        message: 'Need more general candidate pool size',
      },
    ];

    const projected = service.projectCoverageDeficits(legacy);
    expect(projected).toHaveLength(4);

    expect(projected[0]).toEqual({
      dimension: 'theme',
      key: 'history',
      reason: 'Need 2 more history candidates',
      origin: 'coverage_analysis',
      legacyDeficit: legacy[0],
    });

    expect(projected[1]).toEqual({
      dimension: 'trait',
      key: 'historic',
      reason: 'Need 1 historic candidate',
      origin: 'coverage_analysis',
      legacyDeficit: legacy[1],
    });

    expect(projected[2]).toEqual({
      dimension: 'intent',
      key: 'walk',
      reason: 'Need 1 walk candidate',
      origin: 'coverage_analysis',
      legacyDeficit: legacy[2],
    });

    expect(projected[3]).toEqual({
      dimension: undefined,
      key: undefined,
      reason: 'Need more general candidate pool size',
      origin: 'coverage_analysis',
      legacyDeficit: legacy[3],
    });
  });

  // Scenario N: Preference facet projection with canonical dimensions
  it('Scenario N: emits deficit when preference facet has no candidate match, and emits none when match exists', () => {
    const candidatePool: ExperienceCandidate[] = [
      {
        name: 'Parque San Martín',
        themes: ['nature'],
        traits: ['outdoors'],
        componentHints: [],
        evidenceKeys: ['ev:1'],
        shortReason: 'Park',
      },
    ];

    const wineFacet: PreferenceFacet = {
      dimension: 'theme',
      key: 'wine',
      importance: 1.0,
      confidence: 1.0,
      source: 'wizard',
    };

    const natureFacet: PreferenceFacet = {
      dimension: 'theme',
      key: 'nature',
      importance: 1.0,
      confidence: 1.0,
      source: 'wizard',
    };

    // Wine has no match -> deficit emitted
    const wineDeficits = service.projectPreferenceFacetDeficits(candidatePool, [
      wineFacet,
    ]);
    expect(wineDeficits).toHaveLength(1);
    expect(wineDeficits[0]).toEqual({
      dimension: 'theme',
      key: 'wine',
      reason: 'Coverage deficit for preference facet [theme:wine]',
      origin: 'preference_facet',
    });

    // Nature has a match -> no deficit emitted
    const natureDeficits = service.projectPreferenceFacetDeficits(
      candidatePool,
      [natureFacet],
    );
    expect(natureDeficits).toHaveLength(0);
  });

  // Scenario O: Exploration style dormancy
  it('Scenario O: ignores exploration_style facets completely in deficit projection and source routing', () => {
    const candidatePool: ExperienceCandidate[] = [];
    const explorationFacet: PreferenceFacet = {
      dimension: 'exploration_style',
      key: 'relaxed',
      importance: 1.0,
      confidence: 1.0,
      source: 'wizard',
    };

    const deficits = service.projectPreferenceFacetDeficits(candidatePool, [
      explorationFacet,
    ]);
    expect(deficits).toHaveLength(0);

    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Mendoza' },
      preferredFacets: [explorationFacet],
      candidates: candidatePool,
    });
    expect(plan.deficits).toHaveLength(0);
    expect(plan.sourcePlans).toHaveLength(0);
  });

  // Specific canonical route tests
  it('routes theme:wine correctly across Wikivoyage, OSM, Places, and Web', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Mendoza' },
      deficits: [
        {
          dimension: 'theme',
          key: 'wine',
          reason: 'Need wine',
          origin: 'preference_facet',
        },
      ],
    });

    expect(plan.destination).toEqual({ destinationName: 'Mendoza' });
    expect(plan.breadth).toBe('focused');

    const wv = findPlan(plan, 'wikivoyage');
    expect(wv?.wikivoyage.sections).toEqual(['EAT']);

    const osm = findPlan(plan, 'osm');
    expect(osm?.osm.concepts).toEqual(['vineyard', 'winery']);

    const places = findPlan(plan, 'google_places');
    expect(places?.places.searchTypes).toEqual(['winery']);

    const web = findPlan(plan, 'web');
    expect(web?.web.query).toContain('Mendoza');
    expect(web?.web.query).toContain('wine tasting');
  });

  it('routes winery_scale:boutique to Places and Web only (no OSM or Wikivoyage)', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Mendoza' },
      deficits: [
        {
          dimension: 'winery_scale',
          key: 'boutique',
          reason: 'Need boutique winery',
          origin: 'preference_facet',
        },
      ],
    });

    expect(findPlan(plan, 'wikivoyage')).toBeUndefined();
    expect(findPlan(plan, 'osm')).toBeUndefined();

    const places = findPlan(plan, 'google_places');
    expect(places?.places.searchTypes).toEqual(['winery']);

    const web = findPlan(plan, 'web');
    expect(web?.web.query).toContain('boutique wineries');
  });

  it('routes nature_type:park correctly to Wikivoyage, OSM, Places, and Web', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Bariloche' },
      deficits: [
        {
          dimension: 'nature_type',
          key: 'park',
          reason: 'Need park',
          origin: 'preference_facet',
        },
      ],
    });

    const wv = findPlan(plan, 'wikivoyage');
    expect(wv?.wikivoyage.sections).toEqual(['SEE', 'DO']);

    const osm = findPlan(plan, 'osm');
    expect(osm?.osm.concepts).toEqual(['nature_reserve', 'park']);

    const places = findPlan(plan, 'google_places');
    expect(places?.places.searchTypes).toEqual(['park']);

    const web = findPlan(plan, 'web');
    expect(web?.web.query).toContain('parks');
  });

  it('routes local_character:authentic to Wikivoyage and Web only (no OSM or Places)', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Buenos Aires' },
      deficits: [
        {
          dimension: 'local_character',
          key: 'authentic',
          reason: 'Need authentic character',
          origin: 'preference_facet',
        },
      ],
    });

    const wv = findPlan(plan, 'wikivoyage');
    expect(wv?.wikivoyage.sections).toEqual(['SEE', 'EAT']);

    expect(findPlan(plan, 'osm')).toBeUndefined();
    expect(findPlan(plan, 'google_places')).toBeUndefined();

    const web = findPlan(plan, 'web');
    expect(web?.web.query).toContain('authentic neighborhood spots');
  });

  it('routes intent:walk to Wikivoyage DO, OSM route-like concepts, and Web (no Places)', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Salta' },
      deficits: [
        {
          dimension: 'intent',
          key: 'walk',
          reason: 'Need walking activity',
          origin: 'preference_facet',
        },
      ],
    });

    const wv = findPlan(plan, 'wikivoyage');
    expect(wv?.wikivoyage.sections).toEqual(['DO']);

    const osm = findPlan(plan, 'osm');
    expect(osm?.osm.concepts).toEqual(['footway', 'hiking', 'route']);

    expect(findPlan(plan, 'google_places')).toBeUndefined();

    const web = findPlan(plan, 'web');
    expect(web?.web.query).toContain('walking tours');
  });

  // Scenario Q: Multi-deficit plan coalescing with canonical contract
  it('Scenario Q: coalesces multi-deficit requests across providers into sorted deduplicated source plans', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Buenos Aires' },
      deficits: [
        {
          dimension: 'theme',
          key: 'history',
          reason: 'Need history',
          origin: 'preference_facet',
        },
        {
          dimension: 'theme',
          key: 'food',
          reason: 'Need food',
          origin: 'preference_facet',
        },
      ],
    });

    const wv = findPlan(plan, 'wikivoyage');
    expect(wv?.wikivoyage.sections).toEqual(['SEE', 'EAT']);

    const osm = findPlan(plan, 'osm');
    expect(osm?.osm.concepts).toEqual([
      'cafe',
      'historic',
      'museum',
      'restaurant',
    ]);

    const places = findPlan(plan, 'google_places');
    expect(places?.places.searchTypes).toEqual([
      'bakery',
      'cafe',
      'museum',
      'restaurant',
      'tourist_attraction',
    ]);

    expect(findPlan(plan, 'web')).toBeDefined();
  });

  // Scenario R: Single web query guarantee
  it('Scenario R: emits exactly ONE plain-keyword web query regardless of the number of deficits', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Mendoza' },
      deficits: [
        {
          dimension: 'theme',
          key: 'history',
          reason: 'Need history',
          origin: 'preference_facet',
        },
        {
          dimension: 'theme',
          key: 'food',
          reason: 'Need food',
          origin: 'preference_facet',
        },
        {
          dimension: 'theme',
          key: 'wine',
          reason: 'Need wine',
          origin: 'preference_facet',
        },
        {
          dimension: 'nature_type',
          key: 'mountain',
          reason: 'Need mountains',
          origin: 'preference_facet',
        },
        {
          dimension: 'tourism_intensity',
          key: 'hidden',
          reason: 'Need hidden spots',
          origin: 'preference_facet',
        },
      ],
      semanticQuery: 'wineries in Valle de Uco',
    });

    const webPlans = plan.sourcePlans.filter((s) => s.provider === 'web');
    expect(webPlans).toHaveLength(1);

    const query = (webPlans[0] as any).web.query;
    expect(query.startsWith('Mendoza')).toBe(true);
    expect(query).toContain('wine tasting');
    expect(query).toContain('wineries in Valle de Uco');
    expect(query).not.toContain('Find me');
    expect(query).not.toContain('{');
    expect(query).not.toContain('}');
  });

  // Scenario S: Unknown dimension fallback
  it('Scenario S: routes unknown dimensions or keys ONLY to web without polluting OSM or Places', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Córdoba' },
      deficits: [
        {
          dimension: 'companion',
          key: 'flying_trapeze',
          reason: 'Need flying trapeze',
          origin: 'preference_facet',
        },
      ],
    });

    expect(findPlan(plan, 'wikivoyage')).toBeUndefined();
    expect(findPlan(plan, 'osm')).toBeUndefined();
    expect(findPlan(plan, 'google_places')).toBeUndefined();

    const web = findPlan(plan, 'web');
    expect(web).toEqual({
      provider: 'web',
      web: {
        query: 'Córdoba flying_trapeze',
      },
    });
  });

  // Scenario T: Empty deficit handling
  it('Scenario T: returns empty source plans when no deficits exist', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Salta' },
      deficits: [],
    });

    expect(plan.deficits).toHaveLength(0);
    expect(plan.sourcePlans).toHaveLength(0);
  });

  // Explicit dormant deficit handling
  it('returns empty source plans when all deficits are dormant (exploration_style)', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Salta' },
      deficits: [
        {
          dimension: 'exploration_style',
          key: 'relaxed',
          reason: 'dormant',
          origin: 'preference_facet',
        },
      ],
    });

    expect(plan.deficits).toHaveLength(1);
    expect(plan.sourcePlans).toHaveLength(0);
  });

  // Generic/dimensionless deficit conservative fallback
  it('routes generic/dimensionless deficits to conservative Wikivoyage + Web fallback without OSM or Places pollution', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Salta' },
      deficits: [
        {
          origin: 'global_capacity',
          reason: 'low_coverage',
          currentEligibleCount: 1,
          requiredEligibleCount: 4,
        },
      ],
    });

    expect(findPlan(plan, 'osm')).toBeUndefined();
    expect(findPlan(plan, 'google_places')).toBeUndefined();

    const wv = findPlan(plan, 'wikivoyage');
    expect(wv).toBeDefined();
    expect(wv?.wikivoyage.sections).toEqual(['SEE', 'DO', 'EAT']);

    const web = findPlan(plan, 'web');
    expect(web).toBeDefined();
    expect(web?.web.query).toContain('Salta');
    expect(web?.web.query).toContain('top attractions');
    expect(web?.web.query).toContain('things to do');
  });

  it('preserves BOTH anchor names for a multi-anchor walk deficit, never collapsing to one (Task B5)', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Buenos Aires' },
      deficits: [
        {
          dimension: 'intent',
          key: 'walk',
          reason: 'Need a walk candidate',
          origin: 'preference_facet',
        },
      ],
      anchors: [
        { rawName: 'San Telmo', kind: 'area', priority: 'must' },
        { rawName: 'La Boca', kind: 'area', priority: 'must' },
      ],
    });

    const web = findPlan(plan, 'web');
    expect(web?.web.anchorNames).toEqual(['San Telmo', 'La Boca']);
    expect(web?.web.query).toContain('San Telmo');
    expect(web?.web.query).toContain('La Boca');
  });

  it('does not inject anchor names for a non-walk/route_like deficit', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Buenos Aires' },
      deficits: [
        {
          dimension: 'theme',
          key: 'culture',
          reason: 'Need a culture candidate',
          origin: 'preference_facet',
        },
      ],
      anchors: [{ rawName: 'San Telmo', kind: 'area', priority: 'must' }],
    });

    const web = findPlan(plan, 'web');
    expect(web?.web.anchorNames).toBeUndefined();
    expect(web?.web.query).not.toContain('San Telmo');
  });

  it('ignores a venue/unknown-kind anchor for the walk-query anchor injection', () => {
    const plan = service.buildAcquisitionPlan({
      destination: { destinationName: 'Buenos Aires' },
      deficits: [
        {
          dimension: 'intent',
          key: 'route_like',
          reason: 'Need a route_like candidate',
          origin: 'preference_facet',
        },
      ],
      anchors: [{ rawName: 'MALBA', kind: 'venue', priority: 'soft' }],
    });

    const web = findPlan(plan, 'web');
    expect(web?.web.anchorNames).toBeUndefined();
  });
});
