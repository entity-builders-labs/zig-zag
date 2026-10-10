import { readFileSync } from 'fs';
import { join } from 'path';
import { DiscoveryStructuredCompletionRequest } from '../interfaces/experience-discovery.interface';
import {
  ATOM_LABELLING_SYSTEM_PROMPT,
  MEMBER_KIND_SYSTEM_PROMPT,
} from '../prompts/source-atom-labelling.prompt';

/**
 * Frozen RW4-EXTRACT-COMPLETENESS-1 inputs for the atomized source-unit
 * contract (milestone B):
 *
 * - `sob-day1-unit.md`, `ag-san-telmo-unit.md`: the two complete editorial
 *   units exactly as the production windowing emits them (SECTION_UNIT,
 *   sectionComplete=true), `sob-day1-page.md` the full SOB page;
 * - `spike-golden.json`: the accepted spike's atomization, editorial
 *   structure, batch plan and prompt hashes for those units;
 * - `recorded-*-run1.json`: live Gemini labelling answers the spike recorded
 *   at current settings, with the spike's own assembled segments.
 */
const DIR = join(__dirname, 'atomized-source-units');

export const readAtomizedFixture = (file: string): string =>
  readFileSync(join(DIR, file), 'utf8');

export interface RecordedAtomLabellingRun {
  batchAnswers: string[];
  relabelAnswer: string | null;
  spikeRelabelScope: string[] | null;
  spikeSegments: Array<{
    mandatory: string[];
    openedBy: string[];
    optional: string[];
    alternativeGroups: string[][];
    routeLegs: string[];
    passBy: string[];
  }>;
}

export const recordedRun = (file: string): RecordedAtomLabellingRun =>
  JSON.parse(readAtomizedFixture(file));

/**
 * Transport double: replays recorded labelling answers in call order and
 * answers member-kind calls from `kindOf` (hand-written, like every label
 * fixture). Any other call (source locality recovery) fails, which that
 * step tolerates by contract.
 */
export function recordedAtomTransport(
  run: Pick<RecordedAtomLabellingRun, 'batchAnswers' | 'relabelAnswer'>,
  kindOf: (name: string) => string = () => 'PLACE',
  overrides: {
    batch?: (index: number) => Promise<string> | undefined;
    kind?: (
      members: Array<{ memberId: string; name: string }>,
    ) => Promise<string> | undefined;
  } = {},
) {
  let batch = 0;
  const requests: DiscoveryStructuredCompletionRequest[] = [];
  const completeStructured = async (
    request: DiscoveryStructuredCompletionRequest,
  ): Promise<string> => {
    requests.push(request);
    if (request.system === ATOM_LABELLING_SYSTEM_PROMPT) {
      if (request.user.startsWith('Your previous labels'))
        return run.relabelAnswer;
      batch++;
      const forced = overrides.batch?.(batch);
      if (forced) return forced;
      return run.batchAnswers[batch - 1];
    }
    if (request.system === MEMBER_KIND_SYSTEM_PROMPT) {
      const members = [
        ...request.user.matchAll(/^\[(m-\d+)\] ("(?:[^"\\]|\\.)*")/gmu),
      ].map((m) => ({ memberId: m[1], name: JSON.parse(m[2]) as string }));
      const forced = overrides.kind?.(members);
      if (forced) return forced;
      return JSON.stringify({
        members: members.map((m) => ({
          memberId: m.memberId,
          physicalKind: kindOf(m.name),
        })),
      });
    }
    throw new Error('locality recovery is not under test here');
  };
  return { transport: { completeStructured }, requests };
}
