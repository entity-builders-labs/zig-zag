import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { INominatimApiService, NominatimResult } from '../interfaces/nominatim.interface';

const DEFAULT_API_URL = 'https://nominatim.openstreetmap.org/search';
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
}

@Injectable()
export class NominatimApiService implements INominatimApiService {
  private readonly logger = new Logger(NominatimApiService.name);

  constructor(private readonly configService: ConfigService) {}

  private get apiUrl(): string {
    return this.configService.get<string>('NOMINATIM_API_URL') || DEFAULT_API_URL;
  }

  private get timeoutMs(): number {
    return parseInt(
      this.configService.get<string>('NOMINATIM_TIMEOUT_MS') || String(DEFAULT_TIMEOUT_MS),
      10,
    );
  }

  async search(query: string): Promise<NominatimResult[]> {
    try {
      const response = await axios.get<NominatimApiResponseItem[]>(this.apiUrl, {
        headers: { 'User-Agent': USER_AGENT },
        params: { q: query, format: 'jsonv2', limit: RESULT_LIMIT },
        timeout: this.timeoutMs,
      });

      return (response.data || []).map((item) => ({
        osmType: item.osm_type,
        osmId: item.osm_id,
        addresstype: item.addresstype,
        displayName: item.display_name,
        importance: item.importance,
      }));
    } catch (error: any) {
      this.logger.warn(`Nominatim search failed for "${query}": ${error.message}`);
      return [];
    }
  }
}
