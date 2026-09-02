import { Injectable } from '@nestjs/common';
import {
  CoverageAnalysisInput,
  CoverageCandidate,
  CoverageDeficit,
  CoverageReport,
  IntentCoverageSummary,
  ThemeCoverageSummary,
  TraitCoverageSummary,
} from '../interfaces/coverage-analysis.interface';
import { THEME_KEYWORDS, matchesThemeKeywords } from '../utils/theme-matching.util';

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

    const requestedThemeCoverage = (input.requestedThemes ?? []).map((theme) =>
      this.buildThemeCoverage(theme, eligibleCandidates),
    );
    const requestedTraitCoverage = (input.requestedTraits ?? []).map((trait) =>
      this.buildTraitCoverage(trait, eligibleCandidates),
    );
    const requestedIntentCoverage = (input.requestedIntents ?? []).map((intent) =>
      this.buildIntentCoverage(intent, eligibleCandidates),
    );

    const relevantCandidates = eligibleCandidates.filter((candidate) =>
      this.isRelevant(candidate, input),
    );
    const sourceCoverage = this.buildSourceCoverage(relevantCandidates);
    const geographicCoverage = this.buildGeographicCoverage(relevantCandidates);
    const deficits: CoverageDeficit[] = [];

    if (eligibleCandidates.length === 0) {
      deficits.push({
        reason: 'insufficient_usable_candidates',
        severity: 'blocking',
        message: 'No hay candidatos utilizables y validados en el catálogo.',
        expectedCount: requiredCandidateCount,
        actualCount: 0,
      });
    } else if (relevantCandidates.length < requiredCandidateCount) {
      deficits.push({
        reason: 'insufficient_usable_candidates',
        severity: 'blocking',
        message:
          'El catálogo tiene candidatos, pero no suficientes candidatos relevantes para cubrir la solicitud.',
        expectedCount: requiredCandidateCount,
        actualCount: relevantCandidates.length,
      });
    }

    requestedThemeCoverage
      .filter((coverage) => coverage.strongMatchCount === 0)
      .forEach((coverage) =>
        deficits.push({
          reason: 'missing_requested_theme',
          severity: 'blocking',
          message: `No hay coverage verificable para el tema solicitado "${coverage.theme}".`,
          theme: coverage.theme,
          expectedCount: 1,
          actualCount: 0,
        }),
      );

    requestedTraitCoverage
      .filter((coverage) => coverage.strongMatchCount === 0)
      .forEach((coverage) =>
        deficits.push({
          reason: 'missing_requested_trait',
          severity: 'blocking',
          message: `No hay coverage verificable para el trait solicitado "${coverage.trait}".`,
          trait: coverage.trait,
          expectedCount: 1,
          actualCount: 0,
        }),
      );

    requestedIntentCoverage
      .filter((coverage) => coverage.strongMatchCount === 0)
      .forEach((coverage) =>
        deficits.push({
          reason: 'missing_requested_intent',
          severity: 'blocking',
          message: `No hay coverage verificable para el intent/archetype solicitado "${coverage.intent}".`,
          intent: coverage.intent,
          expectedCount: 1,
          actualCount: 0,
        }),
      );

    if (input.preferredDurationMinutes) {
      const durationMatches = relevantCandidates.filter((candidate) =>
        this.matchesDuration(candidate, input.preferredDurationMinutes),
      ).length;
      if (durationMatches < Math.min(requiredCandidateCount, relevantCandidates.length)) {
        deficits.push({
          reason: 'insufficient_duration_fit',
          severity: 'warning',
          message: 'La cobertura relevante no encaja suficientemente en la duración preferida.',
          expectedCount: Math.min(requiredCandidateCount, relevantCandidates.length),
          actualCount: durationMatches,
        });
      }
    }

    if (relevantCandidates.length >= 4 && geographicCoverage.distinctClusterCount < 2) {
      deficits.push({
        reason: 'insufficient_geographic_distribution',
        severity: 'warning',
        message: 'Los candidatos relevantes están excesivamente concentrados en una sola zona.',
        expectedCount: 2,
        actualCount: geographicCoverage.distinctClusterCount,
      });
    }

    if (
      this.hasSemanticIntent(input) &&
      input.semanticCoverage.status === 'unavailable' &&
      input.semanticCoverage.indexedCandidateCount === 0
    ) {
      deficits.push({
        reason: 'insufficient_semantic_coverage',
        severity: 'warning',
        message: 'No hay embeddings compatibles para medir afinidad semántica.',
        expectedCount:
          (input.requestedThemes?.length ?? 0) +
          (input.requestedTraits?.length ?? 0) +
          (input.requestedIntents?.length ?? 0),
        actualCount: 0,
      });
    }

    const providerHealth = input.providerHealth ?? { status: 'unknown' as const };
    const blockingDeficits = deficits.filter((deficit) => deficit.severity === 'blocking');

    let status: CoverageReport['status'] = 'sufficient';
    let decision: CoverageReport['decision'] = {
      action: 'none',
      reason: 'coverage_sufficient',
      requiresAdditionalDiscovery: false,
    };

    if (blockingDeficits.length > 0) {
      if (eligibleCandidates.length === 0 && providerHealth.status === 'degraded') {
        status = 'degraded';
        decision = {
          action: 'fail',
          reason: 'provider_degraded_without_usable_pool',
          requiresAdditionalDiscovery: false,
          deficits,
        };
      } else if (eligibleCandidates.length === 0 && !this.hasRequestedCoverage(input)) {
        status = 'insufficient';
        decision = {
          action: 'fail',
          reason: 'no_usable_candidates',
          requiresAdditionalDiscovery: false,
          deficits,
        };
      } else {
        status = providerHealth.status === 'degraded' ? 'degraded' : 'insufficient';
        decision = {
          action: 'needs_additional_discovery',
          reason: 'requested_coverage_is_missing',
          requiresAdditionalDiscovery: true,
          deficits: blockingDeficits,
        };
      }
    }

    return {
      status,
      analyzedCandidateCount: input.candidates.length,
      eligibleCandidateCount: eligibleCandidates.length,
      relevantCandidateCount: relevantCandidates.length,
      offeredCandidateCount: input.offeredCandidateCount,
      usableCandidateCount: relevantCandidates.length,
      requiredCandidateCount,
      requestedThemeCoverage,
      requestedTraitCoverage,
      requestedIntentCoverage,
      sourceCoverage,
      geographicCoverage,
      semanticCoverage: input.semanticCoverage,
      destinationKnowledge: {
        status: 'discovery_supported',
        coverageBoundary: 'catalog_and_grounded_discovery',
        reason:
          'El catálogo se evalúa primero por relevancia; sólo los déficits concretos habilitan discovery grounded.',
      },
      providerHealth,
      deficits,
      decision,
    };
  }

  private requiredCandidateCount(days: number, travelPace?: string): number {
    const normalizedDays = Math.max(1, Math.min(days || 1, 14));
    const expectedStopsPerDay = travelPace === 'relaxed' ? 3 : travelPace === 'fast' ? 5 : 4;
    return normalizedDays * expectedStopsPerDay;
  }

  private buildThemeCoverage(theme: string, candidates: CoverageCandidate[]): ThemeCoverageSummary {
    const normalizedTheme = this.normalize(theme);
    const keywords = THEME_KEYWORDS[normalizedTheme] ?? [normalizedTheme];
    const matchingCandidates = candidates.filter((candidate) =>
      (candidate.themes ?? []).some((value) => keywords.includes(this.normalize(value))) ||
      matchesThemeKeywords(candidate, keywords),
    );
    return { theme, matchedCandidateCount: matchingCandidates.length, strongMatchCount: matchingCandidates.length };
  }

  private buildTraitCoverage(trait: string, candidates: CoverageCandidate[]): TraitCoverageSummary {
    const normalized = this.normalize(trait);
    const matchingCandidates = candidates.filter((candidate) =>
      (candidate.traits ?? []).some((value) => this.normalize(value) === normalized),
    );
    return { trait, matchedCandidateCount: matchingCandidates.length, strongMatchCount: matchingCandidates.length };
  }

  private buildIntentCoverage(intent: string, candidates: CoverageCandidate[]): IntentCoverageSummary {
    const normalized = this.normalize(intent);
    const matchingCandidates = candidates.filter((candidate) =>
      (candidate.intents ?? []).some((value) => this.normalize(value) === normalized),
    );
    return { intent, matchedCandidateCount: matchingCandidates.length, strongMatchCount: matchingCandidates.length };
  }

  private isRelevant(candidate: CoverageCandidate, input: CoverageAnalysisInput): boolean {
    if (!this.hasRequestedCoverage(input)) return true;
    const themeMatches = (input.requestedThemes ?? []).some((theme) =>
      this.buildThemeCoverage(theme, [candidate]).strongMatchCount > 0,
    );
    const traitMatches = (input.requestedTraits ?? []).some((trait) =>
      this.buildTraitCoverage(trait, [candidate]).strongMatchCount > 0,
    );
    const intentMatches = (input.requestedIntents ?? []).some((intent) =>
      this.buildIntentCoverage(intent, [candidate]).strongMatchCount > 0,
    );
    return themeMatches || traitMatches || intentMatches;
  }

  private matchesDuration(
    candidate: CoverageCandidate,
    range?: { min?: number; max?: number },
  ): boolean {
    if (!range || !Number.isFinite(candidate.durationMinutes)) return true;
    const value = candidate.durationMinutes as number;
    if (Number.isFinite(range.min) && value < (range.min as number)) return false;
    if (Number.isFinite(range.max) && value > (range.max as number)) return false;
    return true;
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
      const existingCluster = clusters.find((cluster) => Math.abs(cluster - distanceKm) <= thresholdKilometers);
      if (existingCluster == null) clusters.push(distanceKm);
    }
    return { distinctClusterCount: clusters.length, thresholdKilometers };
  }

  private isEligibleCandidate(candidate: CoverageCandidate): boolean {
    return typeof candidate.id === 'string' && candidate.id.trim().length > 0;
  }

  private hasRequestedCoverage(input: CoverageAnalysisInput): boolean {
    return (
      (input.requestedThemes?.length ?? 0) > 0 ||
      (input.requestedTraits?.length ?? 0) > 0 ||
      (input.requestedIntents?.length ?? 0) > 0
    );
  }

  private hasSemanticIntent(input: CoverageAnalysisInput): boolean {
    return this.hasRequestedCoverage(input);
  }

  private normalize(value: string): string {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }
}
