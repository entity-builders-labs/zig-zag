import { GeoEntityKind } from '@prisma/client';
import {
  authorizesIdentityStrategy,
  buildIdentityAcquisitionPlan,
} from './identity-acquisition-plan.interface';

const authorization = { kind: 'DEFAULT' } as const;

describe('buildIdentityAcquisitionPlan', () => {
  it('explicitly authorizes the existing PLACE strategies and bounded Overture', () => {
    const plan = buildIdentityAcquisitionPlan({
      hintKey: 'alfa',
      expectedKind: GeoEntityKind.PLACE,
      geographicAuthorization: authorization,
      externalAcquisitionAuthorized: true,
      countryCode: 'AR',
    });
    expect(plan.strategies).toEqual([
      'NOMINATIM',
      'PLACES',
      'OVERTURE_IDENTITY',
    ]);
    expect(authorizesIdentityStrategy(plan, 'OVERTURE_IDENTITY')).toBe(true);
  });

  it('does not infer a fallback authorization from a prior provider failure', () => {
    const plan = buildIdentityAcquisitionPlan({
      hintKey: 'unassociated-place',
      expectedKind: GeoEntityKind.PLACE,
      geographicAuthorization: authorization,
      externalAcquisitionAuthorized: false,
      countryCode: 'AR',
    });
    expect(plan.strategies).toEqual([]);
  });

  it('never authorizes Overture Places for AREA or ROUTE hints', () => {
    for (const expectedKind of [GeoEntityKind.AREA, GeoEntityKind.ROUTE]) {
      const plan = buildIdentityAcquisitionPlan({
        hintKey: expectedKind,
        expectedKind,
        geographicAuthorization: authorization,
        externalAcquisitionAuthorized: true,
        countryCode: 'AR',
      });
      expect(plan.strategies).toEqual(['NOMINATIM']);
    }
  });

  it('does not authorize a worldwide Overture lookup without country context', () => {
    const plan = buildIdentityAcquisitionPlan({
      hintKey: 'place',
      expectedKind: GeoEntityKind.PLACE,
      geographicAuthorization: authorization,
      externalAcquisitionAuthorized: true,
    });
    expect(plan.strategies).toEqual(['NOMINATIM', 'PLACES']);
  });
});
