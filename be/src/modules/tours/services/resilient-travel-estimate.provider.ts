import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SpatialFootprint,
  TravelEstimate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { ApproximateTravelEstimateProvider } from './approximate-travel-estimate.provider';
import { GeoapifyTravelEstimateProvider } from './geoapify-travel-estimate.provider';

@Injectable()
export class ResilientTravelEstimateProvider implements TravelEstimateProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly geoapify: GeoapifyTravelEstimateProvider,
    private readonly approximate: ApproximateTravelEstimateProvider,
  ) {}

  async estimate(
    from: SpatialFootprint,
    to: SpatialFootprint,
    allowedModes: TransportationMode[],
  ): Promise<TravelEstimate> {
    const configured = (
      this.config.get<string>('ROUTING_PROVIDER') ?? 'geoapify'
    ).toLowerCase();

    if (configured === 'approximate') {
      const estimate = await this.approximate.estimate(from, to, allowedModes);
      return {
        ...estimate,
        fallbackReason: 'routing_provider_configured_approximate',
      };
    }

    if (configured !== 'geoapify') {
      const estimate = await this.approximate.estimate(from, to, allowedModes);
      return {
        ...estimate,
        fallbackReason: `unsupported_routing_provider:${configured}`,
      };
    }

    if (!this.geoapify.isAvailable()) {
      const estimate = await this.approximate.estimate(from, to, allowedModes);
      return { ...estimate, fallbackReason: 'geoapify_unconfigured' };
    }

    try {
      return await this.geoapify.estimate(from, to, allowedModes);
    } catch (error: any) {
      const estimate = await this.approximate.estimate(from, to, allowedModes);
      return {
        ...estimate,
        fallbackReason: `geoapify_failed:${String(error?.message ?? error).slice(0, 200)}`,
      };
    }
  }
}
