import { SerializableTraceStepInput } from '../generation-trace-recorder.util';
import { AtomizedSourceUnitTrace } from '../../interfaces/atomized-source-unit.interface';

/**
 * Atoms per `acquisition.atomized_source_atoms` step. A long unit (the SOB
 * fixture has 182 atoms) would exceed the recorder's array and step payload
 * limits in one step, so the per-atom record is paged.
 */
export const ATOMIZED_ATOM_TRACE_PAGE_SIZE = 50;

/**
 * The pre-identity fidelity trace of one atomized unit:
 *
 * - `acquisition.atomized_source_unit`: the unit summary, its contract
 *   outcome, batches and relabel activity, non-editorial blocks, every
 *   assembled segment with its mandatory membership before identity, and
 *   the non-membership entities by role;
 * - `acquisition.atomized_source_atoms`: every atom, in pages, with its
 *   offsets, label and entities.
 *
 * Together they prove what extraction produced even when identity later
 * rejects a candidate and no Experience is persisted.
 */
export function projectAtomizedSourceUnitSteps(
  unit: AtomizedSourceUnitTrace,
): SerializableTraceStepInput[] {
  const { atoms, ...summary } = unit;
  const failed = unit.contractOutcome !== 'ASSEMBLED';
  const reasonCodes = [
    ...new Set([
      ...unit.issues.map((x) => x.code),
      ...unit.memberKindIssues.map((x) => x.code),
      ...(unit.providerFailure ? ['PROVIDER_FAILURE'] : []),
    ]),
  ];
  const pageCount = Math.max(
    1,
    Math.ceil(atoms.length / ATOMIZED_ATOM_TRACE_PAGE_SIZE),
  );
  return [
    {
      name: 'acquisition.atomized_source_unit',
      description: `Unidad editorial atomizada ${unit.sourceUnitId}: ${unit.atomCount} átomos (${unit.nonEditorialAtomCount} no editoriales), ${unit.batchCount} lotes, ${unit.contractOutcome}, ${unit.candidateNames.length} candidatos`,
      component: 'AtomizedSourceUnitExtractor',
      decision: {
        status: failed
          ? 'FAIL'
          : unit.candidateNames.length > 0
            ? 'PASS'
            : 'WARN',
        outcome: unit.contractOutcome,
        ...(reasonCodes.length ? { reasonCodes } : {}),
      },
      facts: summary,
    },
    ...Array.from({ length: pageCount }, (_, page) => ({
      name: 'acquisition.atomized_source_atoms',
      description: `Átomos ${page + 1}/${pageCount} de ${unit.sourceUnitId}`,
      component: 'AtomizedSourceUnitExtractor',
      decision: { status: 'INFO' as const, outcome: unit.contractOutcome },
      facts: {
        sourceUnitId: unit.sourceUnitId,
        page: page + 1,
        pageCount,
        atoms: atoms.slice(
          page * ATOMIZED_ATOM_TRACE_PAGE_SIZE,
          (page + 1) * ATOMIZED_ATOM_TRACE_PAGE_SIZE,
        ),
      },
    })),
  ];
}
