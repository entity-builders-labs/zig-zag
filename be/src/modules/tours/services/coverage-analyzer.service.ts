import { Injectable } from '@nestjs/common';
import {
  CoverageAnalysisInput,
  CoverageCandidate,
  CoverageDeficit,
  CoverageReport,
  ThemeCoverageSummary,
} from '../interfaces/coverage-analysis.interface';
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
          severity: 'warning',
          message: `La cobertura del tema solicitado "${themeCoverage.theme}" es baja; se priorizará en el ranking sin bloquear el tour.`,
          theme: themeCoverage.theme,
          expectedCount: 1,
          actualCount: 0,
        });
      });

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
      requiresAdditionalDiscovery: false,
    };

    const advisoryThemeGaps = deficits.filter(
      (deficit) => deficit.reason === 'missing_requested_theme',
    );
    if (advisoryThemeGaps.length > 0 && blockingDeficits.length === 0) {
      decision = {
        action: 'places_text_search',
        reason: 'missing_requested_theme',
        requiresAdditionalDiscovery: false,
        deficits: advisoryThemeGaps,
      };
    }

    if (blockingDeficits.length > 0) {
      if (
        eligibleCandidates.length === 0 &&
        providerHealth.status === 'degraded'
      ) {
        status = 'degraded';
        decision = {
          action: 'fail',
          reason: 'provider_degraded_without_usable_pool',
          requiresAdditionalDiscovery: false,
          deficits,
        };
      } else if (eligibleCandidates.length === 0) {
        status = 'insufficient';
        decision = {
          action: 'fail',
          reason: 'no_usable_candidates',
          requiresAdditionalDiscovery: false,
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
          requiresAdditionalDiscovery: false,
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
          requiresAdditionalDiscovery: false,
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
      sourceCoverage,
      geographicCoverage,
      semanticCoverage: input.semanticCoverage,
      destinationKnowledge: {
        status: 'discovery_supported',
        coverageBoundary: 'catalog_and_grounded_discovery',
        reason:
          'El catálogo se evalúa primero y, cuando faltan temas o formatos solicitados, el motor puede ampliar la cobertura mediante discovery grounded antes de planificar.',
      },
      providerHealth,
      deficits,
      decision,
    };
  }

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
    return typeof candidate.id === 'string' && candidate.id.trim().length > 0;
  }
}
