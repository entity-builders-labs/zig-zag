import {
  AdmissionDecision,
  AdmissionExclusionClass,
  AdmissionSignalEvidence,
  AdmissionSignalType,
  evaluateAdmissionRule,
  STRUCTURED_ADMISSION_POLICY_VERSION,
} from './structured-admission-policy';
import {
  OsmAdmissionFacts,
  osmTagsToAdmissionFacts,
} from '@integrations/osm/utils/osm-admission-adapter';
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
  signalEvidence: AdmissionSignalEvidence[];
  exclusions: AdmissionExclusionClass[];
  decision: AdmissionDecision;
}

export interface StructuredPlaceAdmissionInput {
  /** Raw OSM tags, when the provider adapter surfaced them. */
  tags?: Record<string, string>;
  /** Already normalized OSM facts, supplied by the structured provider path. */
  osmFacts?: OsmAdmissionFacts;
  /** Resolved Wikidata facts (root classes, P1435, sitelinks), when fetched. */
  wikidataFacts?: WikidataAdmissionFacts;
}

export function evaluateStructuredPlaceAdmission(
  input: StructuredPlaceAdmissionInput,
): StructuredPlaceAdmissionRecord {
  return evaluateStructuredPlaceAdmissionFacts({
    osmFacts: input.osmFacts ?? osmTagsToAdmissionFacts(input.tags),
    wikidataFacts: input.wikidataFacts,
  });
}

export function evaluateStructuredPlaceAdmissionFacts(input: {
  osmFacts: OsmAdmissionFacts;
  wikidataFacts?: WikidataAdmissionFacts;
}): StructuredPlaceAdmissionRecord {
  const osm = input.osmFacts;
  const wikidata = wikidataFactsToAdmissionSignals(input.wikidataFacts ?? {});
  const signals = [...osm.signals, ...wikidata];
  const decision = evaluateAdmissionRule(signals, osm.exclusions);
  return {
    policyVersion: STRUCTURED_ADMISSION_POLICY_VERSION,
    signals: signals.map((signal) => signal.type),
    signalEvidence: [...osm.signalEvidence],
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
