/**
 * Per-facet catalog retrieval (spec §6, plan Task A6; geography boundary
 * hardened by Task A6.1 --
 * docs/superpowers/specs/2026-09-11-postgis-geospatial-catalog-boundary.md).
 *
 * Retrieves verified canonical Experiences within a geographic scope and
 * classifies each as a strong match, a weak match, or unrelated to the
 * given facet -- reusing `ExperienceCatalogService.findVerifiedWithinForMatching`,
 * the canonical PostGIS-backed geography/hydration boundary, rather than a
 * second, arbitrary Prisma bounding-box query.
 *
 * A6 originally called `findVerifiedWithin(..., FACET_RETRIEVAL_LIMIT)`
 * with a generously large constant (2000). That only moved the failure
 * threshold: `findVerifiedWithin` performs a bounded JS/Prisma scan-then-
 * filter that can still truncate a relevant row before semantic matching
 * ever sees it. `findVerifiedWithinForMatching` resolves geographic scope
 * entirely in PostgreSQL/PostGIS with no correctness-visible result cap, so
 * there is no longer a limit constant to pass here at all.
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
    const rows = await this.catalog.findVerifiedWithinForMatching(
      scope.latitude,
      scope.longitude,
      scope.radiusMeters,
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
