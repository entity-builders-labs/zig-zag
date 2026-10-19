import {
  AdmissionDecision,
  AdmissionExclusionClass,
  AdmissionSignalType,
  evaluateAdmissionRule,
  STRUCTURED_ADMISSION_POLICY_VERSION,
} from './structured-admission-policy';
import { osmTagsToAdmissionFacts } from '@integrations/osm/utils/osm-admission-adapter';
import {
  wikidataFactsToAdmissionSignals,
  WikidataAdmissionFacts,
} from '@integrations/wikidata/utils/wikidata-admission-adapter';

/**
 * Live structured admission evaluation (task 36.1). Combines provider-adapter
 * canonical facts (OSM tags, resolved Wikidata facts) and applies the single
 * canonical admission rule. Preference relevance, duration, opening hours,
 * semantic ranking, web research and LLM output are NEVER admission evidence.
 *
 * This is the one place that turns provider facts into an admission decision;
 * no other component may call `evaluateAdmissionRule` directly on provider
 * data.
 */
export interface StructuredPlaceAdmissionRecord {
  policyVersion: string;
  signals: AdmissionSignalType[];
  exclusions: AdmissionExclusionClass[];
  decision: AdmissionDecision;
}

export interface StructuredPlaceAdmissionInput {
  /** Raw OSM tags, when the provider adapter surfaced them. */
  tags?: Record<string, string>;
  /** Resolved Wikidata facts (root classes, P1435, sitelinks), when fetched. */
  wikidataFacts?: WikidataAdmissionFacts;
}

export function evaluateStructuredPlaceAdmission(
  input: StructuredPlaceAdmissionInput,
): StructuredPlaceAdmissionRecord {
  const osm = osmTagsToAdmissionFacts(input.tags);
  const wikidata = wikidataFactsToAdmissionSignals(input.wikidataFacts ?? {});
  const signals = [...osm.signals, ...wikidata];
  const decision = evaluateAdmissionRule(signals, osm.exclusions);
  return {
    policyVersion: STRUCTURED_ADMISSION_POLICY_VERSION,
    signals: signals.map((signal) => signal.type),
    exclusions: [...osm.exclusions],
    decision,
  };
}

export function isAdmitted(record: StructuredPlaceAdmissionRecord): boolean {
  return record.decision.admitted;
}

export function rejectionReason(
  record: StructuredPlaceAdmissionRecord,
): string | undefined {
  const decision = record.decision;
  if (decision.admitted === false) {
    return decision.reason;
  }
  return undefined;
}
