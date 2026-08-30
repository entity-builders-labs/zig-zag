import {
  SpatialFootprint,
  TravelEstimate,
  TravelEstimateProvider,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import { TransportationMode } from 'src/modules/tours/interfaces/tour-generation.interface';
import { haversineDistanceMeters } from './planning-assertions';

export class DeterministicTravelEstimator implements TravelEstimateProvider {
  constructor(
    private readonly config = {
      detourFactor: 1.3,
      walkingSpeedKmh: 4.5,
      bikeSpeedKmh: 13.0,
      carUrbanSpeedKmh: 25.0,
      carRuralSpeedKmh: 70.0,
    },
  ) {}

  async estimate(
    from: SpatialFootprint,
    to: SpatialFootprint,
    allowedModes: TransportationMode[],
  ): Promise<TravelEstimate> {
    const rawDistance = haversineDistanceMeters(
      from.centroid.lat,
      from.centroid.lng,
      to.centroid.lat,
      to.centroid.lng,
    );

    const distanceMeters = Math.round(rawDistance * this.config.detourFactor);

    // Pick best allowed mode
    let selectedMode: TransportationMode = TransportationMode.WALKING;
    if (
      allowedModes.includes(TransportationMode.DRIVING) &&
      distanceMeters > 2500
    ) {
      selectedMode = TransportationMode.DRIVING;
    } else if (
      allowedModes.includes(TransportationMode.PUBLIC_TRANSPORT) &&
      distanceMeters > 1000
    ) {
      selectedMode = TransportationMode.PUBLIC_TRANSPORT;
    } else if (
      allowedModes.includes(TransportationMode.CYCLING) &&
      distanceMeters > 1000
    ) {
      selectedMode = TransportationMode.CYCLING;
    } else if (allowedModes.includes(TransportationMode.WALKING)) {
      selectedMode = TransportationMode.WALKING;
    } else if (allowedModes.length > 0) {
      selectedMode = allowedModes[0];
    }

    let speedKmh = this.config.walkingSpeedKmh;
    let isWalking = false;

    switch (selectedMode) {
      case TransportationMode.WALKING:
        speedKmh = this.config.walkingSpeedKmh;
        isWalking = true;
        break;
      case TransportationMode.CYCLING:
        speedKmh = this.config.bikeSpeedKmh;
        break;
      case TransportationMode.DRIVING:
        speedKmh =
          distanceMeters > 15000
            ? this.config.carRuralSpeedKmh
            : this.config.carUrbanSpeedKmh;
        break;
      case TransportationMode.PUBLIC_TRANSPORT:
        speedKmh = 18.0;
        break;
    }

    const durationMinutes = Math.max(
      1,
      Math.round((distanceMeters / 1000 / speedKmh) * 60),
    );

    const walkingDistanceMeters = isWalking ? distanceMeters : 0;
    const walkingMinutes = isWalking ? durationMinutes : 0;

    return {
      mode: selectedMode,
      durationMinutes,
      distanceMeters,
      walkingMinutes,
      walkingDistanceMeters,
      approximate: true,
    };
  }
}
