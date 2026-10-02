import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  INominatimApiService,
  NominatimResult,
  NominatimSearchOptions,
  NominatimStructuredQuery,
} from '../interfaces/nominatim.interface';

const DEFAULT_API_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_REVERSE_API_URL = 'https://nominatim.openstreetmap.org/reverse';
const DEFAULT_TIMEOUT_MS = 10000;
const RESULT_LIMIT = 5;
// Same self-identification requirement as Overpass's public instance — see
// overpass-api.service.ts's USER_AGENT comment.
const USER_AGENT = 'ZigZagApp/1.0 (+https://github.com/jiseruk/zig-zag)';
const METERS_PER_DEGREE_LATITUDE = 111_320;

interface NominatimApiResponseItem {
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  addresstype: string;
  category?: string;
  place_rank?: number;
  address_rank?: number;
  type?: string;
  display_name: string;
  importance: number;
  lat?: string;
  lon?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    city_district?: string;
    state_district?: string;
    county?: string;
    borough?: string;
    suburb?: string;
    state?: string;
    country?: string;
    country_code?: string;
  };
}

/**
 * Nominatim's `viewbox` param, `<left>,<top>,<right>,<bottom>`
 * (minLon,maxLat,maxLon,minLat). Passed alone (no `bounded=1`) it is a soft
 * ranking preference, never a hard filter.
 */
function computeViewbox(
  center: { latitude: number; longitude: number },
  radiusMeters: number,
): string {
  const latDelta = radiusMeters / METERS_PER_DEGREE_LATITUDE;
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE * Math.cos((center.latitude * Math.PI) / 180);
  const lonDelta = radiusMeters / metersPerDegreeLongitude;
  const left = center.longitude - lonDelta;
  const right = center.longitude + lonDelta;
  const top = center.latitude + latDelta;
  const bottom = center.latitude - latDelta;
  return `${left},${top},${right},${bottom}`;
}

@Injectable()
export class NominatimApiService implements INominatimApiService {
  private readonly logger = new Logger(NominatimApiService.name);

  constructor(private readonly configService: ConfigService) {}

  private get apiUrl(): string {
    return (
      this.configService.get<string>('NOMINATIM_API_URL') || DEFAULT_API_URL
    );
  }

  private get timeoutMs(): number {
    return parseInt(
      this.configService.get<string>('NOMINATIM_TIMEOUT_MS') ||
        String(DEFAULT_TIMEOUT_MS),
      10,
    );
  }

  private get reverseApiUrl(): string {
    return (
      this.configService.get<string>('NOMINATIM_REVERSE_API_URL') ||
      DEFAULT_REVERSE_API_URL
    );
  }

  private mapResult(item: NominatimApiResponseItem): NominatimResult {
    return {
      osmType: item.osm_type,
      osmId: item.osm_id,
      addresstype: item.addresstype,
      ...(item.place_rank === undefined ? {} : { placeRank: item.place_rank }),
      ...(item.address_rank === undefined
        ? {}
        : { addressRank: item.address_rank }),
      class: item.category,
      type: item.type,
      displayName: item.display_name,
      importance: item.importance,
      latitude: item.lat === undefined ? undefined : Number(item.lat),
      longitude: item.lon === undefined ? undefined : Number(item.lon),
      address: item.address
        ? {
            city: item.address.city,
            town: item.address.town,
            village: item.address.village,
            municipality: item.address.municipality,
            cityDistrict: item.address.city_district,
            stateDistrict: item.address.state_district,
            county: item.address.county,
            borough: item.address.borough,
            suburb: item.address.suburb,
            state: item.address.state,
            country: item.address.country,
            countryCode: item.address.country_code?.toUpperCase(),
          }
        : undefined,
    };
  }

  private searchParams(
    options?: NominatimSearchOptions,
  ): Record<string, string | number> {
    return {
      format: 'jsonv2',
      limit: RESULT_LIMIT,
      addressdetails: 1,
      // Restricting to a known destination country avoids a
      // generic/common place name (e.g. "Cerro Alcázar") winning on
      // global `importance` in an unrelated, more-documented country —
      // verified live against the real API. Omitted entirely rather
      // than sent empty when unknown, matching Nominatim's own
      // expectation for this param.
      ...(options?.countryCode
        ? { countrycodes: options.countryCode.toLowerCase() }
        : {}),
      ...(options?.bias
        ? {
            viewbox: computeViewbox(
              options.bias.center,
              options.bias.radiusMeters,
            ),
          }
        : {}),
    };
  }

  private async fetch(
    params: Record<string, string | number>,
    label: string,
  ): Promise<NominatimResult[]> {
    try {
      const response = await axios.get<NominatimApiResponseItem[]>(
        this.apiUrl,
        {
          headers: { 'User-Agent': USER_AGENT },
          params,
          timeout: this.timeoutMs,
        },
      );

      return (response.data || []).map((item) => this.mapResult(item));
    } catch (error: any) {
      this.logger.warn(
        `Nominatim search failed for ${label}: ${error.message}`,
      );
      // Preserve the difference between a successful lookup with no matches
      // and an unavailable provider. DestinationResolutionService owns the
      // graceful point-scale fallback and records provider_failed in its
      // generation audit.
      throw error;
    }
  }

  async search(
    query: string,
    options?: NominatimSearchOptions,
  ): Promise<NominatimResult[]> {
    return this.fetch(
      { q: query, ...this.searchParams(options) },
      JSON.stringify(query),
    );
  }

  async searchStructured(
    query: NominatimStructuredQuery,
    options?: NominatimSearchOptions,
  ): Promise<NominatimResult[]> {
    const fields = Object.fromEntries(
      Object.entries(query).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1].trim().length > 0,
      ),
    );
    if (Object.keys(fields).length === 0) {
      throw new Error(
        'Nominatim structured search requires at least one field',
      );
    }
    return this.fetch(
      { ...fields, ...this.searchParams(options) },
      JSON.stringify(fields),
    );
  }

  async reverse(
    latitude: number,
    longitude: number,
  ): Promise<NominatimResult | null> {
    try {
      const response = await axios.get<NominatimApiResponseItem>(
        this.reverseApiUrl,
        {
          headers: { 'User-Agent': USER_AGENT },
          params: {
            lat: latitude,
            lon: longitude,
            format: 'jsonv2',
            addressdetails: 1,
            // Settlement-level reverse lookup. A street/building result is
            // not useful for deciding whether the selected destination is a
            // city-scale area.
            zoom: 10,
          },
          timeout: this.timeoutMs,
        },
      );

      return response.data ? this.mapResult(response.data) : null;
    } catch (error: any) {
      this.logger.warn(
        `Nominatim reverse lookup failed for ${latitude},${longitude}: ${error.message}`,
      );
      throw error;
    }
  }
}
