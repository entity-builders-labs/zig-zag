import { QualityEvidence } from './experience-acquisition.interface';

/**
 * Provider-neutral geographic hint extracted from grounded evidence.
 *
 * Stage 2 cutover (docs/superpowers/plans/2026-09-22-component-resolution-
 * and-partial-composite-recovery-plan.md): this type intentionally has no
 * `required` field. The extraction LLM must never decide which component is
 * allowed to kill a real Experience (see the amendment, "Remove LLM-owned
 * `required` from geographic truth"). Every hint that reaches this type has
 * already passed the deterministic source-support admission gate (see
 * `experience-candidate-extraction.util.ts`'s
 * `verifyTextualComponentSourceSupport`); composite admission is decided
 * from source-backed composition (`acquisition-candidate-requirement.util.ts`),
 * not from a per-component authored flag.
 */
export interface GeoEntityHint {
  key: string;
  name: string;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedKind: 'PLACE' | 'AREA' | 'ROUTE';
  evidenceKeys: string[];
  /**
   * A street address the cited evidence explicitly gives for this hint
   * (e.g. "Junín 1760"), when it does — never fabricated, never derived
   * from the venue name itself. Descriptive text extracted from evidence,
   * same tier as `name` -- not a trusted coordinate or provider ID, so it
   * does not cross the architecture's "discovery never supplies trusted
   * coordinates/IDs" line. Entity resolution treats a real address match
   * against a candidate's own `addr:housenumber`/`addr:street` tags as a
   * strong, independent, non-name-based confirmation signal -- an address
   * either matches or it doesn't, unlike fuzzy name-token overlap.
   */
  addressHint?: string;
}

/**
 * A grounded tourism concept. There is intentionally no structural kind here:
 * single-place visits and multi-component experiences use the same
 * acquisition/verification contract.
 */
export interface ExperienceCandidate {
  name: string;
  description?: string;
  /**
   * Controlled dimension: canonical THEME keys from the central preference-facet
   * vocabulary only (synonyms/localized forms resolved, deduped). The shared
   * extraction boundary (experience-candidate-facet-normalizer.util.ts)
   * guarantees this deterministically regardless of what the LLM emitted.
   */
  themes: string[];
  /**
   * Open-ended dimension: descriptive facets that are NOT a canonical theme or
   * intent (long-tail concepts such as "craft beer", "rooftop", "specialty
   * coffee" are expected here). Human-readable labels, deduped
   * case-insensitively. A controlled theme/intent never survives in this array.
   */
  traits: string[];
  /**
   * Controlled dimension: canonical INTENT keys from the central preference-facet
   * vocabulary only — soft Experience facets (visit / walk / food / route_like /
   * day_trip / ...), never planner or proposal kinds. Native discovery adapters
   * require this array at their extraction boundary, while internal legacy
   * fixtures may omit it and are normalized to [] downstream.
   */
  intents?: string[];
  suggestedDurationMinutes?: number;
  componentHints: GeoEntityHint[];
  evidenceKeys: string[];
  shortReason: string;
  /**
   * True only when the cited evidence explicitly describes a visiting
   * sequence for this Experience's components (e.g. "start at X, then walk
   * to Y"). Absent/false means no real sequence evidence exists — resolved
   * components must persist with `order: null` (no intrinsic sequence),
   * never a fabricated one derived from array/resolution order.
   */
  orderedByEvidence?: boolean;
  /**
   * B3 live wiring (cutover M2) -- normalized, provider-neutral quality
   * evidence carried straight from the originating structured
   * `SourceObservation`(s) (already populated at the adapter boundary --
   * see `QualityEvidence`), consumed by `quality-score.util.ts`'s
   * `computeQualityScore()` at persistence time
   * (`ExperienceProposalResolverService`). Only ever populated from REAL
   * provider-returned signals -- never invented, never LLM-authored. A
   * web/LLM-extractor candidate never sets this (extraction must never
   * author a quality rating); it may still receive a real quality score if
   * dedupe merges it with a structured candidate for the SAME real place.
   */
  qualityEvidence?: QualityEvidence;
}

/**
 * The shared boundary every grounded discovery extractor implements
 * (Gemini / Groq / Ollama). Selection is driven by
 * `DISCOVERY_EXTRACTOR_PROVIDER`, never by the general `AI_PROVIDER`, and each
 * implementation is responsible for using its own configured transport +
 * model so the returned `provider` / `model` describe the real call.
 */
export interface ExperienceDiscoveryExtractor {
  extractExperiences(
    request: ExperienceDiscoveryRequest,
    searchResult: import('./experience-grounding.interface').ExperienceGroundedSearchResult,
    options?: { bypassCache?: boolean },
  ): Promise<
    import('../utils/experience-candidate-extraction.util').ExperienceExtractionResult & {
      provider: string;
      model: string;
      rawOutput?: string;
    }
  >;
}

export type ExperienceDiscoveryBreadth = 'focused' | 'broad';

export interface ExperienceDiscoveryScope {
  /** The destination selected by the user. For day_trip this is also the base used by FROM-base discovery queries. */
  destinationName?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
}

export interface ExperienceDiscoveryRequest {
  scope: ExperienceDiscoveryScope;
  requestedThemes: string[];
  /** Soft Experience facets/intents; never structural proposal kinds. */
  requestedIntents?: string[];
  preferredTraits?: string[];
  excludedThemes?: string[];
  excludedTraits?: string[];
  semanticQuery?: string;
  coverageGaps?: string[];
  breadth: ExperienceDiscoveryBreadth;
  maxCandidates: number;
  evidenceRequirements?: AcquisitionEvidenceRequirement[];
}

export interface ExperienceDiscoveryQuery {
  query: string;
  purpose: 'bootstrap' | 'coverage_gap' | 'focused_enrichment';
  expectedEvidence: string[];
}

export interface ExperienceDiscoveryPlan {
  queries: ExperienceDiscoveryQuery[];
  enrichmentAllowed: boolean;
}
import { AcquisitionEvidenceRequirement } from './acquisition-evidence-requirement.interface';
