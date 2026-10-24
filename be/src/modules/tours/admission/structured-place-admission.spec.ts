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

  it('keeps an independently decisive visitor classification without linked notability', () => {
    const result = evaluateStructuredPlaceAdmissionFacts({
      osmFacts: osmTagsToAdmissionFacts({ tourism: 'attraction' }),
      wikidataFacts: {},
    });

    expect(result.decision).toEqual({
      admitted: true,
      signals: ['EXPLICIT_VISITOR_CLASSIFICATION'],
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

  it('admits a compatible venue class with explicit independent public visitability and no Wikidata', () => {
    const result = evaluateStructuredPlaceAdmissionFacts({
      osmFacts: osmTagsToAdmissionFacts({
        amenity: 'restaurant',
        access: 'customers',
      }),
    });

    expect(result.decision).toMatchObject({ admitted: true });
    expect(result.signals).toEqual(
      expect.arrayContaining([
        'PLACE_VENUE_CLASSIFICATION',
        'INDEPENDENT_VISITABILITY_EVIDENCE',
      ]),
    );
  });

  it('does not let explicit access turn a classified historic object into a venue', () => {
    const result = evaluateStructuredPlaceAdmissionFacts({
      osmFacts: osmTagsToAdmissionFacts({
        historic: 'memorial',
        access: 'yes',
      }),
    });

    expect(result.decision).toEqual({
      admitted: false,
      reason: 'INSUFFICIENT_ADMISSION_EVIDENCE',
    });
  });

  it('does not let explicit access turn artwork into an independently visitable venue', () => {
    const result = evaluateStructuredPlaceAdmissionFacts({
      osmFacts: osmTagsToAdmissionFacts({
        tourism: 'artwork',
        access: 'yes',
      }),
    });

    expect(result.decision).toEqual({
      admitted: false,
      reason: 'INSUFFICIENT_ADMISSION_EVIDENCE',
    });
  });
});
