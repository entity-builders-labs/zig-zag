import { normalizeGeoName } from '../../../../be/src/modules/tours/utils/nominatim-match.util';
import {
  Assertion,
  AssertionSubject,
  CorridorSubject,
  EvidenceCapture,
  FacetKey,
  GeoEntityRef,
  GroundingResult,
  KnowledgeGap,
  ProposedClaim,
  RejectionReason,
  SupportLevel,
} from '../contracts';
import { WALKING_FORMAT_FACET, mapClaimThemes } from '../facets';
import { anchorOnLine, clipBetween, clipToArea, containsPoint, lineVertices } from '../geometry';
import { assertionKey, canonicalizeCorridor } from '../keys';
import { CompositionPolicy } from '../policy';
import { normalizeWhitespace } from '../research/documents';
import { registrableDomain } from '../research/domain';
import { WebTools } from '../research/tools';
import { CatalogStore, GroundingAuthority } from '../stores';
import { GeoResolver, IdentityResult, recordResolved } from './identity';
import { hasSignal, publisherOf, verifyProvenance } from './provenance';
import { SupportVerifier, VerifierUnavailable } from './support-verifier';

const GROUNDING = new GroundingAuthority();

/**
 * Source capability (design D8 step 3): captures whose source is one of the
 * integrated GEOGRAPHIC providers can establish identity/geometry/
 * walkability, never tourism relevance. This is a capability table of the
 * providers we integrate as identity sources, not an authority allowlist.
 */
const GEOGRAPHIC_DATA_DOMAINS = new Set(['openstreetmap.org', 'overturemaps.org']);
const GEOGRAPHIC_DATASETS = new Set(['openstreetmap', 'nominatim', 'overture']);

export function isGeographicDataCapture(capture: EvidenceCapture): boolean {
  return capture.locator.kind === 'URL'
    ? GEOGRAPHIC_DATA_DOMAINS.has(registrableDomain(capture.locator.url))
    : GEOGRAPHIC_DATASETS.has(capture.locator.dataset);
}

export interface FacetSupport {
  capture: EvidenceCapture;
  level: SupportLevel;
}

export type Sufficiency =
  | { status: 'AUTHORIZED'; basis: 'SINGLE_VERIFIED_EXPLICIT' | 'INDEPENDENT_CORROBORATION' }
  | { status: 'REJECTED'; reason: 'INSUFFICIENT_CORROBORATION' | 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM' };

/**
 * Spike sufficiency rule (design D8 step 4). Inputs are VERIFIED-provenance
 * captures with their support level for ONE claim facet. No domain list and
 * no government special case participate.
 */
export function sufficiency(supports: FacetSupport[]): Sufficiency {
  const reproducible = supports.filter((s) => hasSignal(s.capture, 'REPRODUCIBLE'));
  const single = reproducible.find((s) => s.level === 'EXPLICIT' && hasSignal(s.capture, 'PUBLISHER_ESTABLISHED'));
  if (single) return { status: 'AUTHORIZED', basis: 'SINGLE_VERIFIED_EXPLICIT' };
  const supporting = reproducible.filter((s) => s.level !== 'NONE');
  for (const a of supporting) {
    if (a.level !== 'EXPLICIT') continue;
    if (supporting.some((b) => b !== a && publisherOf(b.capture) !== publisherOf(a.capture))) {
      return { status: 'AUTHORIZED', basis: 'INDEPENDENT_CORROBORATION' };
    }
  }
  return supporting.length > 0
    ? { status: 'REJECTED', reason: 'INSUFFICIENT_CORROBORATION' }
    : { status: 'REJECTED', reason: 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM' };
}

export interface GroundingDeps {
  store: CatalogStore;
  tools: WebTools;
  resolver: GeoResolver;
  verifier: SupportVerifier;
  destination: GeoEntityRef;
  policy: CompositionPolicy;
  now: () => string;
}

/** Equivalent proposed claims are merged so their captures can corroborate. */
export function mergeEquivalentClaims(claims: ProposedClaim[]): ProposedClaim[] {
  const groups = new Map<string, ProposedClaim>();
  for (const c of claims) {
    const key = [c.claimType, c.subjectMention, c.areaMention ?? '', c.fromMention ?? '', c.toMention ?? ''].map((v) => normalizeGeoName(v)).join('|');
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...c, captures: [...c.captures], proposedThemes: [...c.proposedThemes] });
      continue;
    }
    const seen = new Set(existing.captures.map((x) => x.id));
    existing.captures.push(...c.captures.filter((x) => !seen.has(x.id)));
    existing.proposedThemes = [...new Set([...existing.proposedThemes, ...c.proposedThemes])];
  }
  return [...groups.values()];
}

type Resolved = { kind: 'ok'; entity: Extract<IdentityResult, { status: 'RESOLVED' }> };
type Stop = { kind: 'stop'; result: GroundingResult };

function identityStop(claim: ProposedClaim, result: Exclude<IdentityResult, { status: 'RESOLVED' }>, what: string): Stop {
  if (result.status === 'UNAVAILABLE') return { kind: 'stop', result: { status: 'FAILED', claim, reason: 'RESOLUTION_UNAVAILABLE', detail: `${what}: ${result.detail}` } };
  const reason: RejectionReason =
    result.status === 'AMBIGUOUS' ? 'IDENTITY_AMBIGUOUS' : result.status === 'INCOMPATIBLE' ? 'DESTINATION_INCOMPATIBLE' : 'IDENTITY_NOT_FOUND';
  return { kind: 'stop', result: { status: 'REJECTED', claim, reason, detail: `${what}: ${result.detail}` } };
}

function asResolved(claim: ProposedClaim, result: IdentityResult, what: string): Resolved | Stop {
  return result.status === 'RESOLVED' ? { kind: 'ok', entity: result } : identityStop(claim, result, what);
}

function mentionedIn(texts: string[], mention: string | undefined): boolean {
  if (!mention) return false;
  const m = normalizeGeoName(mention);
  return texts.some((t) => normalizeGeoName(t).includes(m));
}

/** Plan of what to persist for an authorized claim (resolved, not yet recorded). */
interface SubjectPlan {
  entities: Array<Extract<IdentityResult, { status: 'RESOLVED' }>>;
  subject: (ids: string[]) => AssertionSubject;
  statement: { subject: string; area?: string; from?: string; to?: string };
}

async function planSubject(deps: GroundingDeps, gap: KnowledgeGap, claim: ProposedClaim, texts: string[]): Promise<SubjectPlan | Stop> {
  const scope = { destination: deps.destination };
  const snapshot = deps.store.snapshot();

  if (claim.claimType === 'RELEVANT_FOR') {
    const expectsArea = gap.type === 'AREA_RELEVANCE' || gap.type === 'SCHEDULE_CAPACITY';
    const gapArea = snapshot.geoEntities[gap.scopeGeoEntityId];
    const r = expectsArea
      ? await deps.resolver.resolveArea(claim.subjectMention, scope)
      : await deps.resolver.resolvePlace(claim.subjectMention, { ...scope, ...(gapArea?.kind === 'AREA' ? { area: gapArea } : {}) });
    const s = asResolved(claim, r, 'subject');
    if (s.kind === 'stop') return s;
    if (!containsPoint(deps.destination.geometry, s.entity.entity.centroid)) {
      return { kind: 'stop', result: { status: 'REJECTED', claim, reason: 'DESTINATION_INCOMPATIBLE', detail: 'subject outside destination' } };
    }
    return { entities: [s.entity], subject: ([id]) => ({ kind: 'GEO_ENTITY', geoEntityId: id }), statement: { subject: s.entity.entity.name } };
  }

  if (claim.claimType === 'NOTABLE_WITHIN') {
    const areaMention = claim.areaMention ?? snapshot.geoEntities[gap.scopeGeoEntityId]?.name;
    if (!areaMention) return { kind: 'stop', result: { status: 'REJECTED', claim, reason: 'IDENTITY_NOT_FOUND', detail: 'no area for NOTABLE_WITHIN' } };
    const a = asResolved(claim, await deps.resolver.resolveArea(areaMention, scope), 'area');
    if (a.kind === 'stop') return a;
    const p = asResolved(
      claim,
      await deps.resolver.resolvePlace(claim.subjectMention, { ...scope, area: a.entity.entity, areaNamedBySource: !!claim.areaMention }),
      'place',
    );
    if (p.kind === 'stop') return p;
    if (!containsPoint(a.entity.entity.geometry, p.entity.entity.centroid)) {
      return { kind: 'stop', result: { status: 'REJECTED', claim, reason: 'GEOMETRY_INCONSISTENT', detail: `${p.entity.entity.name} lies outside ${a.entity.entity.name}` } };
    }
    return {
      entities: [p.entity, a.entity],
      subject: ([placeId, areaId]) => ({ kind: 'PLACE_IN_AREA', placeGeoEntityId: placeId, areaGeoEntityId: areaId }),
      statement: { subject: p.entity.entity.name, area: a.entity.entity.name },
    };
  }

  // WALKING_CORRIDOR
  const route = asResolved(claim, await deps.resolver.resolveRoute(claim.subjectMention, scope), 'route');
  if (route.kind === 'stop') return route;
  const vertices = lineVertices(route.entity.entity.geometry);
  const stated = mentionedIn(texts, claim.fromMention) && mentionedIn(texts, claim.toMention);
  if (stated) {
    const anchorScope = { ...scope, nearRoute: { vertices, toleranceMeters: deps.policy.anchorOnRouteToleranceMeters } };
    const resolveAnchor = async (mention: string) => {
      const place = await deps.resolver.resolvePlace(mention, anchorScope);
      return place.status === 'RESOLVED' || place.status === 'UNAVAILABLE' ? place : deps.resolver.resolveArea(mention, scope);
    };
    const from = asResolved(claim, await resolveAnchor(claim.fromMention as string), 'corridor start');
    if (from.kind === 'stop') return from;
    const to = asResolved(claim, await resolveAnchor(claim.toMention as string), 'corridor end');
    if (to.kind === 'stop') return to;
    for (const anchor of [from.entity.entity, to.entity.entity]) {
      const meters = anchorOnLine(anchor.geometry, vertices).meters;
      if (meters > deps.policy.anchorOnRouteToleranceMeters) {
        return { kind: 'stop', result: { status: 'REJECTED', claim, reason: 'GEOMETRY_INCONSISTENT', detail: `${anchor.name} is ${Math.round(meters)} m from ${route.entity.entity.name}` } };
      }
    }
    if (clipBetween(vertices, anchorOnLine(from.entity.entity.geometry, vertices).point, anchorOnLine(to.entity.entity.geometry, vertices).point).length < 2) {
      return { kind: 'stop', result: { status: 'REJECTED', claim, reason: 'GEOMETRY_INCONSISTENT', detail: 'anchors do not bound a stretch of the route' } };
    }
    return {
      entities: [route.entity, from.entity, to.entity],
      subject: ([routeId, fromId, toId]) => ({
        kind: 'CORRIDOR',
        corridor: canonicalizeCorridor({ routeGeoEntityId: routeId, from: { kind: 'GEO_ENTITY', geoEntityId: fromId }, to: { kind: 'GEO_ENTITY', geoEntityId: toId }, boundKind: 'STATED_ANCHORS' }),
      }),
      statement: { subject: route.entity.entity.name, from: from.entity.entity.name, to: to.entity.entity.name },
    };
  }
  if (mentionedIn(texts, claim.areaMention)) {
    const area = asResolved(claim, await deps.resolver.resolveArea(claim.areaMention as string, scope), 'corridor area');
    if (area.kind === 'stop') return area;
    if (clipToArea(vertices, area.entity.entity.geometry).length < 2) {
      return { kind: 'stop', result: { status: 'REJECTED', claim, reason: 'GEOMETRY_INCONSISTENT', detail: `${route.entity.entity.name} does not cross ${area.entity.entity.name}` } };
    }
    return {
      entities: [route.entity, area.entity],
      subject: ([routeId, areaId]): AssertionSubject => {
        const corridor: CorridorSubject = {
          routeGeoEntityId: routeId, from: { kind: 'AREA_CLIP', areaGeoEntityId: areaId }, to: { kind: 'AREA_CLIP', areaGeoEntityId: areaId }, boundKind: 'AREA_CLIP',
        };
        return { kind: 'CORRIDOR', corridor };
      },
      statement: { subject: route.entity.entity.name, area: area.entity.entity.name },
    };
  }
  return { kind: 'stop', result: { status: 'REJECTED', claim, reason: 'CORRIDOR_BOUNDS_UNRESOLVED', detail: 'evidence states neither both endpoints nor an area' } };
}

/**
 * Grounding (spec `knowledge-grounding`): the sole authority turning
 * proposed claims into L2 assertions. Writes L1 only via resolution results
 * and L2 only with its own authority.
 */
export async function groundClaims(deps: GroundingDeps, gap: KnowledgeGap, proposed: ProposedClaim[]): Promise<GroundingResult[]> {
  const results: GroundingResult[] = [];
  for (const claim of mergeEquivalentClaims(proposed)) {
    results.push(await groundOne(deps, gap, claim));
  }
  return results;
}

async function groundOne(deps: GroundingDeps, gap: KnowledgeGap, claim: ProposedClaim): Promise<GroundingResult> {
  const themed = mapClaimThemes(claim.proposedThemes).filter((f) => f !== WALKING_FORMAT_FACET);
  const facets: FacetKey[] = claim.claimType === 'WALKING_CORRIDOR' ? [WALKING_FORMAT_FACET, ...themed] : themed;
  if (facets.length === 0) return { status: 'REJECTED', claim, reason: 'NO_CANONICAL_FACET', detail: claim.proposedThemes.join(', ') };

  const capable = claim.captures.filter((c) => !isGeographicDataCapture(c));
  if (capable.length === 0) {
    return { status: 'REJECTED', claim, reason: 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM', detail: 'geographic data sources cannot establish tourism relevance' };
  }

  const checks = await Promise.all(capable.map((c) => verifyProvenance(c, deps.tools)));
  const verified = checks.filter((c) => c.status === 'VERIFIED').map((c) => c.capture);
  if (verified.length === 0) {
    const unavailable = checks.find((c) => c.status === 'UNAVAILABLE');
    return unavailable
      ? { status: 'FAILED', claim, reason: 'FETCH_UNAVAILABLE', detail: unavailable.status === 'UNAVAILABLE' ? unavailable.detail : '' }
      : { status: 'REJECTED', claim, reason: 'EVIDENCE_NOT_REPRODUCIBLE' };
  }

  const texts = verified.map((c) => (c.capture.kind === 'PROSE_SPAN' ? c.capture.text : Object.values(c.capture.values).join(' ')));
  const plan = await planSubject(deps, gap, claim, texts);
  if ('kind' in plan) return plan.result;

  // Support per facet over verified captures.
  const supportsByFacet = new Map<FacetKey, FacetSupport[]>();
  const annotated = new Map(verified.map((c) => [c.id, { ...c, supportVerdicts: [...c.supportVerdicts] }]));
  try {
    for (const facet of facets) {
      const supports: FacetSupport[] = [];
      for (const capture of verified) {
        const verdict = await deps.verifier.judge(
          { claimKey: `${claim.claimType}|${normalizeWhitespace(plan.statement.subject)}|${facet}`, claimType: claim.claimType, facet, ...plan.statement },
          capture,
        );
        annotated.get(capture.id)?.supportVerdicts.push(verdict);
        supports.push({ capture, level: verdict.level });
      }
      supportsByFacet.set(facet, supports);
    }
  } catch (error) {
    if (error instanceof VerifierUnavailable) return { status: 'FAILED', claim, reason: 'VERIFIER_UNAVAILABLE', detail: error.message };
    throw error;
  }

  const authorizedFacets: FacetKey[] = [];
  const facetRejections: Array<{ facetKey: FacetKey; reason: RejectionReason }> = [];
  for (const facet of facets) {
    const verdict = sufficiency(supportsByFacet.get(facet) ?? []);
    if (verdict.status === 'AUTHORIZED') authorizedFacets.push(facet);
    else facetRejections.push({ facetKey: facet, reason: verdict.reason });
  }
  // A corridor is authorized only when walking itself is supported.
  if (claim.claimType === 'WALKING_CORRIDOR' && !authorizedFacets.includes(WALKING_FORMAT_FACET)) {
    const walk = facetRejections.find((r) => r.facetKey === WALKING_FORMAT_FACET);
    return { status: 'REJECTED', claim, reason: walk?.reason ?? 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM', detail: 'walking along the street is not supported' };
  }
  if (authorizedFacets.length === 0) {
    return { status: 'REJECTED', claim, reason: facetRejections[0]?.reason ?? 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM', detail: facetRejections.map((r) => `${r.facetKey}:${r.reason}`).join(', ') };
  }

  // Persist: L1 through resolution results, then L2 with grounding authority.
  const ids = plan.entities.map((e) => recordResolved(deps.store, e).id);
  const subject = plan.subject(ids);
  const assertions: Assertion[] = authorizedFacets.map((facetKey) => {
    const evidence = (supportsByFacet.get(facetKey) ?? [])
      .filter((s) => s.level !== 'NONE')
      .map((s) => annotated.get(s.capture.id) as EvidenceCapture);
    const assertion: Assertion = {
      key: assertionKey(claim.claimType, subject, facetKey),
      claimType: claim.claimType,
      subject,
      facetKey,
      destinationId: deps.destination.id,
      evidence,
      status: 'ACTIVE',
      createdAt: deps.now(),
    };
    deps.store.upsertAssertion(GROUNDING, assertion);
    return assertion;
  });
  return { status: 'AUTHORIZED', claim, assertions, facetRejections };
}

/** Administrative retraction used by the mutation checks (L2 authority). */
export function retractAssertion(store: CatalogStore, key: string): void {
  store.retractAssertion(GROUNDING, key);
}
