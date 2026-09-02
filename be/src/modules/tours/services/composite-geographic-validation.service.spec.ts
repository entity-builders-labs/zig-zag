import { CompositeGeographicValidationService } from './composite-geographic-validation.service';

describe('CompositeGeographicValidationService', () => {
  const boundary: any = { geometry: { type: 'Polygon', coordinates: [[[-58.5, -34.7], [-58.3, -34.7], [-58.3, -34.5], [-58.5, -34.5], [-58.5, -34.7]]] } };
  it('accepts a resolved route component without requiring a second anchor', () => {
    const candidate: any = { name: 'Costanera route', themes: ['nature'], traits: [], evidenceKeys: ['e'], shortReason: 'grounded', componentHints: [{ key: 'r', name: 'Costanera', role: 'route', expectedKind: 'ROUTE', required: true, evidenceKeys: ['e'] }] };
    const result = new CompositeGeographicValidationService().validate({ candidate, status: 'accepted', resolvedEntities: [{ hintKey: 'r', hintName: 'Costanera', provider: 'osm', externalId: 'way:1', role: 'route', status: 'resolved', latitude: -34.6, longitude: -58.4, geometry: { type: 'LineString', coordinates: [[-58.4, -34.6], [-58.39, -34.61]] } }], rejectionReasons: [] }, boundary);
    expect(result.accepted).toBe(true);
  });
});
