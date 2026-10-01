import { RequestedFacet } from '../interfaces/preference-spec.interface';
import {
  deriveRequestValidationIntent,
  validationIntentOf,
} from './request-validation-intent.util';

const facet = (dimension: string, key: string): RequestedFacet => ({
  dimension,
  key,
  weight: 1,
  source: 'wizard',
  required: false,
});

describe('deriveRequestValidationIntent', () => {
  it('returns route_like for a request carrying intent:route_like', () => {
    const decision = deriveRequestValidationIntent([
      facet('theme', 'wine'),
      facet('intent', 'visit'),
      facet('intent', 'route_like'),
    ]);
    expect(decision).toEqual({ status: 'SINGLE', intent: 'route_like' });
    expect(validationIntentOf(decision)).toBe('route_like');
  });

  it('returns walk for a request carrying intent:walk', () => {
    const decision = deriveRequestValidationIntent([facet('intent', 'walk')]);
    expect(decision).toEqual({ status: 'SINGLE', intent: 'walk' });
    expect(validationIntentOf(decision)).toBe('walk');
  });

  it('returns NONE when the request has no walk/route_like intent', () => {
    const decision = deriveRequestValidationIntent([
      facet('theme', 'wine'),
      facet('intent', 'visit'),
    ]);
    expect(decision).toEqual({ status: 'NONE' });
    expect(validationIntentOf(decision)).toBeUndefined();
  });

  it('fails closed on mixed walk + route_like', () => {
    const decision = deriveRequestValidationIntent([
      facet('intent', 'walk'),
      facet('intent', 'route_like'),
    ]);
    expect(decision).toEqual({ status: 'MIXED_UNSUPPORTED' });
    expect(validationIntentOf(decision)).toBeUndefined();
  });

  it('only reads the intent dimension', () => {
    const decision = deriveRequestValidationIntent([
      facet('theme', 'route_like'),
      facet('trait', 'walk'),
    ]);
    expect(decision).toEqual({ status: 'NONE' });
  });
});
