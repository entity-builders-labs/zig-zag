import { Injectable } from '@nestjs/common';
import { ActivityKind } from '@prisma/client';
import {
  CoverageAnalysisInput,
  CoverageCandidate,
  CoverageDeficit,
  CoverageReport,
  ThemeCoverageSummary,
} from '../interfaces/coverage-analysis.interface';
import { ExperienceFormat } from '../interfaces/tour-generation.interface';
import { EXPERIENCE_FORMAT_ACTIVITY_KIND } from '../utils/experience-format-kind.util';
import {
  THEME_KEYWORDS,
  matchesThemeKeywords,
} from '../utils/theme-matching.util';

@Injectable()
export class CoverageAnalyzer {
  analyze(input: CoverageAnalysisInput): CoverageReport {
    const eligibleCandidates = input.candidates.filter((candidate) =>
      this.isEligibleCandidate(candidate),
    );
    const requiredCandidateCount = this.requiredCandidateCount(
      input.days,
      input.travelPace,
    );
    const requestedThemeCoverage = input.requestedThemes.map((theme) =>
      this.buildThemeCoverage(theme, eligibleCandidates),
    );
    const kindCoverage = this.buildKindCoverage(eligibleCandidates);
    const sourceCoverage = this.buildSourceCoverage(eligibleCandidates);
    const geographicCoverage = this.buildGeographicCoverage(eligibleCandidates);
    const deficits: CoverageDeficit[] = [];

    if (eligibleCandidates.length === 0) {
      deficits.push({
        reason: 'insufficient_usable_candidates',
        severity: 'blocking',
        message: 'No hay candidatos utilizables y validados en el catálogo.',
        expectedCount: requiredCandidateCount,
        actualCount: 0,
      });
    } else if (eligibleCandidates.length < requiredCandidateCount) {
      deficits.push({
        reason: 'insufficient_usable_candidates',
        severity: 'blocking',
        message:
          'La cantidad de candidatos utilizables no alcanza para cubrir los días solicitados.',
        expectedCount: requiredCandidateCount,
        actualCount: eligibleCandidates.length,
      });
    }

    requestedThemeCoverage
      .filter((themeCoverage) => themeCoverage.strongMatchCount === 0)
      .forEach((themeCoverage) => {
        deficits.push({
          reason: 'missing_requested_theme',
          severity: 'blocking',
          message: `Falta cobertura significativa para el tema solicitado "${themeCoverage.theme}".`,
          theme: themeCoverage.theme,
          expectedCount: 1,
          actualCount: 0,
        });
      });

    (input.requestedExperienceFormats ?? [])
      .filter((format) => {
        const kind =
          EXPERIENCE_FORMAT_ACTIVITY_KIND[format as ExperienceFormat];
        return (
          kind != null &&
          !kindCoverage.some((k) => k.kind === kind && k.count > 0)
        );
      })
      .forEach((format) => {
        const kind =
          EXPERIENCE_FORMAT_ACTIVITY_KIND[format as ExperienceFormat];
        deficits.push({
          reason: 'missing_requested_experience_format',
          severity: 'blocking',
          message: `Falta cobertura para el formato de experiencia solicitado "${format}" (kind ${kind}).`,
          experienceFormat: format,
          expectedCount: 1,
          actualCount: 0,
        });
      });

    if (eligibleCandidates.length >= 3 && kindCoverage.length < 2) {
      deficits.push({
        reason: 'insufficient_kind_diversity',
        severity: 'warning',
        message:
          'El pool elegible está demasiado concentrado en un único kind estructural.',
        expectedCount: 2,
        actualCount: kindCoverage.length,
      });
    }

    if (sourceCoverage.length === 0) {
      deficits.push({
        reason: 'insufficient_source_diversity',
        severity: 'warning',
        message:
          'No hay evidencia de procedencia utilizable en el pool elegible.',
        expectedCount: 1,
        actualCount: 0,
      });
    }

    if (
      eligibleCandidates.length >= 4 &&
      geographicCoverage.distinctClusterCount < 2
    ) {
      deficits.push({
        reason: 'insufficient_geographic_distribution',
        severity: 'warning',
        message:
          'Los candidatos elegibles están excesivamente concentrados en una sola zona del destino.',
        expectedCount: 2,
        actualCount: geographicCoverage.distinctClusterCount,
      });
    }

    if (
      input.requestedThemes.length > 0 &&
      input.semanticCoverage.status === 'unavailable' &&
      input.semanticCoverage.indexedCandidateCount === 0
    ) {
      deficits.push({
        reason: 'insufficient_semantic_coverage',
        severity: 'warning',
        message:
          'No hay embeddings compatibles para medir afinidad semántica tema por tema.',
        expectedCount: input.requestedThemes.length,
        actualCount: 0,
      });
    }

    const providerHealth = input.providerHealth ?? {
      status: 'unknown' as const,
    };
    const blockingDeficits = deficits.filter(
      (deficit) => deficit.severity === 'blocking',
    );

    let status: CoverageReport['status'] = 'sufficient';
    let decision: CoverageReport['decision'] = {
      action: 'none',
      reason: 'coverage_sufficient',
      deployableInPr6: true,
    };

    if (blockingDeficits.length > 0) {
      if (
        eligibleCandidates.length === 0 &&
        providerHealth.status === 'degraded'
      ) {
        status = 'degraded';
        decision = {
          action: 'fail',
          reason: 'provider_degraded_without_usable_pool',
          deployableInPr6: true,
          deficits,
        };
      } else if (eligibleCandidates.length === 0) {
        status = 'insufficient';
        decision = {
          action: 'fail',
          reason: 'no_usable_candidates',
          deployableInPr6: true,
          deficits,
        };
      } else if (
        blockingDeficits.some(
          (deficit) => deficit.reason === 'missing_requested_experience_format',
        )
      ) {
        // Structural format gaps outrank conventional theme refill. If both
        // coexist, the orchestrator still receives the complete deficits list
        // and may run POI refill for the theme/quantity gap, but the decision
        // must advertise the grounded-discovery obligation rather than hide it
        // behind "places_text_search".
        status =
          providerHealth.status === 'degraded' ? 'degraded' : 'insufficient';
        decision = {
          action: 'defer_to_pr7_grounded_gap',
          reason: 'qualitative_gap_requires_activity_discovery',
          deployableInPr6: false,
          deficits,
        };
      } else if (
        blockingDeficits.some(
          (deficit) => deficit.reason === 'missing_requested_theme',
        )
      ) {
        status =
          providerHealth.status === 'degraded' ? 'degraded' : 'insufficient';
        decision = {
          action: 'places_text_search',
          reason: 'missing_requested_theme',
          deployableInPr6: true,
          deficits,
        };
      } else {
        status =
          providerHealth.status === 'degraded' ? 'degraded' : 'insufficient';
        decision = {
          action: 'fail',
          reason:
            eligibleCandidates.length === 0
              ? 'no_usable_candidates'
              : 'insufficient_coverage_after_catalog_analysis',
          deployableInPr6: true,
          deficits,
        };
      }
    }

    return {
      status,
      analyzedCandidateCount: input.candidates.length,
      eligibleCandidateCount: eligibleCandidates.length,
      offeredCandidateCount: input.offeredCandidateCount,
      usableCandidateCount: eligibleCandidates.length,
      requiredCandidateCount,
      requestedThemeCoverage,
      kindCoverage,
      sourceCoverage,
      geographicCoverage,
      semanticCoverage: input.semanticCoverage,
      destinationKnowledge: {
        status: 'unsupported_until_pr7',
        deployableBoundary: 'catalog_quality_only_until_pr7',
        reason:
          'PR 6 mejora el quality gate del catálogo pero no toma ownership del destination knowledge persistido ni ejecuta grounded discovery; esa frontera se extiende en PR 7.',
      },
      providerHealth,
      deficits,
      decision,
    };
  }

  /**
   * Bug fix: this previously compared against 'relaxed'/'fast_paced' while
   * being fed `explorationStyle` (real values: 'iconic'/'balanced'/
   * 'local_deep_dive') — neither string ever matched, so every request
   * silently fell through to the 4-stops/day default regardless of what
   * the user picked. 'relaxed' does match TravelPace.RELAXED, and stop
   * density per day is fundamentally a pace question (how much fits in a
   * day), not an exploration-style one — so this now reads `travelPace`
   * instead, with 'fast_paced' corrected to TravelPace.FAST's real value.
   */
  private requiredCandidateCount(days: number, travelPace?: string): number {
    const normalizedDays = Math.max(1, Math.min(days || 1, 14));
    const expectedStopsPerDay =
      travelPace === 'relaxed' ? 3 : travelPace === 'fast' ? 5 : 4;
    return normalizedDays * expectedStopsPerDay;
  }

  private buildThemeCoverage(
    theme: string,
    candidates: CoverageCandidate[],
  ): ThemeCoverageSummary {
    const normalizedTheme = theme.trim().toLowerCase();
    const keywords = THEME_KEYWORDS[normalizedTheme] ?? [normalizedTheme];
    const matchingCandidates = candidates.filter((candidate) =>
      matchesThemeKeywords(candidate, keywords),
    );
    return {
      theme,
      matchedCandidateCount: matchingCandidates.length,
      strongMatchCount: matchingCandidates.length,
    };
  }

  private buildKindCoverage(candidates: CoverageCandidate[]) {
    const counts = new Map<ActivityKind | 'unknown', number>();
    for (const candidate of candidates) {
      const key = candidate.kind ?? 'unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  }

  private buildSourceCoverage(candidates: CoverageCandidate[]) {
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      const key = candidate.source?.trim() || 'unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([source, count]) => ({ source, count }));
  }

  private buildGeographicCoverage(candidates: CoverageCandidate[]) {
    const thresholdKilometers = 2;
    const clusters: number[] = [];

    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.distanceKm)) continue;
      const distanceKm = candidate.distanceKm as number;
      const existingCluster = clusters.find(
        (cluster) => Math.abs(cluster - distanceKm) <= thresholdKilometers,
      );
      if (existingCluster == null) {
        clusters.push(distanceKm);
      }
    }

    return {
      distinctClusterCount: clusters.length,
      thresholdKilometers,
    };
  }

  private isEligibleCandidate(candidate: CoverageCandidate): boolean {
    // Catalog rows surfaced by ActivitiesService.findAll already exclude AREA
    // and archived rows. A candidate is eligible for coverage analysis as long
    // as it is a real, identifiable catalog entity (it has an id). Row-level
    // junk filtering is a write-side concern for legacy rows; the coverage gate
    // operates on the verified pool rather than an empty query.
    return typeof candidate.id === 'string' && candidate.id.trim().length > 0;
  }
}
