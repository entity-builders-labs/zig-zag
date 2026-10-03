import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  SpatialFootprint,
  TravelEstimate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';

@Injectable()
export class GeoapifyTravelEstimateProvider implements TravelEstimateProvider {
  constructor(private readonly config: ConfigService) {}

  isAvailable(): boolean {
    return Boolean(this.config.get<string>('GEOAPIFY_API_KEY'));
  }

  async estimate(
    from: SpatialFootprint,
    to: SpatialFootprint,
    allowedModes: TransportationMode[],
  ): Promise<TravelEstimate> {
    const apiKey = this.config.get<string>('GEOAPIFY_API_KEY');
    if (!apiKey) throw new Error('GEOAPIFY_API_KEY is not configured');
    if (allowedModes.length === 0) {
      throw new Error('Geoapify routing requires at least one allowed mode');
    }

    const mode = this.pickMode(allowedModes);
    const response = await axios.get('https://api.geoapify.com/v1/routing', {
      params: {
        waypoints: `${from.centroid.lat},${from.centroid.lng}|${to.centroid.lat},${to.centroid.lng}`,
        mode: this.geoapifyMode(mode),
        apiKey,
      },
      timeout: Number(this.config.get<string>('ROUTING_TIMEOUT_MS') ?? 5000),
    });
    const properties = response.data?.features?.[0]?.properties;
    const distanceMeters = Number(properties?.distance);
    const durationSeconds = Number(properties?.time);
    if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
      throw new Error('Geoapify routing returned no usable route');
    }

    const isWalking = mode === TransportationMode.WALKING;
    return {
      mode,
      durationMinutes: durationSeconds / 60,
      distanceMeters,
      walkingMinutes: isWalking ? durationSeconds / 60 : 0,
      walkingDistanceMeters: isWalking ? distanceMeters : 0,
      approximate: false,
      provider: 'geoapify',
    };
  }

  private pickMode(allowedModes: TransportationMode[]): TransportationMode {
    if (allowedModes.includes(TransportationMode.WALKING)) {
      return TransportationMode.WALKING;
    }
    return allowedModes[0];
  }

  private geoapifyMode(mode: TransportationMode): string {
    switch (mode) {
      case TransportationMode.WALKING:
        return 'walk';
      case TransportationMode.CYCLING:
        return 'bicycle';
      case TransportationMode.DRIVING:
        return 'drive';
      case TransportationMode.PUBLIC_TRANSPORT:
        return 'transit';
      default:
        return 'walk';
    }
  }
}
