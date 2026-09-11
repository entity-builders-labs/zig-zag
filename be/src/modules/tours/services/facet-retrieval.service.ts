/**
 * Per-facet catalog retrieval (spec §6, plan Task A6).
 *
 * Retrieves verified canonical Experiences within a geographic scope and
 * classifies each as a strong match, a weak match, or unrelated to the
 * given facet -- reusing `ExperienceCatalogService`'s canonical geography/
 * hydration boundary rather than a second, arbitrary Prisma bounding-box
 * query. `findVerifiedWithin` already preserves deterministic order,
 * component + trait hydration and true radius filtering; this service only
 * asks it for a large enough `limit` that its own post-radius-filter
 * truncation cannot silently drop a relevant row.
 */
import { Injectable } from '@nestjs/common';
import { ExperienceCatalogService } from './experience-catalog.service';
import {
  FacetCandidates,
  RequestedFacet,
} from '../interfaces/preference-spec.interface';
import { facetSatisfied } from '../utils/preference-sufficiency.util';
import {
  isStrongFacetMatch,
  requestedFacetToPreferenceFacet,
  StrongMatchPolicy,
} from '../utils/preference-strong-match.util';
import { candidateMatchesPreferenceFacet } from '../utils/preference-facet-matching.util';

export interface FacetRetrievalScope {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

/**
 * Passed as `findVerifiedWithin`'s `limit`. Generously larger than any
 * realistic per-request candidate count (spec/plan's own worked examples
 * top out around 20 for a 5-day trip; this covers a destination catalog
 * of hundreds to low thousands of rows) so a relevant row is never lost to
 * the top-N-closest truncation `findVerifiedWithin` applies after its own
 * radius filter.
 */
const FACET_RETRIEVAL_LIMIT = 2000;

interface ScoredRow {
  id: string;
  qualityScore: number | null;
}

/** Strongest-first: higher qualityScore wins; stable id tie-break. */
function byStrengthThenId(a: ScoredRow, b: ScoredRow): number {
  const aQuality =
    typeof a.qualityScore === 'number' ? a.qualityScore : -Infinity;
  const bQuality =
    typeof b.qualityScore === 'number' ? b.qualityScore : -Infinity;
  return bQuality - aQuality || a.id.localeCompare(b.id);
}

@Injectable()
export class FacetRetrievalService {
  constructor(private readonly catalog: ExperienceCatalogService) {}

  async retrieveFacetCandidates(
    facet: RequestedFacet,
    scope: FacetRetrievalScope,
    policy: StrongMatchPolicy = {},
  ): Promise<FacetCandidates> {
    const rows = await this.catalog.findVerifiedWithin(
      scope.latitude,
      scope.longitude,
      scope.radiusMeters,
      FACET_RETRIEVAL_LIMIT,
    );

    const preferenceFacet = requestedFacetToPreferenceFacet(facet);
    const strong: ScoredRow[] = [];
    const weak: ScoredRow[] = [];

    for (const row of rows as Array<Record<string, any>>) {
      const scored: ScoredRow = {
        id: row.id,
        qualityScore:
          typeof row.qualityScore === 'number' ? row.qualityScore : null,
      };
      if (isStrongFacetMatch(row, facet, policy)) {
        strong.push(scored);
      } else if (candidateMatchesPreferenceFacet(row, preferenceFacet)) {
        weak.push(scored);
      }
      // Neither strong nor a base match -> unrelated to this facet, excluded.
    }

    strong.sort(byStrengthThenId);
    weak.sort(byStrengthThenId);

    return {
      facet,
      strongMatches: strong.map((row) => row.id),
      weakMatches: weak.map((row) => row.id),
      satisfied: facetSatisfied(strong.length),
    };
  }
}
