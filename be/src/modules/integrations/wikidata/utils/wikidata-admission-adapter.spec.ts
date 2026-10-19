import { wikidataFactsToAdmissionSignals } from './wikidata-admission-adapter';

const signalTypes = (
  facts: Parameters<typeof wikidataFactsToAdmissionSignals>[0],
) => wikidataFactsToAdmissionSignals(facts).map((signal) => signal.type);

describe('Wikidata admission adapter (task 37.1)', () => {
  it('maps a museum root class (Q33506) to decisive EXPLICIT_VISITOR_CLASSIFICATION', () => {
    expect(signalTypes({ instanceOf: ['Q33506'] })).toContain(
      'EXPLICIT_VISITOR_CLASSIFICATION',
    );
  });

  it('maps a heritage designation (P1435) to HERITAGE_DESIGNATION', () => {
    expect(signalTypes({ heritageDesignation: ['Q19903688'] })).toContain(
      'HERITAGE_DESIGNATION',
    );
  });

  it('maps sitelinks to ENCYCLOPEDIC_NOTABILITY only when present', () => {
    expect(signalTypes({ sitelinkCount: 9 })).toContain(
      'ENCYCLOPEDIC_NOTABILITY',
    );
    expect(signalTypes({ sitelinkCount: 0 })).not.toContain(
      'ENCYCLOPEDIC_NOTABILITY',
    );
    expect(signalTypes({})).not.toContain('ENCYCLOPEDIC_NOTABILITY');
  });

  it('produces no signals for a bare QID with no class, heritage or sitelinks', () => {
    expect(signalTypes({})).toEqual([]);
  });
});
