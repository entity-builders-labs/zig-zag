import { RowOracle, SeedRow } from './corpus';
import { traceStep } from './harness';

export interface SelectedRow {
  experienceId: string;
  cluster: string;
  qualityScore: number;
  themes: string[];
}

export function selected(tour: any): SelectedRow[] {
  return (tour.experiences ?? []).map((item: any) => ({
    experienceId: item.experienceId,
    cluster: item.experience?.metadata?.oracle?.cluster ?? 'unknown',
    qualityScore:
      item.experience?.qualityScore ??
      item.experience?.metadata?.oracle?.qualityScore ??
      0,
    themes: item.experience?.metadata?.themes ?? [],
  }));
}

export function selectedClusters(tour: any): string[] {
  return selected(tour).map((s) => s.cluster);
}

export function clusterShare(tour: any, key: string): number {
  const clusters = selectedClusters(tour);
  if (clusters.length === 0) return 0;
  return clusters.filter((c) => c === key).length / clusters.length;
}

/**
 * Experience IDs recorded as `candidate_pool.selection` subjects. The trace
 * recorder may drop trailing subjects to respect its per-step payload ceiling,
 * so this is bounded evidence: sound for presence claims only, never absence.
 */
export function poolCandidateIds(tour: any): string[] {
  return (traceStep(tour, 'candidate_pool.selection')?.subjects ?? []).map(
    (s: any) => s.subject.id as string,
  );
}

export function poolHasCluster(tour: any, key: string): boolean {
  return poolCandidateIds(tour).some((id) => id.includes(`-${key}-`));
}

export function poolClusterCount(tour: any, key: string): number {
  return poolCandidateIds(tour).filter((id) => id.includes(`-${key}-`)).length;
}

/** Trace steps proving acquisition / web discovery ran for this request. */
export function acquisitionStepNames(tour: any): string[] {
  return (tour.metadata.generationTrace.steps ?? [])
    .map((step: any) => step.name as string)
    .filter(
      (name: string) =>
        name.startsWith('acquisition.') ||
        name === 'resolution.entity' ||
        name === 'geography.validation' ||
        name === 'catalog.materialization',
    );
}

/** Stable plan projection for determinism assertions. */
export function plan(tour: any): unknown {
  return (tour.experiences ?? []).map((item: any) => ({
    experienceId: item.experienceId,
    dayNumber: item.dayNumber,
    order: item.order,
    startTime: item.startTime,
    duration: item.duration,
  }));
}

/* ------------------------------------------------------------------ *
 * Diversity — MEASURED, never asserted.
 * ------------------------------------------------------------------ */

export interface DiversitySummary {
  selectedCount: number;
  distinctClusters: number;
  maxSingleClusterShare: number;
  distinctThemes: number;
  clusterHistogram: Record<string, number>;
}

export function summarizeSelectionDiversity(tour: any): DiversitySummary {
  const rows = selected(tour);
  const hist: Record<string, number> = {};
  for (const row of rows) hist[row.cluster] = (hist[row.cluster] ?? 0) + 1;
  const themes = new Set<string>();
  for (const row of rows) for (const t of row.themes) themes.add(t);
  const max = Math.max(0, ...Object.values(hist));
  return {
    selectedCount: rows.length,
    distinctClusters: Object.keys(hist).length,
    maxSingleClusterShare: rows.length ? max / rows.length : 0,
    distinctThemes: themes.size,
    clusterHistogram: hist,
  };
}

/* ------------------------------------------------------------------ *
 * Strict dominance / regret — conservative, taste-free, test-side.
 * ------------------------------------------------------------------ */

export interface DominatedFinding {
  selected: string;
  dominatedBy: string[];
  onKeys: string[];
}

const sat = (oracle: RowOracle, key: string): number =>
  oracle.preferenceTags.includes(key) ? 1 : 0;

/**
 * A selected row S is "strictly dominated" by a feasible non-selected row C
 * when, restricted to the profile's requested facet keys, C satisfies every
 * one at least as well as S, strictly more on at least one, is feasible /
 * geographically fine, and is not materially worse on quality. `iconicity` /
 * `localness` (taste axes) are never used as ordinal "better".
 */
export function findStrictlyDominatedSelections(
  requestedFacetKeys: string[],
  selectedRows: SelectedRow[],
  feasibleNonSelected: SeedRow[],
  oracleById: Map<string, RowOracle>,
): DominatedFinding[] {
  const keys = requestedFacetKeys;
  const findings: DominatedFinding[] = [];

  for (const sel of selectedRows) {
    const so = oracleById.get(sel.experienceId);
    if (!so) continue;
    const dominators = feasibleNonSelected.filter((cand) => {
      const co = oracleById.get(cand.id);
      if (!co || !co.feasible || !co.geoOk) return false;
      const atLeastAsGood = keys.every((k) => sat(co, k) >= sat(so, k));
      const strictlyBetter = keys.some((k) => sat(co, k) > sat(so, k));
      const notWorseOnQuality =
        (co.qualityScore ?? 0) >= (so.qualityScore ?? 0);
      return atLeastAsGood && strictlyBetter && notWorseOnQuality;
    });
    if (dominators.length > 0) {
      const onKeys = keys.filter((k) =>
        dominators.some((d) => sat(oracleById.get(d.id)!, k) > sat(so, k)),
      );
      findings.push({
        selected: sel.experienceId,
        dominatedBy: dominators.map((d) => d.id),
        onKeys,
      });
    }
  }
  return findings;
}

/** Feasible corpus rows not selected in this tour (optionally post-hard-exclusion). */
export function feasibleNonSelected(
  tour: any,
  seedRows: SeedRow[],
  excludePredicate?: (row: SeedRow) => boolean,
): SeedRow[] {
  const chosen = new Set(selected(tour).map((s) => s.experienceId));
  return seedRows.filter(
    (row) =>
      !chosen.has(row.id) &&
      row.oracle.feasible &&
      row.oracle.geoOk &&
      !(excludePredicate?.(row) ?? false),
  );
}
