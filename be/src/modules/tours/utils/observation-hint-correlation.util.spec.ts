import {
  findReusableObservationCandidate,
  isBidirectionallyCorrelated,
} from './observation-hint-correlation.util';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';

function observation(
  overrides: Partial<SourceObservation> = {},
): SourceObservation {
  return {
    provider: 'google_places',
    externalId: 'ChIJ1',
    title: 'El Zanjón de Granados',
    evidenceType: 'place',
    evidenceKey: 'google_places:ChIJ1',
    originationCapabilities: [],
    ...overrides,
  };
}

describe('isBidirectionallyCorrelated', () => {
  it('does NOT correlate "Puerto Madero" with the unrelated real POI "Templo Beit Jabad Puerto Madero" (real regression: every hint token is a strict subset of the longer title, so a ONE-directional strict-overlap check alone wrongly matches; the reverse direction -- only 2 of 5 title tokens covered by the hint -- correctly rejects it)', () => {
    expect(
      isBidirectionallyCorrelated(
        'Puerto Madero',
        'Templo Beit Jabad Puerto Madero',
      ),
    ).toBe(false);
  });

  it('correlates "Zanjón de Granados" with "El Zanjón de Granados" (genuine paraphrase: a leading article and an accent difference, every significant token shared both ways)', () => {
    expect(
      isBidirectionallyCorrelated(
        'Zanjón de Granados',
        'El Zanjón de Granados',
      ),
    ).toBe(true);
  });

  it('does NOT correlate "Museo de Arte" with the more specific, different real place "Museo de Arte Moderno" (reverse direction fails: only 2 of the longer title\'s 3 significant tokens are covered by the shorter hint)', () => {
    expect(
      isBidirectionallyCorrelated('Museo de Arte', 'Museo de Arte Moderno'),
    ).toBe(false);
  });

  it('correlates an exact match', () => {
    expect(isBidirectionallyCorrelated('El Zanjón', 'El Zanjón')).toBe(true);
  });

  it('never correlates against an empty name on either side', () => {
    expect(isBidirectionallyCorrelated('', 'El Zanjón')).toBe(false);
    expect(isBidirectionallyCorrelated('El Zanjón', '')).toBe(false);
  });
});

describe('findReusableObservationCandidate', () => {
  it('returns { status: "none" } when no observation correlates', () => {
    const result = findReusableObservationCandidate(
      { name: 'El Zanjón de Granados' },
      [observation({ title: 'Unrelated Place' })],
    );
    expect(result).toEqual({ status: 'none' });
  });

  it('returns { status: "unique", observation } when exactly one observation correlates', () => {
    const match = observation({ title: 'El Zanjón de Granados' });
    const result = findReusableObservationCandidate(
      { name: 'Zanjón de Granados' },
      [observation({ title: 'Unrelated Place' }), match],
    );
    expect(result).toEqual({ status: 'unique', observation: match });
  });

  it('returns { status: "ambiguous" } when two DIFFERENT observations both correlate (real-world uniqueness is never assumed from a single acquisition run -- P0.2)', () => {
    const first = observation({
      provider: 'google_places',
      externalId: 'ChIJ1',
      title: 'El Zanjón de Granados',
    });
    const second = observation({
      provider: 'geoapify',
      externalId: 'geo-2',
      title: 'El Zanjón de Granados',
    });
    const result = findReusableObservationCandidate(
      { name: 'Zanjón de Granados' },
      [first, second],
    );
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates).toEqual([first, second]);
    }
  });

  it('treats the SAME observation identity (same provider+externalId) appearing twice as unique, not ambiguous', () => {
    const match = observation({
      provider: 'google_places',
      externalId: 'ChIJ1',
      title: 'El Zanjón de Granados',
    });
    const duplicateReference = { ...match };
    const result = findReusableObservationCandidate(
      { name: 'Zanjón de Granados' },
      [match, duplicateReference],
    );
    expect(result.status).toBe('unique');
  });
});
