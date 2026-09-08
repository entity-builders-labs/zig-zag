import { Test, TestingModule } from '@nestjs/testing';
import { ExperienceAcquisitionPlannerService } from './experience-acquisition-planner.service';
import { CoverageDeficit } from '../interfaces/coverage-analysis.interface';
import { PreferenceFacet } from '../preferences/preference-facet.interface';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';

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

  // Scenario N: Preference facet projection
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
      dimension: 'cuisine',
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
      dimension: 'cuisine',
      key: 'wine',
      reason: 'Coverage deficit for preference facet [cuisine:wine]',
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
      key: 'off_the_beaten_path',
      importance: 1.0,
      confidence: 1.0,
      source: 'wizard',
    };

    const deficits = service.projectPreferenceFacetDeficits(candidatePool, [
      explorationFacet,
    ]);
    expect(deficits).toHaveLength(0);

    const plan = service.buildAcquisitionPlan({
      destination: 'Mendoza',
      preferredFacets: [explorationFacet],
      candidates: candidatePool,
    });
    expect(plan.deficits).toHaveLength(0);
    expect(plan.sources).toEqual({});
  });

  // Scenario P: Source plan routing
  it('Scenario P: routes theme:history deficit to Wikivoyage, OSM, Places, and Web', () => {
    const plan = service.buildAcquisitionPlan({
      destination: 'Buenos Aires',
      deficits: [
        {
          dimension: 'theme',
          key: 'history',
          reason: 'Need history',
          origin: 'coverage_analysis',
        },
      ],
    });

    expect(plan.sources.wikivoyage).toEqual({
      provider: 'wikivoyage',
      sections: ['SEE'],
    });

    expect(plan.sources.osm).toEqual({
      provider: 'osm',
      concepts: ['historic', 'museum'],
    });

    expect(plan.sources.googlePlaces).toEqual({
      provider: 'google_places',
      searchTypes: ['museum', 'tourist_attraction'],
    });

    expect(plan.sources.web?.query).toContain('Buenos Aires');
    expect(plan.sources.web?.query).toContain('historic sites');
  });

  // Scenario Q: Multi-deficit plan coalescing
  it('Scenario Q: coalesces multi-deficit requests across providers into sorted deduplicated source plans', () => {
    const plan = service.buildAcquisitionPlan({
      destination: 'Buenos Aires',
      deficits: [
        {
          dimension: 'theme',
          key: 'history',
          reason: 'Need history',
          origin: 'coverage_analysis',
        },
        {
          dimension: 'theme',
          key: 'food',
          reason: 'Need food',
          origin: 'coverage_analysis',
        },
      ],
    });

    expect(plan.sources.wikivoyage).toEqual({
      provider: 'wikivoyage',
      sections: ['SEE', 'EAT'],
    });

    expect(plan.sources.osm?.concepts).toEqual([
      'cafe',
      'historic',
      'museum',
      'restaurant',
    ]);

    expect(plan.sources.googlePlaces?.searchTypes).toEqual([
      'bakery',
      'cafe',
      'museum',
      'restaurant',
      'tourist_attraction',
    ]);

    expect(plan.sources.web).toBeDefined();
  });

  // Scenario R: Single web query guarantee
  it('Scenario R: emits exactly ONE plain-keyword web query regardless of the number of deficits', () => {
    const plan = service.buildAcquisitionPlan({
      destination: 'Mendoza',
      deficits: [
        {
          dimension: 'theme',
          key: 'history',
          reason: 'Need history',
          origin: 'coverage_analysis',
        },
        {
          dimension: 'theme',
          key: 'food',
          reason: 'Need food',
          origin: 'coverage_analysis',
        },
        {
          dimension: 'cuisine',
          key: 'wine',
          reason: 'Need wine',
          origin: 'preference_facet',
        },
        {
          dimension: 'setting',
          key: 'outdoors',
          reason: 'Need outdoors',
          origin: 'preference_facet',
        },
        {
          dimension: 'vibe',
          key: 'scenic',
          reason: 'Need scenic',
          origin: 'preference_facet',
        },
      ],
      semanticQuery: 'wineries in Valle de Uco',
    });

    expect(plan.sources.web).toBeDefined();
    const query = plan.sources.web!.query;

    // Must be a single space-separated string starting with destination
    expect(query.startsWith('Mendoza')).toBe(true);
    expect(query).toContain('wine tasting');
    expect(query).toContain('wineries in Valle de Uco');
    // Ensure no prompt prose or JSON artifacts
    expect(query).not.toContain('Find me');
    expect(query).not.toContain('{');
    expect(query).not.toContain('}');
  });

  // Scenario S: Unknown dimension fallback
  it('Scenario S: routes unknown dimensions or keys ONLY to web without polluting OSM or Places', () => {
    const plan = service.buildAcquisitionPlan({
      destination: 'Córdoba',
      deficits: [
        {
          dimension: 'companion',
          key: 'flying_trapeze',
          reason: 'Need flying trapeze',
          origin: 'preference_facet',
        },
      ],
    });

    expect(plan.sources.wikivoyage).toBeUndefined();
    expect(plan.sources.osm).toBeUndefined();
    expect(plan.sources.googlePlaces).toBeUndefined();

    expect(plan.sources.web).toEqual({
      provider: 'web',
      query: 'Córdoba flying_trapeze',
    });
  });

  // Scenario T: Empty deficit handling
  it('Scenario T: returns empty source plans when no deficits exist', () => {
    const plan = service.buildAcquisitionPlan({
      destination: 'Salta',
      deficits: [],
    });

    expect(plan.deficits).toHaveLength(0);
    expect(plan.sources).toEqual({});
  });
});
