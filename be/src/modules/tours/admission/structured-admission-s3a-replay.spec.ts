import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  evaluateStructuredPlaceAdmission,
  StructuredPlaceAdmissionRecord,
} from './structured-place-admission';
import { WikidataAdmissionFacts } from '@integrations/wikidata/utils/wikidata-admission-adapter';

/**
 * Spike 3 S3-A replay under the new admission rule (task 36.2). Zero live
 * provider calls: it reads the committed S3-A provider recordings and the
 * S3-A run artifacts. Evidence, not a tuning exercise — the policy is NOT
 * changed here to preserve old counts.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const RUN = join(
  REPO_ROOT,
  'spikes',
  'structured-places-baseline-2026-10-11',
  'runs',
  'S3-A',
);
const RECORDINGS = join(
  REPO_ROOT,
  'spikes',
  'structured-places-baseline-2026-10-11',
  'runs',
  'recordings',
);

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags: Record<string, string>;
}

interface SparqlBinding {
  item?: { value?: string };
  sitelinks?: { value?: string };
  isMuseum?: { value?: string };
  heritage?: { value?: string };
}

interface WikidataFactsRow {
  qid: string;
  sitelinks: number;
  museumClass: boolean;
  heritage?: string;
}

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));

function overpassElements(): OverpassElement[] {
  const file = readdirSync(RECORDINGS).find((name) =>
    name.startsWith('overpass.queryPoisWithinArea.'),
  );
  if (!file) {
    throw new Error('S3-A overpass.queryPoisWithinArea recording missing');
  }
  const recording = readJson(join(RECORDINGS, file));
  return recording.result as OverpassElement[];
}

function wikidataFactsByQid(): Map<string, WikidataFactsRow> {
  const map = new Map<string, WikidataFactsRow>();
  for (const file of readdirSync(RECORDINGS).filter((name) =>
    name.startsWith('wikidata.sparql-facts-discovery.'),
  )) {
    const recording = readJson(join(RECORDINGS, file));
    const rows: SparqlBinding[] = recording.result ?? [];
    for (const row of rows) {
      const qid = row.item?.value?.split('/').pop();
      if (!qid || !/^Q\d+$/.test(qid)) continue;
      map.set(qid, {
        qid,
        sitelinks: Number(row.sitelinks?.value ?? 0),
        museumClass: row.isMuseum?.value === 'true',
        ...(row.heritage?.value
          ? { heritage: row.heritage.value.split('\u001e')[0] }
          : {}),
      });
    }
  }
  return map;
}

function wikidataFacts(
  row: WikidataFactsRow | undefined,
): WikidataAdmissionFacts {
  if (!row) return { sitelinkCount: 0 };
  return {
    instanceOf: row.museumClass ? ['Q33506'] : [],
    heritageDesignation: row.heritage ? [row.heritage] : [],
    sitelinkCount: row.sitelinks,
  };
}

function admissionFor(
  element: OverpassElement,
  wikidata: Map<string, WikidataFactsRow>,
): StructuredPlaceAdmissionRecord {
  const qid = element.tags.wikidata;
  const facts = qid ? wikidataFacts(wikidata.get(qid)) : undefined;
  return evaluateStructuredPlaceAdmission({
    tags: element.tags,
    wikidataFacts: facts,
  });
}

describe('structured admission S3-A replay (task 36.2)', () => {
  const elements = overpassElements();
  const wikidata = wikidataFactsByQid();
  const tour = readJson(join(RUN, 'tour.json')) as Array<{
    placeId: string;
    name: string;
    admissionClass: string;
  }>;
  const oldAdmissions = readJson(join(RUN, 'admissions-after.json')) as Record<
    string,
    {
      externalId: string;
      admitted: boolean;
      reason?: string;
      admissionClass?: string;
      name: string;
    }
  >;

  const externalIdOf = (element: OverpassElement) =>
    `osm:${element.type}:${element.id}`;
  const byExternalId = new Map(
    elements.map((element) => [externalIdOf(element), element]),
  );
  const decisions = new Map(
    elements.map((element) => [
      externalIdOf(element),
      admissionFor(element, wikidata),
    ]),
  );
  const admitted = elements.filter(
    (element) => decisions.get(externalIdOf(element))?.decision.admitted,
  );

  it('every accepted S3-A Tour stop remains admitted under the new rule', () => {
    const outcomes = tour.map((stop) => {
      const externalId = stop.placeId.replace('geo:', '');
      return {
        stop,
        element: byExternalId.get(externalId),
        decision: decisions.get(externalId),
      };
    });
    expect(outcomes.every((o) => !!o.element)).toBe(true);
    const notAdmitted = outcomes.filter((o) => !o.decision?.decision.admitted);
    expect(notAdmitted.map((o) => o.stop.name)).toEqual([]);
  });

  it('bare tourism=artwork without notability is rejected INSUFFICIENT_ADMISSION_EVIDENCE', () => {
    const bareArtworks = elements.filter(
      (element) =>
        element.tags.tourism === 'artwork' &&
        !element.tags.historic &&
        !element.tags.heritage &&
        !element.tags.wikidata,
    );
    expect(bareArtworks.length).toBeGreaterThan(0);
    for (const element of bareArtworks) {
      expect(decisions.get(externalIdOf(element))?.decision).toEqual({
        admitted: false,
        reason: 'INSUFFICIENT_ADMISSION_EVIDENCE',
      });
    }
  });

  it('records counts by reason and signal; La Bombonera stays absent', () => {
    const byReason = new Map<string, number>();
    const bySignal = new Map<string, number>();
    for (const record of decisions.values()) {
      const decision = record.decision;
      if (decision.admitted === false) {
        byReason.set(decision.reason, (byReason.get(decision.reason) ?? 0) + 1);
      } else {
        for (const signal of record.signals) {
          bySignal.set(signal, (bySignal.get(signal) ?? 0) + 1);
        }
      }
    }
    const stadiums = elements.filter((element) =>
      /bombonera|alberto j\. armando/i.test(element.tags.name ?? ''),
    );
    expect(stadiums).toEqual([]);
    console.log(
      JSON.stringify(
        {
          totalCandidates: elements.length,
          admittedCount: admitted.length,
          rejectedCount: elements.length - admitted.length,
          byReason: Object.fromEntries(byReason),
          bySignal: Object.fromEntries(
            [...bySignal.entries()].sort((a, b) => b[1] - a[1]),
          ),
          laBomboneraOutcome: 'ABSENT (stadiums outside signal-bearing keys)',
        },
        null,
        2,
      ),
    );
  });

  it('previously admitted visitable-class-only places now require notability (intended R4-D3 consequence)', () => {
    const noLongerAdmitted = Object.values(oldAdmissions)
      .filter((old) => old.admitted)
      .filter((old) => {
        const decision = decisions.get(old.externalId);
        return decision && !decision.decision.admitted;
      });
    const byOldClass = new Map<string, number>();
    for (const old of noLongerAdmitted) {
      byOldClass.set(
        old.admissionClass ?? '?',
        (byOldClass.get(old.admissionClass ?? '?') ?? 0) + 1,
      );
    }
    expect(
      noLongerAdmitted.some((old) => old.admissionClass === 'tourism:artwork'),
    ).toBe(true);
    console.log(
      JSON.stringify(
        {
          previouslyAdmittedNoLongerPass: noLongerAdmitted.length,
          byOldAdmissionClass: Object.fromEntries(
            [...byOldClass.entries()].sort((a, b) => b[1] - a[1]),
          ),
        },
        null,
        2,
      ),
    );
  });
});
