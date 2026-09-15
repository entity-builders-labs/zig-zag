import { Injectable, Logger } from '@nestjs/common';
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
import { ResolvedAnchor } from '../interfaces/preference-spec.interface';
import { deriveAcquisitionEvidenceRequirements } from '../utils/acquisition-evidence-requirement.util';

/**
 * `AcquisitionDeficit` is a discriminated union -- only `preference_facet`
 * carries `dimension`/`key`; `global_capacity` structurally has neither (it
 * must never masquerade as a facet deficit). These two accessors are the
 * one place that reads across the whole union generically (routing/dedup/
 * grouping), so every other call site stays type-safe without repeating
 * this narrowing.
 */
export function deficitDimension(
  deficit: AcquisitionDeficit,
): string | undefined {
  return deficit.origin === 'global_capacity' ? undefined : deficit.dimension;
}
export function deficitKey(deficit: AcquisitionDeficit): string | undefined {
  return deficit.origin === 'global_capacity' ? undefined : deficit.key;
}

export interface BuildPlanInput {
  destination: ExperienceDiscoveryScope;
  breadth?: ExperienceDiscoveryBreadth;
  deficits?: AcquisitionDeficit[];
  preferredFacets?: PreferenceFacet[];
  candidates?: ExperienceCandidate[];
  semanticQuery?: string;
  /**
   * Task B5 — area/route anchors relevant to a walk/route_like deficit.
   * Every relevant anchor's name is preserved into the web query (never
   * collapsed to one, never dropped when 1+ exist — correctness point 12).
   */
  anchors?: ResolvedAnchor[];
}

@Injectable()
export class ExperienceAcquisitionPlannerService {
  private readonly logger = new Logger(
    ExperienceAcquisitionPlannerService.name,
  );

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
      const k = `${d.origin}:${deficitDimension(d) ?? ''}:${deficitKey(d) ?? ''}:${d.reason}`;
      if (!seenDeficitKeys.has(k)) {
        seenDeficitKeys.add(k);
        deficits.push(d);
      }
    };

    if (input.deficits) {
      for (const d of input.deficits) addDeficit(d);
    }

    if (input.preferredFacets && input.candidates) {
      for (const d of this.projectPreferenceFacetDeficits(
        input.candidates,
        input.preferredFacets,
      )) {
        addDeficit(d);
      }
    }

    const evidenceRequirements =
      deriveAcquisitionEvidenceRequirements(deficits);

    if (deficits.length === 0) {
      return {
        destination: input.destination,
        deficits: [],
        evidenceRequirements: [],
        sourcePlans: [],
        breadth,
      };
    }

    const wikivoyageSections = new Set<'SEE' | 'DO' | 'EAT'>();
    const placesTypes = new Set<string>();
    const webKeywords = new Set<string>();
    let hasRoutableDeficit = false;

    for (const deficit of deficits) {
      const route = lookupSourceCapabilityRoute(
        deficitDimension(deficit),
        deficitKey(deficit),
      );

      if (!route) {
        continue;
      }

      hasRoutableDeficit = true;

      if (route.wikivoyageSections) {
        for (const s of route.wikivoyageSections) wikivoyageSections.add(s);
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
        evidenceRequirements,
        sourcePlans: [],
        breadth,
      };
    }

    const sourcePlans: SourcePlan[] = [];
    const destName = input.destination.destinationName?.trim() || '';
    const relevantArticleTargets = [
      destName,
      ...(input.anchors ?? [])
        .filter(
          (anchor) =>
            (anchor.kind === 'area' || anchor.kind === 'route') &&
            anchor.priority === 'must',
        )
        .map((anchor) => anchor.rawName.trim()),
    ]
      .filter(Boolean)
      .filter(
        (value, index, values) =>
          values.findIndex(
            (candidate) => candidate.toLowerCase() === value.toLowerCase(),
          ) === index,
      );

    // 17.1 Wikivoyage coalescing (canonical order SEE, DO, EAT)
    if (wikivoyageSections.size > 0) {
      const order = ['SEE', 'DO', 'EAT'] as const;
      const sortedSections = order.filter((s) => wikivoyageSections.has(s));
      sourcePlans.push({
        provider: 'wikivoyage',
        wikivoyage: {
          sections: sortedSections,
          ...(relevantArticleTargets.length > 1
            ? { articleTargets: relevantArticleTargets }
            : {}),
        },
      });
    }

    // 17.2 Google Places coalescing (sorted search types, provider: 'google_places', payload key: 'places')
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

      // Task B5 (correctness point 12): for a walk/route_like deficit,
      // preserve EVERY relevant area/route anchor name in the query --
      // never collapse "San Telmo to La Boca" down to one name, never
      // drop them all when 1+ exist.
      const isWalkOrRouteLikeDeficit = deficits.some(
        (d) =>
          deficitDimension(d) === 'intent' &&
          (deficitKey(d) === 'walk' || deficitKey(d) === 'route_like'),
      );
      const relevantAnchorNames = isWalkOrRouteLikeDeficit
        ? (input.anchors ?? [])
            .filter(
              (anchor) => anchor.kind === 'area' || anchor.kind === 'route',
            )
            .map((anchor) => anchor.rawName)
        : [];

      if (relevantAnchorNames.length > 0) {
        queryParts.push(...relevantAnchorNames);
      }
      if (sortedKeywords.length > 0) {
        queryParts.push(...sortedKeywords);
      } else if (relevantAnchorNames.length === 0) {
        queryParts.push('top attractions');
      }
      if (input.semanticQuery?.trim()) {
        queryParts.push(input.semanticQuery.trim());
      }

      // Deterministic deficit projection so the web executor can build a
      // faithful ExperienceDiscoveryRequest without another context argument.
      // Fields are omitted when empty so the coalesced web plan stays minimal.
      const byDimension = (dim: string) =>
        [
          ...new Set(
            deficits
              .filter((d) => deficitDimension(d) === dim && deficitKey(d))
              .map((d) => deficitKey(d) as string),
          ),
        ].sort();
      const webThemes = byDimension('theme');
      const webIntents = byDimension('intent');
      const webTraits = byDimension('trait');
      const webSemanticQuery = input.semanticQuery?.trim() || undefined;

      sourcePlans.push({
        provider: 'web',
        web: {
          query: queryParts.join(' '),
          ...(webThemes.length ? { requestedThemes: webThemes } : {}),
          ...(webIntents.length ? { requestedIntents: webIntents } : {}),
          ...(webTraits.length ? { preferredTraits: webTraits } : {}),
          ...(webSemanticQuery ? { semanticQuery: webSemanticQuery } : {}),
          ...(relevantAnchorNames.length
            ? { anchorNames: relevantAnchorNames }
            : {}),
        },
      });
    }

    this.logger.log(
      `Built acquisition plan for "${destName}" with ${deficits.length} deficits: [${sourcePlans.map((s) => s.provider).join(', ')}]`,
    );

    return {
      destination: input.destination,
      deficits,
      evidenceRequirements,
      sourcePlans,
      breadth,
    };
  }
}
