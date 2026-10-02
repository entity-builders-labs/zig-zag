import { AcquisitionEvidenceRequirement } from '../interfaces/acquisition-evidence-requirement.interface';
import {
  ExperienceCandidate,
  GeoEntityHint,
} from '../interfaces/experience-discovery.interface';

/**
 * Deterministic, provider-neutral fingerprint used ONLY to collapse an
 * *obvious* duplicate componentHint (the same real component the extractor
 * happened to emit twice, possibly under a different hint `key` or
 * `evidenceKeys`) before counting distinct components. Case/diacritics/
 * punctuation/whitespace normalization only -- no fuzzy matching, no
 * aliases, no semantic similarity, no coordinates/provider identity, and no
 * Stage 3 canonical-identity logic. Two hints whose names merely *might*
 * later prove to be aliases of the same real place stay distinct here;
 * identity resolution is Stage 3's job.
 */
function normalizeComponentName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function componentFingerprint(hint: GeoEntityHint): string {
  return `${normalizeComponentName(hint.name)}|${hint.role}|${hint.expectedKind}`;
}

/** Distinct non-area componentHints, collapsed by `componentFingerprint`. */
function distinctMeaningfulComponents(
  candidate: ExperienceCandidate,
): GeoEntityHint[] {
  const meaningfulHints = candidate.componentHints.filter(
    (hint) => hint.role !== 'area',
  );
  const seen = new Set<string>();
  const distinct: GeoEntityHint[] = [];
  for (const hint of meaningfulHints) {
    const fingerprint = componentFingerprint(hint);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    distinct.push(hint);
  }
  return distinct;
}

/**
 * Structural composition contract (Amendment 09-22 §3/§16.1): a
 * multi-component Experience has at least this many distinct non-area
 * components. A count, never a distance. The single owner — composite
 * geographic validation reuses it for the resolved (entity-deduped) count.
 */
export const MULTI_COMPONENT_MIN_DISTINCT_COMPONENTS = 2;

/**
 * Stage 2 cutover (component-resolution-and-partial-composite-recovery-plan.md):
 * admission is decided from source-backed composition, not from a
 * per-component LLM-authored `required` flag (removed from `GeoEntityHint`).
 * Every hint reaching this function has already passed the deterministic
 * source-support gate (experience-candidate-extraction.util.ts /
 * component-source-support.util.ts), so "every evidence-backed non-area
 * component" IS the composition signal (amendment §3) -- but the same
 * obvious component duplicated across componentHints must count once, per
 * the Stage 2 corrective fix (see `distinctMeaningfulComponents`).
 */
export function candidateSatisfiesEvidenceRequirement(
  candidate: ExperienceCandidate,
  requirement: AcquisitionEvidenceRequirement,
): boolean {
  const distinctHints = distinctMeaningfulComponents(candidate);

  switch (requirement) {
    case 'SINGLE_PLACE':
      return (
        distinctHints.length === 1 && distinctHints[0].expectedKind === 'PLACE'
      );
    case 'MULTI_COMPONENT_EXPERIENCE':
      return distinctHints.length >= MULTI_COMPONENT_MIN_DISTINCT_COMPONENTS;
  }
}
