import { createHash } from 'crypto';
import { normalizeGeoName } from '../../../be/src/modules/tours/utils/nominatim-match.util';
import { OsmStructuredAdapter, WikidataFactsAdapter } from './adapters/structured';
import { Spike2Catalog, Spike2Snapshot } from './catalog';
import { CandidateFacts, EvaluationQuestion, Grounding2Result, GroundingReason2, ProposedAnswer } from './contracts';
import { EvidenceMemory } from './memory';
import { SOURCE_CAPABILITY_VERSION, STRUCTURED_EVIDENCE_MAPPINGS, StructuredEvidenceMapping } from './policy';
import {
  AssertionSubject,
  CompositionPolicy,
  CorridorSubject,
  EvidenceCapture,
  GroundingAuthority,
  SupportLevel,
  SupportVerifier,
  VerifierUnavailable,
  WebTools,
  anchorOnLine,
  assertionKey,
  canonicalizeCorridor,
  clipBetween,
  clipToArea,
  containsPoint,
  hasSignal,
  isGeographicDataCapture,
  lineVertices,
  publisherOf,
  verifyProvenance,
} from './spike1';

const GROUNDING = new GroundingAuthority();

/** Structured captures for a question from candidate facts via the versioned mapping (owner decision P1). */
export function structuredCaptures(facts: CandidateFacts | undefined, q: EvaluationQuestion, retrievedAt: string): EvidenceCapture[] {
  if (!facts) return [];
  const out: EvidenceCapture[] = [];
  for (const f of facts.facts) {
    const m = STRUCTURED_EVIDENCE_MAPPINGS.find((x) => x.source === f.source && x.field === f.field && (x.value === '*' || x.value === f.value) && x.facetKey === q.facetKey && x.claimTypes.includes(q.claimType));
    if (!m) continue;
    out.push({
      id: createHash('sha256').update(`${f.source}|${f.recordId}|${f.field}|${f.value}`).digest('hex').slice(0, 16),
      locator: { kind: 'DATASET_RECORD', dataset: f.source, recordId: f.recordId, fieldPath: f.field },
      retrievedAt,
      contentFingerprint: createHash('sha256').update(f.value).digest('hex'),
      capture: { kind: 'STRUCTURED_FIELD', values: { [f.field]: f.value, ...(f.label ? { label: f.label } : {}), mapping: SOURCE_CAPABILITY_VERSION, establishes: m.establishes } },
      registrableDomain: `dataset:${f.source}`,
      provenanceSignals: [],
      supportVerdicts: [],
    });
  }
  return out;
}

function mappingFor(capture: EvidenceCapture, q: EvaluationQuestion): StructuredEvidenceMapping | undefined {
  if (capture.locator.kind !== 'DATASET_RECORD' || capture.capture.kind !== 'STRUCTURED_FIELD') return undefined;
  const { dataset, fieldPath } = capture.locator;
  const value = capture.capture.values[fieldPath];
  return STRUCTURED_EVIDENCE_MAPPINGS.find((x) => x.source === dataset && x.field === fieldPath && (x.value === '*' || x.value === value) && x.facetKey === q.facetKey && x.claimTypes.includes(q.claimType));
}

interface Support {
  capture: EvidenceCapture;
  level: SupportLevel;
  structured: boolean;
  authorizesAlone: boolean;
}

/**
 * Spike 2 sufficiency: spike 1's D8 rule plus owner decision P1 (structured
 * evidence corroborates; it authorizes alone only when its mapping says so,
 * and corroboration needs at least one non-structured supporting capture).
 */
export function sufficiency2(supports: Support[]): { status: 'AUTHORIZED'; basis: 'SINGLE_VERIFIED_EXPLICIT' | 'INDEPENDENT_CORROBORATION' } | { status: 'REJECTED'; reason: 'INSUFFICIENT_CORROBORATION' | 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM' } {
  const reproducible = supports.filter((s) => hasSignal(s.capture, 'REPRODUCIBLE'));
  if (reproducible.some((s) => s.level === 'EXPLICIT' && (s.structured ? s.authorizesAlone : hasSignal(s.capture, 'PUBLISHER_ESTABLISHED')))) {
    return { status: 'AUTHORIZED', basis: 'SINGLE_VERIFIED_EXPLICIT' };
  }
  const supporting = reproducible.filter((s) => s.level !== 'NONE');
  const hasProse = supporting.some((s) => !s.structured);
  for (const a of supporting) {
    if (a.level !== 'EXPLICIT') continue;
    if (hasProse && supporting.some((b) => b !== a && publisherOf(b.capture) !== publisherOf(a.capture))) return { status: 'AUTHORIZED', basis: 'INDEPENDENT_CORROBORATION' };
  }
  return supporting.length ? { status: 'REJECTED', reason: 'INSUFFICIENT_CORROBORATION' } : { status: 'REJECTED', reason: 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM' };
}

export interface Grounding2Deps {
  catalog: Spike2Catalog;
  memory: EvidenceMemory;
  tools: WebTools;
  osm: OsmStructuredAdapter;
  wikidata: WikidataFactsAdapter;
  verifier: SupportVerifier;
  policy: CompositionPolicy;
  destinationId: string;
  now: () => string;
}

const textOf = (c: EvidenceCapture) => (c.capture.kind === 'PROSE_SPAN' ? c.capture.text : '');
const names = (snapshot: Spike2Snapshot, id: string) => snapshot.candidates[id]?.names ?? [snapshot.catalog.geoEntities[id]?.name ?? id];
const mentions = (text: string, ns: string[]) => {
  const t = normalizeGeoName(text);
  return ns.some((n) => { const k = normalizeGeoName(n); return k.length > 0 && t.includes(k); });
};

/** Re-verifies a structured capture by re-reading its field from the provider. */
async function verifyStructured(deps: Grounding2Deps, capture: EvidenceCapture): Promise<'VERIFIED' | 'NOT_REPRODUCIBLE' | 'UNAVAILABLE'> {
  if (capture.locator.kind !== 'DATASET_RECORD' || capture.capture.kind !== 'STRUCTURED_FIELD') return 'NOT_REPRODUCIBLE';
  const { dataset, recordId, fieldPath } = capture.locator;
  const expected = capture.capture.values[fieldPath];
  try {
    if (dataset === 'openstreetmap') {
      const m = /^osm:(node|way|relation):(\d+)$/.exec(recordId);
      if (!m) return 'NOT_REPRODUCIBLE';
      const tags = await deps.osm.elementTags(m[1] as 'node' | 'way' | 'relation', Number(m[2]));
      return tags[fieldPath.replace(/^tag:/, '')] === expected ? 'VERIFIED' : 'NOT_REPRODUCIBLE';
    }
    const facts = (await deps.wikidata.facts([recordId], 'refetch')).get(recordId);
    if (!facts) return 'NOT_REPRODUCIBLE';
    if (fieldPath === 'P1435') return facts.heritage.some((h) => h.qid === expected) ? 'VERIFIED' : 'NOT_REPRODUCIBLE';
    if (fieldPath === 'class:museum') return facts.museumClass ? 'VERIFIED' : 'NOT_REPRODUCIBLE';
    return 'NOT_REPRODUCIBLE';
  } catch {
    return 'UNAVAILABLE';
  }
}

function reject(question: EvaluationQuestion, reason: GroundingReason2, captures: EvidenceCapture[], detail?: string): Grounding2Result {
  return { status: 'REJECTED', question, reason, captures, ...(detail ? { detail } : {}) };
}

/**
 * Grounds the accumulated answers for ONE offered question (spec
 * `knowledge-grounding`, design R7): subjects are offered ids, no identity
 * is resolved from text and nothing is written to L1. Captures from all
 * origins (structured facts, evidence memory, web) are evaluated together.
 */
export async function groundQuestion(deps: Grounding2Deps, question: EvaluationQuestion, answers: ProposedAnswer[]): Promise<Grounding2Result> {
  const snapshot = deps.catalog.snapshot();
  const subject = snapshot.catalog.geoEntities[question.candidateId];
  if (!subject || !snapshot.candidates[question.candidateId]) return reject(question, 'NOT_OFFERED_CANDIDATE', []);
  for (const a of answers) {
    if (a.questionKey !== question.key || a.candidateId !== question.candidateId) return reject(question, 'NOT_OFFERED_CANDIDATE', [], a.candidateId);
    const offeredAnchors = new Set(question.anchorIds ?? []);
    for (const id of [a.fromId, a.toId].filter((x): x is string => !!x)) if (!offeredAnchors.has(id)) return reject(question, 'NOT_OFFERED_CANDIDATE', [], id);
    if (question.claimType === 'WALKING_CORRIDOR' && a.areaId && !offeredAnchors.has(a.areaId)) return reject(question, 'NOT_OFFERED_CANDIDATE', [], a.areaId);
  }

  const byId = new Map<string, EvidenceCapture>();
  for (const a of answers) for (const c of a.captures) byId.set(c.id, c);
  const all = [...byId.values()].filter((c) => c.locator.kind === 'DATASET_RECORD' || !isGeographicDataCapture(c));
  if (all.length === 0) return reject(question, 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM', [], 'no capable evidence');

  // Provenance (re-verification) for every capture.
  const verified: EvidenceCapture[] = [];
  let unavailable = 0;
  for (const c of all) {
    if (c.locator.kind === 'DATASET_RECORD') {
      const s = await verifyStructured(deps, c);
      if (s === 'VERIFIED') verified.push({ ...c, provenanceSignals: [{ kind: 'REPRODUCIBLE', refetchedAt: deps.now(), fingerprintDrift: false }] });
      else if (s === 'UNAVAILABLE') unavailable += 1;
    } else {
      const p = await verifyProvenance(c, deps.tools);
      if (p.status === 'VERIFIED') verified.push(p.capture);
      else if (p.status === 'UNAVAILABLE') unavailable += 1;
    }
  }
  if (verified.length === 0) {
    return unavailable ? { status: 'FAILED', question, reason: 'FETCH_UNAVAILABLE', detail: `${unavailable} capture(s) unavailable` } : reject(question, 'EVIDENCE_NOT_REPRODUCIBLE', all);
  }

  // Subject-naming precondition for prose captures.
  const subjectNames = names(snapshot, question.candidateId);
  const prose = verified.filter((c) => c.capture.kind === 'PROSE_SPAN');
  const structured = verified.filter((c) => c.capture.kind === 'STRUCTURED_FIELD');
  const naming = prose.filter((c) => mentions(textOf(c), subjectNames));
  if (naming.length === 0 && structured.length === 0) return reject(question, 'EVIDENCE_DOES_NOT_NAME_SUBJECT', verified);

  // Geometry and corridor bounds.
  let assertionSubject: AssertionSubject = { kind: 'GEO_ENTITY', geoEntityId: subject.id };
  let routeCorrespondence: Array<{ anchorId: string; meters: number }> | undefined;
  if (question.claimType === 'NOTABLE_WITHIN') {
    const area = question.areaId ? snapshot.catalog.geoEntities[question.areaId] : undefined;
    if (!area || !containsPoint(area.geometry, subject.centroid)) return reject(question, 'GEOMETRY_INCONSISTENT', verified, `${subject.name} not within ${area?.name ?? 'area'}`);
    assertionSubject = { kind: 'PLACE_IN_AREA', placeGeoEntityId: subject.id, areaGeoEntityId: area.id };
  }
  if (question.claimType === 'WALKING_CORRIDOR') {
    const vertices = lineVertices(subject.geometry);
    const texts = naming.map(textOf);
    const stated = answers.find((a) => a.fromId && a.toId && texts.some((t) => mentions(t, names(snapshot, a.fromId as string))) && texts.some((t) => mentions(t, names(snapshot, a.toId as string))));
    const clip = answers.find((a) => a.areaId && texts.some((t) => mentions(t, names(snapshot, a.areaId as string))));
    let corridor: CorridorSubject | undefined;
    if (stated) {
      const from = snapshot.catalog.geoEntities[stated.fromId as string];
      const to = snapshot.catalog.geoEntities[stated.toId as string];
      const fa = anchorOnLine(from.geometry, vertices);
      const ta = anchorOnLine(to.geometry, vertices);
      if (fa.meters > deps.policy.anchorOnRouteToleranceMeters || ta.meters > deps.policy.anchorOnRouteToleranceMeters) {
        return reject(question, 'GEOMETRY_INCONSISTENT', verified, `anchor off route (${Math.round(fa.meters)} m / ${Math.round(ta.meters)} m)`);
      }
      if (clipBetween(vertices, fa.point, ta.point).length < 2) return reject(question, 'GEOMETRY_INCONSISTENT', verified, 'anchors do not bound a stretch');
      routeCorrespondence = [{ anchorId: from.id, meters: Math.round(fa.meters) }, { anchorId: to.id, meters: Math.round(ta.meters) }];
      corridor = canonicalizeCorridor({ routeGeoEntityId: subject.id, from: { kind: 'GEO_ENTITY', geoEntityId: from.id }, to: { kind: 'GEO_ENTITY', geoEntityId: to.id }, boundKind: 'STATED_ANCHORS' });
    } else if (clip) {
      const area = snapshot.catalog.geoEntities[clip.areaId as string];
      if (clipToArea(vertices, area.geometry).length < 2) return reject(question, 'GEOMETRY_INCONSISTENT', verified, `${subject.name} does not cross ${area.name}`);
      corridor = { routeGeoEntityId: subject.id, from: { kind: 'AREA_CLIP', areaGeoEntityId: area.id }, to: { kind: 'AREA_CLIP', areaGeoEntityId: area.id }, boundKind: 'AREA_CLIP' };
    } else {
      return reject(question, 'CORRIDOR_BOUNDS_UNRESOLVED', verified, 'evidence names neither offered endpoints nor the offered area');
    }
    assertionSubject = { kind: 'CORRIDOR', corridor };
  }

  // Support: LLM verifier for naming prose captures; mapping for structured.
  const supports: Support[] = [];
  const statement = {
    subject: subject.name,
    ...(question.areaId ? { area: snapshot.catalog.geoEntities[question.areaId]?.name } : {}),
    ...(assertionSubject.kind === 'CORRIDOR' && assertionSubject.corridor.from.kind === 'GEO_ENTITY' && assertionSubject.corridor.to.kind === 'GEO_ENTITY'
      ? { from: snapshot.catalog.geoEntities[assertionSubject.corridor.from.geoEntityId]?.name, to: snapshot.catalog.geoEntities[assertionSubject.corridor.to.geoEntityId]?.name }
      : {}),
  };
  try {
    for (const c of naming) {
      const v = await deps.verifier.judge({ claimKey: question.key, claimType: question.claimType, facet: question.facetKey, ...statement }, c);
      c.supportVerdicts = [...c.supportVerdicts, v];
      supports.push({ capture: c, level: v.level, structured: false, authorizesAlone: false });
    }
  } catch (error) {
    if (error instanceof VerifierUnavailable) return { status: 'FAILED', question, reason: 'VERIFIER_UNAVAILABLE', detail: error.message };
    throw error;
  }
  for (const c of structured) {
    const m = mappingFor(c, question);
    if (m) supports.push({ capture: c, level: 'EXPLICIT', structured: true, authorizesAlone: m.authorizesAlone });
  }

  const verdict = sufficiency2(supports);
  const used = supports.filter((s) => s.level !== 'NONE').map((s) => s.capture);
  if (verdict.status === 'REJECTED') {
    if (verdict.reason === 'INSUFFICIENT_CORROBORATION') deps.memory.addPending(question.key, used, verdict.reason, deps.now());
    return reject(question, verdict.reason, verified);
  }
  const key = assertionKey(question.claimType, assertionSubject, question.facetKey);
  deps.catalog.store.upsertAssertion(GROUNDING, {
    key, claimType: question.claimType, subject: assertionSubject, facetKey: question.facetKey, destinationId: deps.destinationId,
    evidence: used, status: 'ACTIVE', createdAt: deps.now(),
  });
  deps.memory.clearPending(question.key);
  return { status: 'AUTHORIZED', question, assertionKeys: [key], basis: verdict.basis, captures: used, ...(routeCorrespondence ? { routeCorrespondence } : {}) };
}
