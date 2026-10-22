import { osmTagsToAdmissionFacts } from '@integrations/osm/utils/osm-admission-adapter';
import { evaluateStructuredPlaceAdmissionFacts } from './structured-place-admission';

describe('structured place admission evidence combination', () => {
  it('rejects historic classification without independent evidence', () => {
    const result = evaluateStructuredPlaceAdmissionFacts({
      osmFacts: osmTagsToAdmissionFacts({ historic: 'memorial' }),
    });

    expect(result.decision).toEqual({
      admitted: false,
      reason: 'INSUFFICIENT_ADMISSION_EVIDENCE',
    });
  });

  it('admits a descriptive classification with linked sitelink notability', () => {
    const result = evaluateStructuredPlaceAdmissionFacts({
      osmFacts: osmTagsToAdmissionFacts({ historic: 'memorial' }),
      wikidataFacts: { sitelinkCount: 1 },
    });

    expect(result.decision).toEqual({
      admitted: true,
      signals: ['ENCYCLOPEDIC_NOTABILITY', 'HISTORIC_CLASSIFICATION'],
    });
  });

  it('does not treat a QID identity by itself as admission evidence', () => {
    const result = evaluateStructuredPlaceAdmissionFacts({
      osmFacts: osmTagsToAdmissionFacts({ wikidata: 'Q123' }),
    });

    expect(result.decision).toEqual({
      admitted: false,
      reason: 'INSUFFICIENT_ADMISSION_EVIDENCE',
    });
  });

  it('keeps artwork classification supporting without independent evidence', () => {
    const result = evaluateStructuredPlaceAdmissionFacts({
      osmFacts: osmTagsToAdmissionFacts({ tourism: 'artwork' }),
    });

    expect(result.decision).toEqual({
      admitted: false,
      reason: 'INSUFFICIENT_ADMISSION_EVIDENCE',
    });
  });
});
