import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  SpatialFootprint,
  TravelEstimate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { footprintDistanceMeters } from '../utils/spatial-footprint.util';

@Injectable()
export class ApproximateTravelEstimateProvider implements TravelEstimateProvider {
  constructor(
    @Inject(dailyPlanningPolicyConfig.KEY)
    private readonly policy: ConfigType<typeof dailyPlanningPolicyConfig>,
  ) {}

  async estimate(
    from: SpatialFootprint,
    to: SpatialFootprint,
    allowedModes: TransportationMode[],
  ): Promise<TravelEstimate> {
    if (allowedModes.length === 0) {
      throw new Error(
        'ApproximateTravelEstimateProvider.estimate called with no allowed transportation modes',
      );
    }

    const distanceMeters =
      footprintDistanceMeters(from, to) * this.policy.travel.detourFactor;
    const mode = this.pickMode(allowedModes);
    const speedKmh = this.speedForMode(mode);
    const durationMinutes =
      speedKmh > 0 ? (distanceMeters / 1000 / speedKmh) * 60 : 0;
    const isWalking = mode === TransportationMode.WALKING;

    return {
      mode,
      durationMinutes,
      distanceMeters,
      walkingMinutes: isWalking ? durationMinutes : 0,
      walkingDistanceMeters: isWalking ? distanceMeters : 0,
      approximate: true,
    };
  }

  private pickMode(allowedModes: TransportationMode[]): TransportationMode {
    // Prefer walking when allowed — matches the product default of a
    // walkable tour; otherwise use the first allowed mode deterministically.
    if (allowedModes.includes(TransportationMode.WALKING)) {
      return TransportationMode.WALKING;
    }
    return allowedModes[0];
  }

  private speedForMode(mode: TransportationMode): number {
    switch (mode) {
      case TransportationMode.WALKING:
        return this.policy.travel.walkingSpeedKmh;
      case TransportationMode.CYCLING:
        return this.policy.travel.bikeSpeedKmh;
      case TransportationMode.DRIVING:
        return this.policy.travel.carUrbanSpeedKmh;
      case TransportationMode.PUBLIC_TRANSPORT:
        // No real transit routing in V1 — a conservative urban-driving-speed
        // proxy, per the spec's explicit non-goal on transit APIs.
        return this.policy.travel.carUrbanSpeedKmh;
      default:
        return this.policy.travel.walkingSpeedKmh;
    }
  }
}
