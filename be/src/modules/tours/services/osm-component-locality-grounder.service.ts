import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  INominatimApiService,
  NominatimResult,
} from '@integrations/osm/interfaces/nominatim.interface';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import {
  ComponentLocalityGrounder,
  LocalityGrounding,
} from '../interfaces/component-identity-context.interface';
import { ComponentLocalityAssertion } from '../interfaces/experience-discovery.interface';
import { classifyComponentAreaRelation } from '../utils/area-scope-membership-policy';
import { normalizeGeoName } from '../utils/nominatim-match.util';

/**
 * Grounds a source-stated component locality in a real OSM administrative
 * boundary (amendment §19).
 *
 * - Candidates are administrative boundary relations in the destination
 *   country whose own name IS the stated locality, or ends with it after
 *   a leading designator ("Lujan de Cuyo" -> "Departamento Luján de
 *   Cuyo"). Never a substring elsewhere, never a fuzzy match.
 * - Several matches are accepted only when they form one nested chain
 *   (a department and a district of the same name). The OUTERMOST boundary
 *   is used: the broader reading of "in X" never manufactures a locality
 *   contradiction that a narrower reading would.
 * - Unrelated homonyms are AMBIGUOUS_BOUNDARY. No match is NO_BOUNDARY. A
 *   provider failure is PROVIDER_FAILURE. Each is missing evidence, never a
 *   contradiction.
 */
@Injectable()
export class OsmComponentLocalityGrounder implements ComponentLocalityGrounder {
  constructor(
    private readonly osmPlaces: OsmPlacesService,
    @Optional()
    @Inject('NominatimApiService')
    private readonly nominatim?: INominatimApiService,
  ) {}

  async groundLocality(
    assertion: ComponentLocalityAssertion,
    countryCode: string | undefined,
  ): Promise<LocalityGrounding> {
    const ungrounded = (
      reason: Extract<LocalityGrounding, { status: 'UNGROUNDED' }>['reason'],
    ): LocalityGrounding => ({ status: 'UNGROUNDED', assertion, reason });
    if (!countryCode) return ungrounded('NO_COUNTRY');
    if (!this.nominatim) return ungrounded('PROVIDER_FAILURE');

    const needle = normalizeGeoName(assertion.locality);
    if (!needle) return ungrounded('NO_BOUNDARY');
    let results: NominatimResult[];
    try {
      results = await this.nominatim.search(assertion.locality, {
        countryCode,
        resultWindow: 'PROVIDER_MAXIMUM',
      });
    } catch {
      return ungrounded('PROVIDER_FAILURE');
    }
    const matches = results.filter((result) => {
      if (
        result.class !== 'boundary' ||
        result.type !== 'administrative' ||
        result.osmType !== 'relation'
      ) {
        return false;
      }
      const name = normalizeGeoName(result.displayName.split(',')[0] ?? '');
      return name === needle || name.endsWith(` ${needle}`);
    });
    if (matches.length === 0) return ungrounded('NO_BOUNDARY');

    const boundaries: Array<{
      result: NominatimResult;
      geometry: NonNullable<
        Awaited<ReturnType<OsmPlacesService['lookupBoundaryById']>>['value']
      >['geometry'];
    }> = [];
    for (const result of matches) {
      const boundary = await this.osmPlaces.lookupBoundaryById(
        'relation',
        result.osmId,
      );
      if (boundary.status === 'failed') return ungrounded('PROVIDER_FAILURE');
      if (boundary.value) {
        boundaries.push({ result, geometry: boundary.value.geometry });
      }
    }
    if (boundaries.length === 0) return ungrounded('NO_BOUNDARY');

    // A label point can sit inside a nested boundary too (a department's
    // point in its capital district), so of the boundaries that contain
    // every other match, the one with the largest extent is the outermost.
    const containers = boundaries.filter((outer) =>
      boundaries.every(
        (other) =>
          other === outer ||
          (Number.isFinite(other.result.latitude) &&
            Number.isFinite(other.result.longitude) &&
            classifyComponentAreaRelation(outer.geometry, {
              role: 'venue',
              latitude: other.result.latitude as number,
              longitude: other.result.longitude as number,
            }).relation === 'INSIDE'),
      ),
    );
    const outermost = containers.sort(
      (a, b) => extentOf(b.geometry) - extentOf(a.geometry),
    )[0];
    if (!outermost) return ungrounded('AMBIGUOUS_BOUNDARY');
    return {
      status: 'GROUNDED',
      assertion,
      boundary: {
        provider: 'openstreetmap',
        externalId: `osm:relation:${outermost.result.osmId}`,
        name: outermost.result.displayName.split(',')[0]?.trim() ?? '',
        geometry: outermost.geometry,
      },
    };
  }
}

/** Bounding-box extent in squared degrees: only compares nested boundaries. */
function extentOf(geometry: unknown): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      minX = Math.min(minX, value[0]);
      maxX = Math.max(maxX, value[0]);
      minY = Math.min(minY, value[1]);
      maxY = Math.max(maxY, value[1]);
      return;
    }
    for (const item of value) visit(item);
  };
  visit((geometry as { coordinates?: unknown })?.coordinates);
  return Number.isFinite(minX) ? (maxX - minX) * (maxY - minY) : 0;
}
