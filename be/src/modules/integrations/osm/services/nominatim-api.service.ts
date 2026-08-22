import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  INominatimApiService,
  NominatimResult,
} from '../interfaces/nominatim.interface';

const DEFAULT_API_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_REVERSE_API_URL = 'https://nominatim.openstreetmap.org/reverse';
const DEFAULT_TIMEOUT_MS = 10000;
const RESULT_LIMIT = 5;
// Same self-identification requirement as Overpass's public instance — see
// overpass-api.service.ts's USER_AGENT comment.
const USER_AGENT = 'ZigZagApp/1.0 (+https://github.com/jiseruk/zig-zag)';

interface NominatimApiResponseItem {
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  addresstype: string;
  display_name: string;
  importance: number;
  lat?: string;
  lon?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    country?: string;
    country_code?: string;
  };
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
            country: item.address.country,
            countryCode: item.address.country_code?.toUpperCase(),
          }
        : undefined,
    };
  }

  async search(query: string): Promise<NominatimResult[]> {
    try {
      const response = await axios.get<NominatimApiResponseItem[]>(
        this.apiUrl,
        {
          headers: { 'User-Agent': USER_AGENT },
          params: {
            q: query,
            format: 'jsonv2',
            limit: RESULT_LIMIT,
            addressdetails: 1,
          },
          timeout: this.timeoutMs,
        },
      );

      return (response.data || []).map((item) => this.mapResult(item));
    } catch (error: any) {
      this.logger.warn(
        `Nominatim search failed for "${query}": ${error.message}`,
      );
      // Preserve the difference between a successful lookup with no matches
      // and an unavailable provider. DestinationResolutionService owns the
      // graceful point-scale fallback and records provider_failed in its
      // generation audit.
      throw error;
    }
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
