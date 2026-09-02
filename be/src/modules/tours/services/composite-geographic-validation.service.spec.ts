import { CompositeGeographicValidationService } from './composite-geographic-validation.service';

describe('CompositeGeographicValidationService', () => {
  const boundary: any = { geometry: { type: 'Polygon', coordinates: [[[-58.5, -34.7], [-58.3, -34.7], [-58.3, -34.5], [-58.5, -34.5], [-58.5, -34.7]]] } };
  const entity = (key: string, name: string, lat: number, longitude: number, role: 'venue' | 'waypoint' = 'venue') => ({ hintKey: key, hintName: name, provider: 'osm', externalId: name, canonicalName: name, latitude: lat, longitude, role, status: 'resolved' as const });
  const proposal: any = { name: 'Historic walk', themes: ['culture'], traits: [], componentHints: [{ key: 'a', name: 'A', role: 'venue' as const, expectedKind: 'PLACE' as const, required: true, evidenceKeys: ['e'] }, { key: 'b', name: 'B', role: 'waypoint' as const, expectedKind: 'PLACE' as const, required: false, evidenceKeys: ['e'] }], evidenceKeys: ['e'], shortReason: 'grounded' };

  it('validates a composite from its resolved components', () => {
    const result = new CompositeGeographicValidationService().validate({ proposal, status: 'accepted', resolvedEntities: [entity('a', 'A', -34.60, -58.40), entity('b', 'B', -34.61, -58.39, 'waypoint')], rejectionReasons: [] }, boundary);
    expect(result.accepted).toBe(true);
    expect(result.strategy).toBe('venue_centric');
  });

  it('rejects components outside the destination boundary', () => {
    const result = new CompositeGeographicValidationService().validate({ proposal: { ...proposal, name: 'Outside', componentHints: [proposal.componentHints[0]] }, status: 'accepted', resolvedEntities: [entity('a', 'A', -35, -59)], rejectionReasons: [] }, boundary);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('destination_mismatch');
  });
});
