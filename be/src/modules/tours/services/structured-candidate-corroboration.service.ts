import { Injectable, Logger } from '@nestjs/common';
import {
  ExperienceCandidate,
  GeoEntityHint,
} from '../interfaces/experience-discovery.interface';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import { StructuredCandidateProposal } from '../interfaces/structured-candidate-proposal.interface';
import {
  distanceMeters,
  normalizeRealWorldName,
  REAL_WORLD_RECONCILIATION_RADIUS_METERS,
  realWorldNamesMatch,
} from '../utils/real-world-entity-matching.util';

export type CorroborationDecision = 'SAME' | 'NEW' | 'AMBIGUOUS';

export type CorroborationReason =
  | 'same_evidence_key'
  | 'same_wikidata_identity'
  | 'compatible_geo_and_name'
  | 'name_match_without_geography'
  | 'geographic_overlap_without_name_match'
  | 'incompatible_evidence_type'
  | 'no_shared_identity_signal';

export interface CorroborationPairDecision {
  decision: CorroborationDecision;
  reasons: CorroborationReason[];
  distanceMeters?: number;
}

export interface CorroborationGroupTrace {
  groupId: string;
  proposalIds: string[];
  contributingProviders: string[];
  mergedEvidenceKeys: string[];
}

export interface CorroborationPairTrace {
  leftProposalId: string;
  rightProposalId: string;
  decision: CorroborationDecision;
  reasons: CorroborationReason[];
  distanceMeters?: number;
}

export interface CorroborationMergeResult {
  candidates: ExperienceCandidate[];
  groups: CorroborationGroupTrace[];
  pairDecisions: CorroborationPairTrace[];
}

function canonicalExternalIdentity(obs: SourceObservation): string | undefined {
  if (obs.provider === 'wikivoyage' || obs.provider === 'wikidata') {
    const raw = obs.externalId?.trim();
    if (raw && /^Q\d+$/i.test(raw)) {
      return `wikidata:${raw.toUpperCase()}`;
    }
    const match = obs.evidenceKey.match(/:wikidata:(Q\d+)/i);
    if (match) {
      return `wikidata:${match[1].toUpperCase()}`;
    }
  }
  return undefined;
}

function proposalIdentifier(proposal: StructuredCandidateProposal): string {
  return (
    proposal.candidate.evidenceKeys[0] ||
    proposal.observations[0]?.evidenceKey ||
    proposal.candidate.name
  );
}

function compareProposals(
  a: StructuredCandidateProposal,
  b: StructuredCandidateProposal,
): number {
  const aKey = a.candidate.evidenceKeys[0] ?? '';
  const bKey = b.candidate.evidenceKeys[0] ?? '';
  if (aKey !== bKey) return aKey.localeCompare(bKey);

  const aProvider = a.observations[0]?.provider ?? '';
  const bProvider = b.observations[0]?.provider ?? '';
  if (aProvider !== bProvider) return aProvider.localeCompare(bProvider);

  const aName = a.candidate.name ?? '';
  const bName = b.candidate.name ?? '';
  if (aName !== bName) return aName.localeCompare(bName);

  const aDesc = a.candidate.description ?? '';
  const bDesc = b.candidate.description ?? '';
  return aDesc.localeCompare(bDesc);
}

function extractCoordinates(
  proposal: StructuredCandidateProposal,
): { latitude: number; longitude: number } | undefined {
  for (const obs of proposal.observations) {
    if (
      obs.geo &&
      Number.isFinite(obs.geo.latitude) &&
      Number.isFinite(obs.geo.longitude)
    ) {
      return {
        latitude: obs.geo.latitude!,
        longitude: obs.geo.longitude!,
      };
    }
  }
  return undefined;
}

@Injectable()
export class StructuredCandidateCorroborationService {
  private readonly logger = new Logger(
    StructuredCandidateCorroborationService.name,
  );

  /**
   * Pairwise comparison deciding if two proposals represent the SAME entity,
   * distinct entities (NEW), or an AMBIGUOUS overlap.
   */
  decidePair(
    left: StructuredCandidateProposal,
    right: StructuredCandidateProposal,
  ): CorroborationPairDecision {
    // Rule A: Identical evidence key between any observations or candidate evidence keys
    const leftKeys = new Set([
      ...left.candidate.evidenceKeys,
      ...left.observations.map((o) => o.evidenceKey),
    ]);
    const sharesEvidenceKey = [
      ...right.candidate.evidenceKeys,
      ...right.observations.map((o) => o.evidenceKey),
    ].some((k) => leftKeys.has(k));

    if (sharesEvidenceKey) {
      return {
        decision: 'SAME',
        reasons: ['same_evidence_key'],
      };
    }

    // Structural kind / observation compatibility check
    const leftTypes = new Set(left.observations.map((o) => o.evidenceType));
    const rightTypes = new Set(right.observations.map((o) => o.evidenceType));

    const isActivityLike = (types: Set<string>) =>
      types.has('tourism_activity') ||
      types.has('operator') ||
      types.has('editorial');

    if (isActivityLike(leftTypes) || isActivityLike(rightTypes)) {
      // Cross-provider activities / operators / editorial never auto-merge with places or other activities
      return {
        decision: 'NEW',
        reasons: ['incompatible_evidence_type'],
      };
    }

    // Both are place-like: check specific compatible kinds
    if (
      (leftTypes.has('place') && !rightTypes.has('place')) ||
      (leftTypes.has('area') && !rightTypes.has('area')) ||
      (leftTypes.has('route') && !rightTypes.has('route'))
    ) {
      return {
        decision: 'NEW',
        reasons: ['incompatible_evidence_type'],
      };
    }

    // Rule B: Shared canonical Wikidata identity
    const leftQids = left.observations
      .map(canonicalExternalIdentity)
      .filter(Boolean);
    const rightQids = right.observations
      .map(canonicalExternalIdentity)
      .filter(Boolean);

    const sharedQid = leftQids.find((qid) => rightQids.includes(qid));
    if (sharedQid) {
      return {
        decision: 'SAME',
        reasons: ['same_wikidata_identity'],
      };
    }

    // Multi-component check: if either has >1 component hints, require alignment
    if (
      left.candidate.componentHints.length > 1 ||
      right.candidate.componentHints.length > 1
    ) {
      return {
        decision: 'AMBIGUOUS',
        reasons: ['no_shared_identity_signal'],
      };
    }

    // Geography and Name check
    const leftGeo = extractCoordinates(left);
    const rightGeo = extractCoordinates(right);
    const namesMatch = realWorldNamesMatch(
      left.candidate.name,
      right.candidate.name,
    );

    if (leftGeo && rightGeo) {
      const dist = distanceMeters(leftGeo, rightGeo);

      if (dist <= REAL_WORLD_RECONCILIATION_RADIUS_METERS) {
        if (namesMatch) {
          return {
            decision: 'SAME',
            reasons: ['compatible_geo_and_name'],
            distanceMeters: dist,
          };
        } else {
          return {
            decision: 'AMBIGUOUS',
            reasons: ['geographic_overlap_without_name_match'],
            distanceMeters: dist,
          };
        }
      } else {
        // Distance > 150m
        return {
          decision: 'NEW',
          reasons: ['no_shared_identity_signal'],
          distanceMeters: dist,
        };
      }
    }

    // One or both lack coordinates
    if (namesMatch) {
      return {
        decision: 'AMBIGUOUS',
        reasons: ['name_match_without_geography'],
      };
    }

    return {
      decision: 'NEW',
      reasons: ['no_shared_identity_signal'],
    };
  }

  /**
   * Deterministic corroboration and merging of structured candidate proposals.
   */
  corroborateAndMerge(
    proposals: StructuredCandidateProposal[],
  ): CorroborationMergeResult {
    if (!proposals.length) {
      return {
        candidates: [],
        groups: [],
        pairDecisions: [],
      };
    }

    // Deterministic sort upfront ensures order-independence across permutations
    const sorted = [...proposals].sort(compareProposals);

    // Precompute all pairwise decisions
    const pairDecisions: CorroborationPairTrace[] = [];
    const pairMap = new Map<string, CorroborationPairDecision>();

    const makePairKey = (idA: string, idB: string) =>
      idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const left = sorted[i];
        const right = sorted[j];
        const leftId = proposalIdentifier(left);
        const rightId = proposalIdentifier(right);
        const decision = this.decidePair(left, right);

        pairMap.set(makePairKey(leftId, rightId), decision);
        pairDecisions.push({
          leftProposalId: leftId,
          rightProposalId: rightId,
          decision: decision.decision,
          reasons: decision.reasons,
          distanceMeters: decision.distanceMeters,
        });
      }
    }

    const isPairSame = (
      a: StructuredCandidateProposal,
      b: StructuredCandidateProposal,
    ): boolean => {
      const idA = proposalIdentifier(a);
      const idB = proposalIdentifier(b);
      if (idA === idB) return true;
      const dec = pairMap.get(makePairKey(idA, idB));
      return dec?.decision === 'SAME';
    };

    // Conservative complete-link clustering:
    // A proposal joins a cluster if and only if it is SAME with EVERY member in that cluster.
    // If it could join multiple independent clusters, it is ambiguous across clusters -> keep separate.
    const clusters: StructuredCandidateProposal[][] = [];

    for (const proposal of sorted) {
      const eligibleClusterIndices: number[] = [];

      for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
        const cluster = clusters[cIdx];
        const sameWithAll = cluster.every((member) =>
          isPairSame(proposal, member),
        );
        if (sameWithAll) {
          eligibleClusterIndices.push(cIdx);
        }
      }

      if (eligibleClusterIndices.length === 1) {
        clusters[eligibleClusterIndices[0]].push(proposal);
      } else {
        // Either matches 0 clusters or >1 clusters (ambiguous across clusters)
        clusters.push([proposal]);
      }
    }

    // Synthesize candidates from clusters
    const candidates: ExperienceCandidate[] = [];
    const groups: CorroborationGroupTrace[] = [];

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const mergedCandidate = this.synthesizeMergedCandidate(cluster);
      candidates.push(mergedCandidate);

      groups.push({
        groupId: `group_${i + 1}`,
        proposalIds: cluster.map(proposalIdentifier),
        contributingProviders: [
          ...new Set(
            cluster.flatMap((p) => p.observations.map((o) => o.provider)),
          ),
        ].sort(),
        mergedEvidenceKeys: [
          ...new Set(cluster.flatMap((p) => p.candidate.evidenceKeys)),
        ].sort(),
      });
    }

    return {
      candidates,
      groups,
      pairDecisions,
    };
  }

  private synthesizeMergedCandidate(
    cluster: StructuredCandidateProposal[],
  ): ExperienceCandidate {
    if (cluster.length === 1) {
      const c = cluster[0].candidate;
      return {
        ...c,
        themes: [...new Set(c.themes)].sort(),
        traits: [...new Set(c.traits)].sort(),
        intents: c.intents ? [...new Set(c.intents)].sort() : [],
        evidenceKeys: [...new Set(c.evidenceKeys)].sort(),
      };
    }

    // 10.1 evidenceKeys: Union of all contributor evidenceKeys, deduplicated and sorted
    const evidenceKeys = [
      ...new Set(cluster.flatMap((p) => p.candidate.evidenceKeys)),
    ].sort();

    // 10.2 themes, traits, intents: Union, deduplicated and sorted
    const themes = [
      ...new Set(cluster.flatMap((p) => p.candidate.themes)),
    ].sort();
    const traits = [
      ...new Set(cluster.flatMap((p) => p.candidate.traits)),
    ].sort();
    const intents = [
      ...new Set(cluster.flatMap((p) => p.candidate.intents ?? [])),
    ].sort();

    // 10.3 name: Longest normalized name, tie-break lexicographically
    const names = cluster.map((p) => p.candidate.name.trim()).filter(Boolean);
    const chosenName = names.reduce((best, curr) => {
      const bestNorm = normalizeRealWorldName(best);
      const currNorm = normalizeRealWorldName(curr);
      if (currNorm.length > bestNorm.length) return curr;
      if (currNorm.length < bestNorm.length) return best;
      return curr.localeCompare(best) < 0 ? curr : best;
    }, names[0] ?? '');

    // 10.4 description: Longest non-empty description, tie-break lexicographically
    const descriptions = cluster
      .map((p) => p.candidate.description?.trim())
      .filter((d): d is string => !!d);
    const chosenDescription = descriptions.length
      ? descriptions.reduce((best, curr) => {
          if (curr.length > best.length) return curr;
          if (curr.length < best.length) return best;
          return curr.localeCompare(best) < 0 ? curr : best;
        })
      : undefined;

    // 10.5 suggestedDurationMinutes: If none -> undefined. If all identical -> that duration. If conflict -> undefined.
    const durations = [
      ...new Set(
        cluster
          .map((p) => p.candidate.suggestedDurationMinutes)
          .filter((d): d is number => d != null),
      ),
    ];
    const suggestedDurationMinutes =
      durations.length === 1 ? durations[0] : undefined;

    // 10.6 orderedByEvidence: True only if ALL have orderedByEvidence === true
    const orderedByEvidence = cluster.every(
      (p) => p.candidate.orderedByEvidence === true,
    );

    // 10.8 componentHints: SAME-concept collapse
    // For single-concept proposals, collapse into ONE merged GeoEntityHint
    let componentHints: GeoEntityHint[] = [];
    const allHints = cluster.flatMap((p) => p.candidate.componentHints);

    const isSingleConceptCluster = cluster.every(
      (p) => p.candidate.componentHints.length <= 1,
    );

    if (isSingleConceptCluster && allHints.length > 0) {
      const role =
        allHints.find((h) => h.role === 'venue')?.role ||
        allHints[0].role ||
        'venue';
      const expectedKind =
        allHints.find((h) => h.expectedKind === 'PLACE')?.expectedKind ||
        allHints[0].expectedKind ||
        'PLACE';
      const required = allHints.some((h) => h.required);
      const hintEvidenceKeys = [
        ...new Set(allHints.flatMap((h) => h.evidenceKeys)),
      ].sort();

      componentHints = [
        {
          key: `${evidenceKeys[0]}:component`,
          name: chosenName,
          role,
          expectedKind,
          required,
          evidenceKeys: hintEvidenceKeys,
        },
      ];
    } else {
      // Multi-component alignment fallback
      componentHints = allHints;
    }

    // 10.7 shortReason: Deterministic explanation string mentioning contributing providers
    const providers = [
      ...new Set(cluster.flatMap((p) => p.observations.map((o) => o.provider))),
    ].sort();
    const shortReason = `Corroborated across ${providers.length} sources (${providers.join(', ')}): ${chosenName}`;

    return {
      name: chosenName,
      description: chosenDescription,
      themes,
      traits,
      intents,
      suggestedDurationMinutes,
      componentHints,
      evidenceKeys,
      shortReason,
      orderedByEvidence,
    };
  }
}
