import {
  AdmissionSignal,
  AdmissionSignalEvidence,
  admissionSignal,
} from '@tours/admission/structured-admission-policy';
import { ProminenceEvidenceFact } from '@tours/prominence/structured-prominence.policy';
import { WikidataStructuredEntityFacts } from '../interfaces/wikidata.interface';
import { TargetObservationFact } from '@tours/preferences/target-knowledge.interface';

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

/**
 * P1435 designation items whose designating authority is international
 * (prominence-v2). Other designations carry no acquired jurisdiction, so
 * their scope stays UNSPECIFIED rather than claimed.
 */
export const WIKIDATA_INTERNATIONAL_HERITAGE_DESIGNATIONS: readonly string[] = [
  // World Heritage Site
  'Q9259',
];

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

/** Admission evidence for the signals above, with the provider field read. */
export function wikidataFactsToAdmissionSignalEvidence(
  facts: WikidataAdmissionFacts,
): AdmissionSignalEvidence[] {
  const evidence: AdmissionSignalEvidence[] = [];
  for (const qid of facts.instanceOf ?? []) {
    if (WIKIDATA_VISITOR_ATTRACTION_ROOTS.includes(qid)) {
      evidence.push({
        signal: 'EXPLICIT_VISITOR_CLASSIFICATION',
        field: 'claims.P31',
        value: qid,
      });
    }
    if (WIKIDATA_HISTORIC_SITE_ROOTS.includes(qid)) {
      evidence.push({
        signal: 'HISTORIC_CLASSIFICATION',
        field: 'claims.P31',
        value: qid,
      });
    }
  }
  for (const designation of facts.heritageDesignation ?? []) {
    evidence.push({
      signal: 'HERITAGE_DESIGNATION',
      field: 'claims.P1435',
      value: designation,
    });
  }
  if ((facts.sitelinkCount ?? 0) > 0) {
    evidence.push({
      signal: 'ENCYCLOPEDIC_NOTABILITY',
      field: 'sitelinks',
      value: facts.sitelinkCount!,
    });
  }
  return evidence;
}

/**
 * Language-Wikipedia article sitelinks of an item (task 39.3). Only the
 * provider's Wikipedia site family is an encyclopedic article; Commons,
 * Wikiquote, Wikivoyage and other projects are not. Recognized from the
 * provider-supplied article URL host; a sitelink without a URL is not counted.
 */
export function wikipediaArticleSitelinks(
  facts: WikidataStructuredEntityFacts,
): Array<{ site: string; languageCode: string }> {
  return facts.sitelinks.flatMap((link) => {
    if (!link.url) return [];
    let host: string;
    try {
      host = new URL(link.url).hostname;
    } catch {
      return [];
    }
    const match = /^([a-z0-9-]+)\.wikipedia\.org$/.exec(host);
    return match ? [{ site: link.site, languageCode: match[1] }] : [];
  });
}

/** Raw structured statements → canonical admission facts. */
export function wikidataStructuredFactsToAdmissionFacts(
  facts: WikidataStructuredEntityFacts,
): WikidataAdmissionFacts {
  return {
    instanceOf: facts.instanceOf,
    heritageDesignation: facts.heritageDesignations,
    sitelinkCount: wikipediaArticleSitelinks(facts).length,
  };
}

/**
 * Raw structured statements → typed prominence evidence (design C17). The QID
 * alone yields nothing: a fact is emitted only for a statement the item
 * actually records. Zero Wikipedia articles yields no sitelink fact (UNKNOWN
 * downstream, never a negative value). P1435 values carry no issuer here, so
 * no `authority` is claimed.
 */
export function wikidataStructuredFactsToProminenceEvidence(
  facts: WikidataStructuredEntityFacts,
  observedAt: Date,
): ProminenceEvidenceFact[] {
  const base = {
    sourceProvider: 'wikidata',
    providerIdentity: facts.qid,
    sourceRecordId: facts.qid,
    observedAt,
  };
  const evidence: ProminenceEvidenceFact[] = [];
  const articles = wikipediaArticleSitelinks(facts);
  if (articles.length > 0) {
    evidence.push({
      ...base,
      kind: 'ENCYCLOPEDIC_SITELINK_COUNT',
      fieldPath: 'sitelinks',
      numericValue: articles.length,
    });
  }
  for (const designation of facts.heritageDesignations) {
    evidence.push({
      ...base,
      kind: 'HERITAGE_DESIGNATION',
      fieldPath: `claims.P1435.${designation}`,
      designationLevel: designation,
      heritageScope: WIKIDATA_INTERNATIONAL_HERITAGE_DESIGNATIONS.includes(
        designation,
      )
        ? 'INTERNATIONAL'
        : 'UNSPECIFIED',
    });
  }
  for (const qid of facts.instanceOf) {
    if (WIKIDATA_VISITOR_ATTRACTION_ROOTS.includes(qid)) {
      evidence.push({
        ...base,
        kind: 'EXPLICIT_VISITOR_CLASSIFICATION',
        fieldPath: `claims.P31.${qid}`,
        textValue: qid,
      });
    }
  }
  return evidence;
}

/**
 * Structured statements → typed concept observations (design C18): a recorded
 * heritage designation supports the history theme. Positive only; a bare QID
 * or sitelinks produce nothing (prominence is not relevance).
 */
export function wikidataStructuredFactsToTargetObservations(
  facts: WikidataStructuredEntityFacts,
): TargetObservationFact[] {
  return facts.heritageDesignations.length > 0
    ? [
        {
          target: { dimension: 'theme', key: 'history' },
          observation: {
            sourceFactId: `wikidata:${facts.qid}#P1435>theme:history`,
            state: 'SATISFIES',
          },
        },
      ]
    : [];
}
