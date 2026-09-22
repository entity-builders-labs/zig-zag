import { EntityCandidate } from '../interfaces/experience-resolution.interface';
import { GeoEntityKind } from '@prisma/client';
import { buildLocalIdentityEvidence } from './identity-evidence-builder.util';

const candidate = (
  overrides: {
    canonicalName?: string;
    nameEvidenceMultiplicity?: {
      exactName: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN';
      declaredAlias: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN';
    };
    nameAliasCandidates?: string[];
    addressConfirmed?: boolean;
  } = {},
): EntityCandidate => ({
  hintKey: 'test',
  hintName: 'Test Place',
  provider: 'openstreetmap',
  externalId: 'osm:node:1',
  canonicalName: 'Test Place',
  kind: GeoEntityKind.PLACE,
  role: 'venue',
  nameEvidenceMultiplicity: { exactName: 'SINGLE', declaredAlias: 'SINGLE' },
  nameAliasCandidates: [],
  addressConfirmed: false,
  ...overrides,
});

describe('buildLocalIdentityEvidence', () => {
  it('B1: canonicalName exact match + SINGLE -> EXACT_NAME / SINGLE', () => {
    const evidence = buildLocalIdentityEvidence(
      { name: 'Test Place' },
      candidate({
        canonicalName: 'Test Place',
        nameEvidenceMultiplicity: {
          exactName: 'SINGLE',
          declaredAlias: 'SINGLE',
        },
      }),
    );
    expect(evidence).toEqual([
      { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
    ]);
  });

  it('B2: canonicalName exact match + MULTIPLE -> EXACT_NAME / MULTIPLE', () => {
    const evidence = buildLocalIdentityEvidence(
      { name: 'Test Place' },
      candidate({
        canonicalName: 'Test Place',
        nameEvidenceMultiplicity: {
          exactName: 'MULTIPLE',
          declaredAlias: 'SINGLE',
        },
      }),
    );
    expect(evidence).toEqual([
      { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
    ]);
  });

  it('B3: canonicalName exact match + UNKNOWN -> EXACT_NAME / UNKNOWN', () => {
    const evidence = buildLocalIdentityEvidence(
      { name: 'Test Place' },
      candidate({
        canonicalName: 'Test Place',
        nameEvidenceMultiplicity: {
          exactName: 'UNKNOWN',
          declaredAlias: 'SINGLE',
        },
      }),
    );
    expect(evidence).toEqual([
      { type: 'EXACT_NAME', identityMultiplicity: 'UNKNOWN' },
    ]);
  });

  it('B4: canonical name not exact + own alias matches + UNKNOWN -> DECLARED_ALIAS_MATCH / UNKNOWN', () => {
    const evidence = buildLocalIdentityEvidence(
      { name: 'Defensa Street' },
      candidate({
        canonicalName: 'Defensa',
        nameEvidenceMultiplicity: {
          exactName: 'UNKNOWN',
          declaredAlias: 'UNKNOWN',
        },
        nameAliasCandidates: ['Defensa Street'],
      }),
    );
    expect(evidence).toEqual([
      { type: 'DECLARED_ALIAS_MATCH', identityMultiplicity: 'UNKNOWN' },
    ]);
  });

  it('B5: canonical name not exact + own alias matches + MULTIPLE -> DECLARED_ALIAS_MATCH / MULTIPLE', () => {
    const evidence = buildLocalIdentityEvidence(
      { name: 'Defensa Street' },
      candidate({
        canonicalName: 'Defensa',
        nameEvidenceMultiplicity: {
          exactName: 'UNKNOWN',
          declaredAlias: 'MULTIPLE',
        },
        nameAliasCandidates: ['Defensa Street'],
      }),
    );
    expect(evidence).toEqual([
      { type: 'DECLARED_ALIAS_MATCH', identityMultiplicity: 'MULTIPLE' },
    ]);
  });

  it('B6: canonical name not exact + own alias matches + SINGLE -> DECLARED_ALIAS_MATCH / SINGLE', () => {
    const evidence = buildLocalIdentityEvidence(
      { name: 'Defensa Street' },
      candidate({
        canonicalName: 'Defensa',
        nameEvidenceMultiplicity: {
          exactName: 'UNKNOWN',
          declaredAlias: 'SINGLE',
        },
        nameAliasCandidates: ['Defensa Street'],
      }),
    );
    expect(evidence).toEqual([
      { type: 'DECLARED_ALIAS_MATCH', identityMultiplicity: 'SINGLE' },
    ]);
  });

  it('addressConfirmed adds ADDRESS_MATCH regardless of multiplicity', () => {
    const evidence = buildLocalIdentityEvidence(
      { name: 'Test Place' },
      candidate({
        canonicalName: 'Test Place',
        nameEvidenceMultiplicity: {
          exactName: 'MULTIPLE',
          declaredAlias: 'SINGLE',
        },
        addressConfirmed: true,
      }),
    );
    expect(evidence).toContainEqual({ type: 'ADDRESS_MATCH' });
    expect(evidence).toContainEqual({
      type: 'EXACT_NAME',
      identityMultiplicity: 'MULTIPLE',
    });
  });

  it('no exact name and no alias match -> empty evidence', () => {
    const evidence = buildLocalIdentityEvidence(
      { name: 'Different Name' },
      candidate({
        canonicalName: 'Test Place',
        nameAliasCandidates: ['Other Alias'],
      }),
    );
    expect(evidence).toEqual([]);
  });

  it('exact name + alias both present -> both evidence types with correct multiplicities', () => {
    const evidence = buildLocalIdentityEvidence(
      { name: 'Test Place' },
      candidate({
        canonicalName: 'Test Place',
        nameEvidenceMultiplicity: {
          exactName: 'MULTIPLE',
          declaredAlias: 'MULTIPLE',
        },
        nameAliasCandidates: ['Test Place Alias'],
      }),
    );
    expect(evidence).toEqual([
      { type: 'EXACT_NAME', identityMultiplicity: 'MULTIPLE' },
      { type: 'DECLARED_ALIAS_MATCH', identityMultiplicity: 'MULTIPLE' },
    ]);
  });

  it('10A: exactName UNKNOWN + declaredAlias SINGLE -> NO EXACT_NAME, DECLARED_ALIAS_MATCH / SINGLE', () => {
    const evidence = buildLocalIdentityEvidence(
      { name: 'Defensa Street' },
      candidate({
        canonicalName: 'Defensa',
        nameEvidenceMultiplicity: {
          exactName: 'UNKNOWN',
          declaredAlias: 'SINGLE',
        },
        nameAliasCandidates: ['Defensa Street'],
      }),
    );
    expect(evidence).toEqual([
      { type: 'DECLARED_ALIAS_MATCH', identityMultiplicity: 'SINGLE' },
    ]);
  });

  it('10B: exact SINGLE does not create exact evidence when primary differs', () => {
    const evidence = buildLocalIdentityEvidence(
      { name: 'Defensa Street' },
      candidate({
        canonicalName: 'Defensa',
        nameEvidenceMultiplicity: {
          exactName: 'SINGLE',
          declaredAlias: 'UNKNOWN',
        },
        nameAliasCandidates: ['Defensa Street'],
      }),
    );

    expect(evidence).toEqual([
      { type: 'DECLARED_ALIAS_MATCH', identityMultiplicity: 'UNKNOWN' },
    ]);
  });
});
