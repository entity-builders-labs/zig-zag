import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OsmPlacesService,
  OsmCandidate,
} from '@integrations/osm/services/osm-places.service';
import {
  INominatimApiService,
  NominatimResult,
} from '@integrations/osm/interfaces/nominatim.interface';
import { DestinationScaleHint } from '../interfaces/tour-generation.interface';

// Nominatim's own place classification for a destination big enough to have
// internal structure worth exploring — see docs/superpowers/specs/
// 2026-08-21-activity-engine-design.md, "Destination resolution". Anything
// finer-grained (a house, a specific amenity) or a state/country (out of
// scope per the design) falls back to point-scale.
const AREA_SCALE_ADDRESS_TYPES = new Set(['city', 'town', 'village']);
const MAX_DESTINATION_DISTANCE_METERS = 75_000;
// A city boundary's representative point may be far from the coordinate the
// user selected, especially for large municipalities. A fine-grained result
// (hotel, road, amenity), however, must be close to that selected coordinate
// before it can be treated as the intentional point destination. Keeping the
// thresholds separate prevents a nearby same-name road/POI from suppressing
// reverse normalization of a city-scale selection.
const MAX_POINT_DESTINATION_DISTANCE_METERS = 2_000;

export type DestinationDegradationReason =
  | 'missing_destination'
  | 'no_area_candidate'
  | 'candidate_mismatched_coordinates'
  | 'boundary_unavailable'
  | 'provider_failed';

export interface DestinationResolutionAudit {
  attemptedQueries: string[];
  pointReason?: 'specific_point_hint';
  settlementResult?: {
    osmType: 'node' | 'way' | 'relation';
    osmId: number;
    displayName: string;
  };
  selectedResult?: {
    osmType: 'way' | 'relation';
    osmId: number;
    displayName: string;
  };
  degradationReason?: DestinationDegradationReason;
  /**
   * The resolved destination's country, in Nominatim's own English-language
   * address field — never re-derived from free text elsewhere. Used to
   * scope grounded search providers (e.g. Tavily's `country` boost) so a
   * common place name shared by multiple countries (San Juan exists in
   * Argentina, Puerto Rico, and elsewhere) doesn't pull in unrelated results
   * for the wrong one.
   */
  country?: string;
}

export type DestinationResolution =
  | ({ scale: 'point' } & DestinationResolutionAudit)
  | ({
      scale: 'area';
      boundary: OsmCandidate;
    } & DestinationResolutionAudit);

interface DestinationCoordinates {
  latitude: number;
  longitude: number;
}

type AreaNominatimResult = NominatimResult & {
  osmType: 'way' | 'relation';
};

type SettlementNominatimResult = NominatimResult;

@Injectable()
export class DestinationResolutionService {
  private readonly logger = new Logger(DestinationResolutionService.name);

  constructor(
    @Inject('NominatimApiService')
    private readonly nominatimApi: INominatimApiService,
    private readonly osmPlacesService: OsmPlacesService,
  ) {}

  /**
   * Point-scale vs. area-scale, per the design's core reframing: a city
   * should never collapse to a point+radius. Degrades to point-scale (never
   * throws) on any failure — this must never block the point-scale flow
   * that already works today.
   */
  async resolveDestination(
    destinationText: string | undefined,
    coordinates?: DestinationCoordinates,
    scaleHint?: DestinationScaleHint,
  ): Promise<DestinationResolution> {
    const attemptedQueries: string[] = [];
    if (scaleHint === DestinationScaleHint.SPECIFIC_POINT) {
      return {
        scale: 'point',
        attemptedQueries,
        pointReason: 'specific_point_hint',
      };
    }
    if (!destinationText) {
      return {
        scale: 'point',
        attemptedQueries,
        degradationReason: 'missing_destination',
      };
    }

    try {
      attemptedQueries.push(`forward:${destinationText}`);
      const originalResults = await this.nominatimApi.search(destinationText);
      let candidates = originalResults;
      let reverseResult: NominatimResult | null = null;

      let best = this.selectAreaCandidate(candidates, coordinates);
      const originalResultsMatchCoordinates = coordinates
        ? this.hasCoordinateConsistentCandidate(originalResults, coordinates)
        : true;
      const originalResultsContainSelectedPoint = coordinates
        ? this.hasCoordinateConsistentCandidate(
            originalResults,
            coordinates,
            MAX_POINT_DESTINATION_DISTANCE_METERS,
          )
        : true;
      let hadCoordinateMismatch =
        originalResults.length > 0 && !originalResultsMatchCoordinates;

      // A successful exact match to a hotel/address/POI is intentional
      // point-scale input only when it is geographically consistent with the
      // coordinates selected in the wizard. Nominatim can return unrelated
      // POIs that merely contain the requested city name (for example a road
      // named "Salta" in another province); those results must not prevent
      // reverse normalization of the selected coordinates.
      if (
        !best &&
        coordinates &&
        (originalResults.length === 0 ||
          this.hasAreaCandidate(originalResults) ||
          this.hasSettlementCandidate(originalResults) ||
          !originalResultsContainSelectedPoint)
      ) {
        attemptedQueries.push(
          `reverse:${coordinates.latitude.toFixed(6)},${coordinates.longitude.toFixed(6)}`,
        );
        reverseResult = await this.nominatimApi.reverse(
          coordinates.latitude,
          coordinates.longitude,
        );
        const locality = reverseResult
          ? this.getStructuredLocality(reverseResult)
          : undefined;
        const country = reverseResult?.address?.country;

        if (locality && country) {
          const normalizedQuery = `${locality}, ${country}`;
          if (
            normalizedQuery.localeCompare(destinationText, undefined, {
              sensitivity: 'base',
            }) !== 0
          ) {
            attemptedQueries.push(`forward:${normalizedQuery}`);
            const normalizedResults =
              await this.nominatimApi.search(normalizedQuery);
            candidates = [
              ...normalizedResults,
              ...(reverseResult ? [reverseResult] : []),
            ];
            best = this.selectAreaCandidate(
              candidates,
              coordinates,
              reverseResult?.address?.countryCode,
            );
            hadCoordinateMismatch =
              hadCoordinateMismatch ||
              (this.hasAreaCandidate(candidates) && !best);
          } else if (reverseResult) {
            candidates = [reverseResult, ...originalResults];
            best = this.selectAreaCandidate(
              candidates,
              coordinates,
              reverseResult.address?.countryCode,
            );
          }
        } else if (reverseResult) {
          candidates = [reverseResult];
          best = this.selectAreaCandidate(candidates, coordinates);
        }
      }

      if (!best) {
        const settlement = this.selectSettlementCandidate(
          candidates,
          coordinates,
          reverseResult?.address?.countryCode,
        );
        if (settlement) {
          return this.resolveSettlementBoundary(
            settlement,
            reverseResult,
            coordinates,
            attemptedQueries,
          );
        }
        return {
          scale: 'point',
          attemptedQueries,
          degradationReason: hadCoordinateMismatch
            ? 'candidate_mismatched_coordinates'
            : 'no_area_candidate',
        };
      }

      const boundaryLookup = await this.osmPlacesService.lookupBoundaryById(
        best.osmType,
        best.osmId,
      );
      const boundary = boundaryLookup.value;
      const selectedResult = {
        osmType: best.osmType,
        osmId: best.osmId,
        displayName: best.displayName,
      } as const;
      const country = best.address?.country;
      if (!boundary) {
        return {
          scale: 'point',
          attemptedQueries,
          selectedResult,
          degradationReason:
            boundaryLookup.status === 'failed'
              ? 'provider_failed'
              : 'boundary_unavailable',
          country,
        };
      }

      return {
        scale: 'area',
        boundary,
        attemptedQueries,
        selectedResult,
        country,
      };
    } catch (error: any) {
      this.logger.warn(
        `Destination resolution failed for "${destinationText}", falling back to point-scale: ${error.message}`,
      );
      return {
        scale: 'point',
        attemptedQueries,
        degradationReason: 'provider_failed',
      };
    }
  }

  private hasAreaCandidate(
    results: Awaited<ReturnType<INominatimApiService['search']>>,
  ): boolean {
    return results.some((result) => this.isAreaCandidate(result));
  }

  private hasSettlementCandidate(
    results: Awaited<ReturnType<INominatimApiService['search']>>,
  ): boolean {
    return results.some((result) => this.isSettlementCandidate(result));
  }

  private selectAreaCandidate(
    results: Awaited<ReturnType<INominatimApiService['search']>>,
    coordinates?: DestinationCoordinates,
    expectedCountryCode?: string,
  ): AreaNominatimResult | undefined {
    return results
      .filter((result): result is AreaNominatimResult =>
        this.isAreaCandidate(result),
      )
      .filter(
        (result) =>
          !expectedCountryCode ||
          !result.address?.countryCode ||
          result.address.countryCode === expectedCountryCode,
      )
      .map((result) => ({
        result,
        distance: coordinates
          ? this.distanceFromCoordinates(result, coordinates)
          : 0,
      }))
      .filter(
        ({ distance }) =>
          !coordinates || distance <= MAX_DESTINATION_DISTANCE_METERS,
      )
      .sort(
        (a, b) =>
          a.distance - b.distance || b.result.importance - a.result.importance,
      )[0]?.result;
  }

  private isAreaCandidate(
    result: NominatimResult,
  ): result is AreaNominatimResult {
    return (
      AREA_SCALE_ADDRESS_TYPES.has(result.addresstype) &&
      result.osmType !== 'node'
    );
  }

  private isSettlementCandidate(
    result: NominatimResult,
  ): result is SettlementNominatimResult {
    return AREA_SCALE_ADDRESS_TYPES.has(result.addresstype);
  }

  private selectSettlementCandidate(
    results: Awaited<ReturnType<INominatimApiService['search']>>,
    coordinates?: DestinationCoordinates,
    expectedCountryCode?: string,
  ): SettlementNominatimResult | undefined {
    return results
      .filter((result) => this.isSettlementCandidate(result))
      .filter(
        (result) =>
          !expectedCountryCode ||
          !result.address?.countryCode ||
          result.address.countryCode === expectedCountryCode,
      )
      .map((result) => ({
        result,
        distance: coordinates
          ? this.distanceFromCoordinates(result, coordinates)
          : 0,
      }))
      .filter(
        ({ distance }) =>
          !coordinates || distance <= MAX_DESTINATION_DISTANCE_METERS,
      )
      .sort(
        (a, b) =>
          a.distance - b.distance || b.result.importance - a.result.importance,
      )[0]?.result;
  }

  private async resolveSettlementBoundary(
    settlement: SettlementNominatimResult,
    reverseResult: NominatimResult | null,
    coordinates: DestinationCoordinates | undefined,
    attemptedQueries: string[],
  ): Promise<DestinationResolution> {
    const settlementResult = {
      osmType: settlement.osmType,
      osmId: settlement.osmId,
      displayName: settlement.displayName,
    } as const;
    const country = settlement.address?.country;
    const lookupCoordinates =
      coordinates ??
      (settlement.latitude !== undefined && settlement.longitude !== undefined
        ? {
            latitude: settlement.latitude,
            longitude: settlement.longitude,
          }
        : undefined);
    const expectedContainerNames = this.getStructuredContainerNames(
      reverseResult ?? settlement,
    );

    if (!lookupCoordinates || expectedContainerNames.length === 0) {
      return {
        scale: 'point',
        attemptedQueries,
        settlementResult,
        degradationReason: 'boundary_unavailable',
        country,
      };
    }

    attemptedQueries.push(
      `containing-boundary:${lookupCoordinates.latitude.toFixed(6)},${lookupCoordinates.longitude.toFixed(6)}`,
    );
    const boundaryLookup =
      await this.osmPlacesService.lookupDestinationBoundary(
        lookupCoordinates.latitude,
        lookupCoordinates.longitude,
        expectedContainerNames,
      );
    const boundary = boundaryLookup.value;
    if (!boundary || boundary.osmType === 'node') {
      return {
        scale: 'point',
        attemptedQueries,
        settlementResult,
        degradationReason:
          boundaryLookup.status === 'failed'
            ? 'provider_failed'
            : 'boundary_unavailable',
        country,
      };
    }

    const selectedResult = {
      osmType: boundary.osmType,
      osmId: boundary.osmId,
      displayName: boundary.name,
    } as const;
    return {
      scale: 'area',
      boundary,
      attemptedQueries,
      settlementResult,
      selectedResult,
      country,
    };
  }

  private distanceFromCoordinates(
    result: Awaited<ReturnType<INominatimApiService['search']>>[number],
    coordinates: DestinationCoordinates,
  ): number {
    if (result.latitude === undefined || result.longitude === undefined) {
      return Number.POSITIVE_INFINITY;
    }

    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
    const latitudeDelta = toRadians(result.latitude - coordinates.latitude);
    const longitudeDelta = toRadians(result.longitude - coordinates.longitude);
    const a =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(toRadians(coordinates.latitude)) *
        Math.cos(toRadians(result.latitude)) *
        Math.sin(longitudeDelta / 2) ** 2;
    return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  private hasCoordinateConsistentCandidate(
    results: Awaited<ReturnType<INominatimApiService['search']>>,
    coordinates: DestinationCoordinates,
    maxDistanceMeters = MAX_DESTINATION_DISTANCE_METERS,
  ): boolean {
    return results.some(
      (result) =>
        this.distanceFromCoordinates(result, coordinates) <= maxDistanceMeters,
    );
  }

  private getStructuredLocality(
    result: Awaited<ReturnType<INominatimApiService['search']>>[number],
  ): string | undefined {
    return (
      result.address?.city ||
      result.address?.town ||
      result.address?.village ||
      result.address?.municipality
    );
  }

  private getStructuredContainerNames(result: NominatimResult): string[] {
    const names = [
      result.address?.cityDistrict,
      result.address?.borough,
      result.address?.municipality,
      result.address?.stateDistrict,
      result.address?.county,
    ].filter((name): name is string => Boolean(name?.trim()));

    return [...new Set(names)];
  }
}
