import {
  AdmissionSignal,
  admissionSignal,
} from '@tours/admission/structured-admission-policy';

/**
 * Wikidata → canonical admission mapping (design C7, task 37.1). The Wikidata
 * adapter translates resolved Wikidata facts — root-class membership,
 * heritage designation (P1435) and sitelinks — into canonical admission
 * signals. Downstream admission reads only these signals, never the raw
 * Wikidata QIDs.
 */

/**
 * Canonical visitor-attraction root classes (P31 / P279*): an entity whose
 * class reaches one of these roots carries a decisive
 * EXPLICIT_VISITOR_CLASSIFICATION. Grounded on the structured-world-first
 * spike's museum root (Q33506); extended deliberately, never a synonym list.
 */
export const WIKIDATA_VISITOR_ATTRACTION_ROOTS: readonly string[] = ['Q33506'];

/**
 * Canonical historic-site root classes (P31 / P279*). Kept explicit and
 * calibrated separately from the visitor-attraction roots; OSM `historic=*`
 * supplies the ordinary historic signal today.
 */
export const WIKIDATA_HISTORIC_SITE_ROOTS: readonly string[] = [];

export interface WikidataAdmissionFacts {
  /** Resolved P31 / P279* class QIDs (already rooted). */
  instanceOf?: readonly string[];
  /** P1435 heritage-designation values; non-empty means present. */
  heritageDesignation?: readonly string[];
  /** Number of sitelinks; > 0 is encyclopedic notability. */
  sitelinkCount?: number;
}

export function wikidataFactsToAdmissionSignals(
  facts: WikidataAdmissionFacts,
): AdmissionSignal[] {
  const signals: AdmissionSignal[] = [];
  const classes = facts.instanceOf ?? [];

  if (classes.some((qid) => WIKIDATA_VISITOR_ATTRACTION_ROOTS.includes(qid))) {
    signals.push(admissionSignal('EXPLICIT_VISITOR_CLASSIFICATION'));
  }
  if (classes.some((qid) => WIKIDATA_HISTORIC_SITE_ROOTS.includes(qid))) {
    signals.push(admissionSignal('HISTORIC_CLASSIFICATION'));
  }
  if ((facts.heritageDesignation ?? []).length > 0) {
    signals.push(admissionSignal('HERITAGE_DESIGNATION'));
  }
  if ((facts.sitelinkCount ?? 0) > 0) {
    signals.push(admissionSignal('ENCYCLOPEDIC_NOTABILITY'));
  }
  return signals;
}
