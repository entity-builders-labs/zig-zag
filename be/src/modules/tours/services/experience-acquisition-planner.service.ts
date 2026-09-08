import { Injectable, Logger } from '@nestjs/common';
import { CoverageDeficit } from '../interfaces/coverage-analysis.interface';
import { PreferenceFacet } from '../preferences/preference-facet.interface';
import {
  ExperienceCandidate,
  ExperienceDiscoveryBreadth,
  ExperienceDiscoveryScope,
} from '../interfaces/experience-discovery.interface';
import {
  AcquisitionDeficit,
  ExperienceAcquisitionPlan,
  SourcePlan,
} from '../interfaces/experience-acquisition-plan.interface';
import { lookupSourceCapabilityRoute } from '../constants/acquisition-source-routing';
import { candidateMatchesPreferenceFacet } from '../utils/preference-facet-matching.util';

export interface BuildPlanInput {
  destination: ExperienceDiscoveryScope;
  breadth?: ExperienceDiscoveryBreadth;
  deficits?: AcquisitionDeficit[];
  legacyDeficits?: CoverageDeficit[];
  preferredFacets?: PreferenceFacet[];
  candidates?: ExperienceCandidate[];
  semanticQuery?: string;
}

@Injectable()
export class ExperienceAcquisitionPlannerService {
  private readonly logger = new Logger(
    ExperienceAcquisitionPlannerService.name,
  );

  /**
   * Projects legacy CoverageDeficit items into dimension-aware AcquisitionDeficits
   * deterministically without parsing free-text message strings.
   */
  projectCoverageDeficits(
    legacyDeficits: CoverageDeficit[],
  ): AcquisitionDeficit[] {
    return legacyDeficits.map((d) => {
      let dimension: string | undefined;
      let key: string | undefined;

      if (d.theme) {
        dimension = 'theme';
        key = d.theme;
      } else if (d.trait) {
        dimension = 'trait';
        key = d.trait;
      } else if (d.intent) {
        dimension = 'intent';
        key = d.intent;
      }

      return {
        dimension,
        key,
        reason: d.message,
        origin: 'coverage_analysis',
        legacyDeficit: d,
      };
    });
  }

  /**
   * Projects custom PreferenceFacets against a candidate pool.
   * If any facet has no matching candidate, an AcquisitionDeficit is emitted.
   */
  projectPreferenceFacetDeficits(
    candidates: ExperienceCandidate[],
    preferredFacets?: PreferenceFacet[],
  ): AcquisitionDeficit[] {
    if (!preferredFacets || preferredFacets.length === 0) {
      return [];
    }

    const deficits: AcquisitionDeficit[] = [];
    const seenDeficits = new Set<string>();

    for (const facet of preferredFacets) {
      // exploration_style is dormant in Phase 3
      if (facet.dimension === 'exploration_style') {
        continue;
      }

      const dedupeKey = `${facet.dimension}:${facet.key.toLowerCase().trim()}`;
      if (seenDeficits.has(dedupeKey)) {
        continue;
      }

      const hasMatch = candidates.some((candidate) =>
        candidateMatchesPreferenceFacet(candidate, facet),
      );

      if (!hasMatch) {
        seenDeficits.add(dedupeKey);
        deficits.push({
          dimension: facet.dimension,
          key: facet.key,
          reason: `Coverage deficit for preference facet [${facet.dimension}:${facet.key}]`,
          origin: 'preference_facet',
        });
      }
    }

    return deficits;
  }

  /**
   * Builds a cohesive, coalesced ExperienceAcquisitionPlan routing deficits
   * to appropriate providers using the explicit capability routing table.
   */
  buildAcquisitionPlan(input: BuildPlanInput): ExperienceAcquisitionPlan {
    const breadth: ExperienceDiscoveryBreadth = input.breadth ?? 'focused';
    const deficits: AcquisitionDeficit[] = [];
    const seenDeficitKeys = new Set<string>();

    const addDeficit = (d: AcquisitionDeficit) => {
      const k = `${d.origin}:${d.dimension ?? ''}:${d.key ?? ''}:${d.reason}`;
      if (!seenDeficitKeys.has(k)) {
        seenDeficitKeys.add(k);
        deficits.push(d);
      }
    };

    if (input.deficits) {
      for (const d of input.deficits) addDeficit(d);
    }

    if (input.legacyDeficits) {
      for (const d of this.projectCoverageDeficits(input.legacyDeficits)) {
        addDeficit(d);
      }
    }

    if (input.preferredFacets && input.candidates) {
      for (const d of this.projectPreferenceFacetDeficits(
        input.candidates,
        input.preferredFacets,
      )) {
        addDeficit(d);
      }
    }

    if (deficits.length === 0) {
      return {
        destination: input.destination,
        deficits: [],
        sourcePlans: [],
        breadth,
      };
    }

    const wikivoyageSections = new Set<'SEE' | 'DO' | 'EAT'>();
    const osmConcepts = new Set<string>();
    const placesTypes = new Set<string>();
    const webKeywords = new Set<string>();
    let hasRoutableDeficit = false;

    for (const deficit of deficits) {
      const route = lookupSourceCapabilityRoute(deficit.dimension, deficit.key);

      if (!route) {
        continue;
      }

      hasRoutableDeficit = true;

      if (route.wikivoyageSections) {
        for (const s of route.wikivoyageSections) wikivoyageSections.add(s);
      }
      if (route.osmConcepts) {
        for (const c of route.osmConcepts) osmConcepts.add(c);
      }
      if (route.placesTypes) {
        for (const p of route.placesTypes) placesTypes.add(p);
      }
      if (route.webKeywords) {
        for (const w of route.webKeywords) webKeywords.add(w);
      }
    }

    if (!hasRoutableDeficit) {
      return {
        destination: input.destination,
        deficits,
        sourcePlans: [],
        breadth,
      };
    }

    const sourcePlans: SourcePlan[] = [];
    const destName = input.destination.destinationName?.trim() || '';

    // 17.1 Wikivoyage coalescing (canonical order SEE, DO, EAT)
    if (wikivoyageSections.size > 0) {
      const order = ['SEE', 'DO', 'EAT'] as const;
      const sortedSections = order.filter((s) => wikivoyageSections.has(s));
      sourcePlans.push({
        provider: 'wikivoyage',
        wikivoyage: {
          sections: sortedSections,
        },
      });
    }

    // 17.2 OSM coalescing (sorted concepts)
    if (osmConcepts.size > 0) {
      sourcePlans.push({
        provider: 'osm',
        osm: {
          concepts: [...osmConcepts].sort(),
        },
      });
    }

    // 17.3 Google Places coalescing (sorted search types, provider: 'google_places', payload key: 'places')
    if (placesTypes.size > 0) {
      sourcePlans.push({
        provider: 'google_places',
        places: {
          searchTypes: [...placesTypes].sort(),
        },
      });
    }

    // 17.4 Web query coalescing (at most one plain-keyword query)
    if (webKeywords.size > 0 || input.semanticQuery?.trim()) {
      const sortedKeywords = [...webKeywords].sort();
      const queryParts = destName ? [destName] : [];

      if (sortedKeywords.length > 0) {
        queryParts.push(...sortedKeywords);
      } else {
        queryParts.push('top attractions');
      }
      if (input.semanticQuery?.trim()) {
        queryParts.push(input.semanticQuery.trim());
      }

      sourcePlans.push({
        provider: 'web',
        web: {
          query: queryParts.join(' '),
        },
      });
    }

    this.logger.log(
      `Built acquisition plan for "${destName}" with ${deficits.length} deficits: [${sourcePlans.map((s) => s.provider).join(', ')}]`,
    );

    return {
      destination: input.destination,
      deficits,
      sourcePlans,
      breadth,
    };
  }
}
