import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import {
  authorizeCandidate,
  authorizeCandidates,
  authorizesAnchoredAreaMembership,
  authorizesRouteScale,
  isGeographicIntentDeficit,
  NO_GEOGRAPHIC_GRANT,
  ownedIntentGrant,
  projectGeographicPolicy,
} from './geographic-validation-authorization.util';
import { geographicIntentDeficit } from '../fixtures/geographic-authorization.fixture';

function candidate(
  componentNames: string[],
  overrides: Partial<ExperienceCandidate> = {},
): ExperienceCandidate {
  return {
    name: 'Candidate',
    themes: [],
    traits: [],
    intents: [],
    evidenceKeys: ['ev-1'],
    shortReason: 'grounded',
    componentHints: componentNames.map((name, index) => ({
      key: `c${index}`,
      name,
      role: 'venue' as const,
      expectedKind: 'PLACE' as const,
      evidenceKeys: ['ev-1'],
    })),
    ...overrides,
  };
}

const multiComponent = () => candidate(['Winery A', 'Winery B', 'Winery C']);
const singlePlace = () => candidate(['Winery A']);
const routeLikeGrant = () =>
  ownedIntentGrant('DEDICATED_INTENT', geographicIntentDeficit('route_like'));
const walkGrant = () =>
  ownedIntentGrant('AREA_ROUTE_WALK', geographicIntentDeficit('walk'));

describe('geographic validation authorization', () => {
  it('A: an owning route_like unit authorizes its multi-component candidate as ROUTE_LIKE, with provenance', () => {
    const grant = routeLikeGrant();
    const authorization = authorizeCandidate(grant, multiComponent());
    expect(authorization).toEqual({
      kind: 'ROUTE_LIKE',
      authorizedBy: grant,
      admittedAs: 'MULTI_COMPONENT_EXPERIENCE',
    });
    expect(authorizesRouteScale(authorization)).toBe(true);
    expect(projectGeographicPolicy(authorization)).toEqual({
      kind: 'ROUTE_LIKE',
      workUnit: 'DEDICATED_INTENT',
      ownedIntent: 'route_like',
      ownedDeficit: 'intent:route_like',
      admittedAs: 'MULTI_COMPONENT_EXPERIENCE',
    });
  });

  it('B/K: an owning walk unit authorizes its multi-component candidate as WALK (never route scale)', () => {
    const authorization = authorizeCandidate(walkGrant(), multiComponent());
    expect(authorization.kind).toBe('WALK');
    expect(authorizesRouteScale(authorization)).toBe(false);
    expect(authorizesAnchoredAreaMembership(authorization)).toBe(true);
  });

  it('D: a unit without a grant (generic) leaves a multi-component candidate DEFAULT', () => {
    const authorization = authorizeCandidate(
      NO_GEOGRAPHIC_GRANT,
      multiComponent(),
    );
    expect(authorization).toEqual({ kind: 'DEFAULT' });
    expect(authorizesRouteScale(authorization)).toBe(false);
    expect(authorizesAnchoredAreaMembership(authorization)).toBe(false);
  });

  it('E: candidate self-description (intents, name) never widens a generic candidate', () => {
    const selfClaimed = candidate(['Winery A', 'Winery B'], {
      name: 'Ruta del Vino scenic route walk',
      intents: ['route_like', 'walk'],
    });
    expect(authorizeCandidate(NO_GEOGRAPHIC_GRANT, selfClaimed)).toEqual({
      kind: 'DEFAULT',
    });
  });

  it('H: a single-place candidate inside an owning route_like unit stays DEFAULT', () => {
    expect(authorizeCandidate(routeLikeGrant(), singlePlace())).toEqual({
      kind: 'DEFAULT',
    });
    expect(authorizeCandidate(walkGrant(), singlePlace())).toEqual({
      kind: 'DEFAULT',
    });
  });

  it('uses the canonical shape predicate: the same component duplicated counts once (no widening)', () => {
    expect(
      authorizeCandidate(routeLikeGrant(), candidate(['Winery A', 'winery a'])),
    ).toEqual({ kind: 'DEFAULT' });
  });

  it('candidate.intents neither grants nor denies inside an owning unit', () => {
    const withClaim = candidate(['A', 'B'], { intents: ['visit'] });
    expect(authorizeCandidate(routeLikeGrant(), withClaim).kind).toBe(
      'ROUTE_LIKE',
    );
  });

  it('M: a heterogeneous batch is authorized candidate by candidate', () => {
    const batch = authorizeCandidates(routeLikeGrant(), [
      multiComponent(),
      singlePlace(),
    ]);
    expect(batch.map((item) => item.geographicAuthorization.kind)).toEqual([
      'ROUTE_LIKE',
      'DEFAULT',
    ]);
  });

  it('recognizes only real open walk/route_like preference-facet deficits as policy-bearing', () => {
    expect(isGeographicIntentDeficit(geographicIntentDeficit('walk'))).toBe(
      true,
    );
    expect(
      isGeographicIntentDeficit({
        origin: 'preference_facet',
        dimension: 'theme',
        key: 'route_like',
        reason: 'r',
      }),
    ).toBe(false);
    expect(
      isGeographicIntentDeficit({
        origin: 'preference_facet',
        dimension: 'intent',
        key: 'visit',
        reason: 'r',
      }),
    ).toBe(false);
    expect(
      isGeographicIntentDeficit({
        origin: 'global_capacity',
        reason: 'r',
        currentEligibleCount: 1,
        requiredEligibleCount: 2,
      }),
    ).toBe(false);
  });
});
